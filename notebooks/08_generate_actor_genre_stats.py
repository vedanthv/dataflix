"""
Casting Recommendation feature — fix for a real product gap: the original
quantitative signal only checked whether an actor appeared in one of
Dataflix's own 130 synthetic catalog titles in the script's genre, which is
almost always empty for a genuinely external/uploaded script (the actor's
real career spans far more films than our tiny catalog). This computes a
REAL per-actor, per-genre quality signal from each actor's actual TMDB
filmography (movie + tv credits) instead -- real vote_average, real genre
tags, aggregated -- so the quantitative signal is populated for any script,
not just ones that happen to overlap our synthetic catalog.

Writes dataflix.casting.actor_film_stats(actor_id, actor_name, genre,
film_count, avg_vote_average). Kept as a SEPARATE table from
dataflix.casting.actor_registry/actor_profile_chunks so the app can query it
directly (no vector search needed for this part -- it's a straight
aggregate).

Usage:
  .venv/bin/python notebooks/08_generate_actor_genre_stats.py
"""

import json
import os
import time
from collections import defaultdict
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

TMDB_API_KEY = os.environ["TMDB_API_KEY"]
TMDB_BASE = "https://api.themoviedb.org/3"

# Restrict to genre names already used by dataflix.core.dim_title so the
# casting route's genre-enum extraction always joins cleanly against this
# table. TMDB movie + tv genre ids that map to those exact names.
GENRE_ID_TO_NAME = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
    878: "Science Fiction", 53: "Thriller",
    10759: "Action & Adventure",  # TV
}


def fetch_all_credits(actor_id: int) -> list[dict]:
    r = requests.get(f"{TMDB_BASE}/person/{actor_id}/movie_credits", params={"api_key": TMDB_API_KEY}, timeout=20)
    r.raise_for_status()
    movie_cast = r.json().get("cast", [])

    r = requests.get(f"{TMDB_BASE}/person/{actor_id}/tv_credits", params={"api_key": TMDB_API_KEY}, timeout=20)
    r.raise_for_status()
    tv_cast = r.json().get("cast", [])

    return [c for c in movie_cast if c.get("vote_average") and c.get("genre_ids")] + [
        c for c in tv_cast if c.get("vote_average") and c.get("genre_ids")
    ]


def main():
    actors = json.loads((ROOT / "data" / "raw" / "actor_profile_targets.json").read_text())
    print(f"Computing real genre-specific filmography stats for {len(actors)} actors...")

    rows = []
    for i, row in enumerate(actors, start=1):
        actor_id = int(row["actor_id"])
        try:
            credits = fetch_all_credits(actor_id)
        except requests.HTTPError as e:
            print(f"  SKIP {row['actor_name']}: {e}")
            continue

        by_genre = defaultdict(list)
        for c in credits:
            for gid in c.get("genre_ids", []):
                genre = GENRE_ID_TO_NAME.get(gid)
                if genre:
                    by_genre[genre].append(c["vote_average"])

        for genre, ratings in by_genre.items():
            rows.append(
                {
                    "actor_id": actor_id,
                    "actor_name": row["actor_name"],
                    "genre": genre,
                    "film_count": len(ratings),
                    "avg_vote_average": round(sum(ratings) / len(ratings), 2),
                }
            )
        print(f"  [{i}/{len(actors)}] {row['actor_name']}: {len(by_genre)} genres from {len(credits)} rated credits")
        time.sleep(0.05)

    df = pd.DataFrame(rows)
    out_path = ROOT / "data" / "raw" / "docs" / "actor_profiles" / "actor_film_stats.parquet"
    df.to_parquet(out_path, index=False)
    print(f"\n{len(df)} (actor, genre) rows -> {out_path}")


if __name__ == "__main__":
    main()
