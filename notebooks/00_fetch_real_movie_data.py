"""
Tier 0 / Step 0 — fetch real Hollywood + Bollywood title, cast, and poster
data from TMDB. Runs LOCALLY (not as a Databricks Job): Free Edition
serverless compute's outbound network is restricted to an allowlist, so this
script hits the public internet here and only the resulting static extract
(Parquet + poster images) gets uploaded into the workspace afterward.

Output (data/raw/tmdb/):
  dim_title.parquet           — title_id, title_name, genre, content_type,
                                 release_date, original_language, industry,
                                 poster_path, vote_average, vote_count, popularity
                                 (vote_average/vote_count/popularity are REAL TMDB
                                 signals — used downstream to seed/correlate the
                                 synthetic fact_engagement numbers, not fabricated)
  dim_actor.parquet           — actor_id, actor_name, popularity
  title_cast.parquet          — title_id, actor_id, billing_order
  real_watch_providers.parquet — title_id, region_code, provider_name, offer_type
                                 (REAL current streaming availability per title,
                                 JustWatch data via TMDB's free watch/providers
                                 endpoint — genuinely real, not synthetic)
  dim_title_certification.parquet — title_id, region_code, certification (REAL
                                 official rating, e.g. PG-13/UA/TV-MA, via TMDB's
                                 free release_dates/content_ratings endpoints —
                                 feeds the Compliance Risk Scanner idea)
  posters/{title_id}.jpg

Usage:
  .venv/bin/python notebooks/00_fetch_real_movie_data.py
"""

import os
import time
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

TMDB_TOKEN = os.environ["TMDB_READ_ACCESS_TOKEN"]
API_BASE = "https://api.themoviedb.org/3"
IMAGE_BASE = "https://image.tmdb.org/t/p/w500"

OUT_DIR = ROOT / "data" / "raw" / "tmdb"
POSTER_DIR = OUT_DIR / "posters"
OUT_DIR.mkdir(parents=True, exist_ok=True)
POSTER_DIR.mkdir(parents=True, exist_ok=True)

session = requests.Session()
session.headers.update(
    {"Authorization": f"Bearer {TMDB_TOKEN}", "accept": "application/json"}
)

CAST_PER_TITLE = 7  # 5-8 billed cast members
PAGE_SIZE = 20  # TMDB fixed page size

# canonical region codes (matches dataflix.core.dim_region) -> TMDB country code
# (TMDB/ISO uses GB, not UK, for the United Kingdom)
CANONICAL_REGIONS = {"US": "US", "IN": "IN", "BR": "BR", "DE": "DE", "JP": "JP", "UK": "GB"}
OFFER_TYPES = ("flatrate", "rent", "buy", "free", "ads")

# movies are the core ask (>=100 total); a smaller TV slice is layered on
# top per-industry for content_type diversity (Genie Space A cast queries
# span both movies and shows)
INDUSTRIES = {
    "Hollywood": {
        "filters": {"with_original_language": "en", "region": "US"},
        "movie_quota": 75,
        "tv_quota": 20,
    },
    "Bollywood": {
        "filters": {"with_original_language": "hi", "region": "IN"},
        "movie_quota": 25,
        "tv_quota": 10,
    },
}


def get(path: str, **params) -> dict:
    resp = session.get(f"{API_BASE}{path}", params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_genre_maps() -> dict:
    genre_map = {}
    for kind in ("movie", "tv"):
        data = get(f"/genre/{kind}/list")
        for g in data["genres"]:
            genre_map[(kind, g["id"])] = g["name"]
    return genre_map


TODAY = time.strftime("%Y-%m-%d")

# release-date field name differs between endpoints
DATE_SORT_FIELD = {"movie": "primary_release_date", "tv": "first_air_date"}


def discover_pages(kind: str, params: dict, n_needed: int) -> list[dict]:
    date_field = DATE_SORT_FIELD[kind]
    results = []
    page = 1
    while len(results) < n_needed and page <= 5:
        data = get(
            f"/discover/{kind}",
            sort_by=f"{date_field}.desc",
            **{
                f"{date_field}.lte": TODAY,  # exclude unreleased/placeholder entries
                "vote_count.gte": 20,  # filter out obscure/empty entries so cast+poster data exists
            },
            page=page,
            **params,
        )
        results.extend(data.get("results", []))
        if page >= data.get("total_pages", 1):
            break
        page += 1
    return results[:n_needed]


def fetch_credits(kind: str, tmdb_id: int) -> list[dict]:
    data = get(f"/{kind}/{tmdb_id}/credits")
    cast = sorted(data.get("cast", []), key=lambda c: c.get("order", 999))
    return cast[:CAST_PER_TITLE]


def fetch_certifications(kind: str, tmdb_id: int, title_id: str) -> list[dict]:
    """Real official certifications per region (MPAA/CBFC/etc-style ratings).
    Movies: /release_dates has a certification per (country, release_date) entry
    -- take the first non-empty one per country. TV: /content_ratings has one
    flat rating per country already."""
    rows = []
    if kind == "movie":
        data = get(f"/movie/{tmdb_id}/release_dates")
        by_country = {r["iso_3166_1"]: r["release_dates"] for r in data.get("results", [])}
        for region_code, tmdb_country in CANONICAL_REGIONS.items():
            entries = by_country.get(tmdb_country, [])
            cert = next((e["certification"] for e in entries if e.get("certification")), None)
            if cert:
                rows.append({"title_id": title_id, "region_code": region_code, "certification": cert})
    else:
        data = get(f"/tv/{tmdb_id}/content_ratings")
        by_country = {r["iso_3166_1"]: r["rating"] for r in data.get("results", [])}
        for region_code, tmdb_country in CANONICAL_REGIONS.items():
            rating = by_country.get(tmdb_country)
            if rating:
                rows.append({"title_id": title_id, "region_code": region_code, "certification": rating})
    return rows


def fetch_watch_providers(kind: str, tmdb_id: int, title_id: str) -> list[dict]:
    """One TMDB call returns every country at once; keep only our 6 canonical regions."""
    data = get(f"/{kind}/{tmdb_id}/watch/providers")
    results = data.get("results", {})
    rows = []
    for region_code, tmdb_country in CANONICAL_REGIONS.items():
        country_data = results.get(tmdb_country)
        if not country_data:
            continue
        for offer_type in OFFER_TYPES:
            for provider in country_data.get(offer_type, []):
                rows.append(
                    {
                        "title_id": title_id,
                        "region_code": region_code,
                        "provider_name": provider.get("provider_name"),
                        "offer_type": offer_type,
                    }
                )
    return rows


def main():
    genre_map = fetch_genre_maps()

    titles = []
    actors_by_id = {}
    title_cast_rows = []
    watch_provider_rows = []
    certification_rows = []

    for industry, cfg in INDUSTRIES.items():
        filt = cfg["filters"]
        raw_items = []
        for kind, quota in (("movie", cfg["movie_quota"]), ("tv", cfg["tv_quota"])):
            items = discover_pages(kind, filt, quota)
            for item in items:
                item["_kind"] = kind
            raw_items.extend(items)

        print(f"[{industry}] discovered {len(raw_items)} raw titles")

        for item in raw_items:
            kind = item["_kind"]
            tmdb_id = item["id"]
            title_id = f"{kind}_{tmdb_id}"
            title_name = item.get("title") or item.get("name")
            release_date = item.get("release_date") or item.get("first_air_date")
            genre_ids = item.get("genre_ids") or []
            genre = genre_map.get((kind, genre_ids[0])) if genre_ids else None
            poster_path = item.get("poster_path")

            titles.append(
                {
                    "title_id": title_id,
                    "title_name": title_name,
                    "genre": genre,
                    "content_type": kind,
                    "release_date": release_date,
                    "original_language": item.get("original_language"),
                    "industry": industry,
                    "poster_path": poster_path,
                    "vote_average": item.get("vote_average"),
                    "vote_count": item.get("vote_count"),
                    "popularity": item.get("popularity"),
                }
            )

            # cast
            try:
                cast = fetch_credits(kind, tmdb_id)
            except requests.HTTPError as e:
                print(f"  credits failed for {title_id}: {e}")
                cast = []

            for billing_order, person in enumerate(cast):
                actor_id = person["id"]
                actors_by_id[actor_id] = {
                    "actor_id": actor_id,
                    "actor_name": person.get("name"),
                    "popularity": person.get("popularity"),
                }
                title_cast_rows.append(
                    {
                        "title_id": title_id,
                        "actor_id": actor_id,
                        "billing_order": billing_order,
                    }
                )

            # real watch-provider availability (JustWatch data via TMDB)
            try:
                watch_provider_rows.extend(
                    fetch_watch_providers(kind, tmdb_id, title_id)
                )
            except requests.HTTPError as e:
                print(f"  watch providers failed for {title_id}: {e}")

            # real official certifications (MPAA/CBFC/etc-style ratings)
            try:
                certification_rows.extend(fetch_certifications(kind, tmdb_id, title_id))
            except requests.HTTPError as e:
                print(f"  certifications failed for {title_id}: {e}")

            # poster download
            if poster_path:
                dest = POSTER_DIR / f"{title_id}.jpg"
                if not dest.exists():
                    try:
                        img = session.get(f"{IMAGE_BASE}{poster_path}", timeout=30)
                        img.raise_for_status()
                        dest.write_bytes(img.content)
                    except requests.HTTPError as e:
                        print(f"  poster download failed for {title_id}: {e}")

    dim_title = pd.DataFrame(titles).drop_duplicates(subset="title_id")
    dim_actor = pd.DataFrame(list(actors_by_id.values())).drop_duplicates(
        subset="actor_id"
    )
    title_cast = pd.DataFrame(title_cast_rows).drop_duplicates(
        subset=["title_id", "actor_id"]
    )
    real_watch_providers = pd.DataFrame(watch_provider_rows).drop_duplicates()
    dim_title_certification = pd.DataFrame(certification_rows).drop_duplicates(
        subset=["title_id", "region_code"]
    )

    dim_title.to_parquet(OUT_DIR / "dim_title.parquet", index=False)
    dim_actor.to_parquet(OUT_DIR / "dim_actor.parquet", index=False)
    title_cast.to_parquet(OUT_DIR / "title_cast.parquet", index=False)
    real_watch_providers.to_parquet(
        OUT_DIR / "real_watch_providers.parquet", index=False
    )
    dim_title_certification.to_parquet(
        OUT_DIR / "dim_title_certification.parquet", index=False
    )

    print(f"\ndim_title:  {len(dim_title)} rows -> {OUT_DIR / 'dim_title.parquet'}")
    print(f"dim_actor:  {len(dim_actor)} rows -> {OUT_DIR / 'dim_actor.parquet'}")
    print(f"title_cast: {len(title_cast)} rows -> {OUT_DIR / 'title_cast.parquet'}")
    print(
        f"real_watch_providers: {len(real_watch_providers)} rows -> "
        f"{OUT_DIR / 'real_watch_providers.parquet'}"
    )
    print(
        f"dim_title_certification: {len(dim_title_certification)} rows -> "
        f"{OUT_DIR / 'dim_title_certification.parquet'}"
    )
    n_posters = len(list(POSTER_DIR.glob("*.jpg")))
    print(f"posters:    {n_posters} files -> {POSTER_DIR}")
    print(f"\nby industry:\n{dim_title['industry'].value_counts()}")
    print(f"\nby content_type:\n{dim_title['content_type'].value_counts()}")


if __name__ == "__main__":
    main()
