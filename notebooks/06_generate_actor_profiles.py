"""
Casting Recommendation feature — generate real actor-profile PDFs from real
TMDB data (bio, filmography with real overview/vote_average, real user
reviews) for a curated 40-actor subset (top 20 Hollywood + top 20 Bollywood
by real TMDB popularity, drawn from title_cast/dim_title already in UC).

Real data only, no fabrication: bio via /person/{id}, filmography via
/person/{id}/movie_credits, reviews via /movie/{id}/reviews. Reviews are
often sparse/absent for very recent titles -- handled gracefully (section
omitted if none).

Runs locally (TMDB needs outbound internet, same reasoning as
00_fetch_real_movie_data.py). Requires the 40-actor list already selected
via SQL (see scratch query in conversation) -- pasted below as ACTORS.

Usage:
  .venv/bin/python notebooks/06_generate_actor_profiles.py
"""

import html
import json
import os
import subprocess
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

TMDB_API_KEY = os.environ["TMDB_API_KEY"]
TMDB_BASE = "https://api.themoviedb.org/3"

HTML_DIR = ROOT / "data" / "raw" / "docs" / "actor_profiles" / "html"
PDF_DIR = ROOT / "data" / "raw" / "docs" / "actor_profiles" / "pdf"
HTML_DIR.mkdir(parents=True, exist_ok=True)
PDF_DIR.mkdir(parents=True, exist_ok=True)

FILMS_PER_ACTOR = 6
REVIEWS_PER_FILM = 2

TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: Georgia, serif; margin: 40px; color: #1a1a1a; }}
  h1 {{ font-size: 26px; margin-bottom: 2px; }}
  .meta {{ color: #555; font-size: 13px; margin-bottom: 18px; }}
  h2 {{ font-size: 16px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 28px; }}
  .bio {{ font-size: 13px; line-height: 1.5; text-align: justify; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }}
  th, td {{ text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }}
  th {{ background: #f4f4f4; }}
  .review {{ font-size: 12px; margin-bottom: 10px; padding: 8px; background: #f9f9f9; border-left: 3px solid #999; }}
  .review-author {{ font-weight: bold; }}
  .provenance {{ font-size: 10px; color: #888; margin-top: 30px; border-top: 1px solid #eee; padding-top: 8px; }}
</style>
</head>
<body>
  <h1>{actor_name}</h1>
  <div class="meta">Industry focus in Dataflix catalog: {industry} &middot; TMDB Popularity: {popularity}</div>

  <h2>Biography</h2>
  <div class="bio">{biography}</div>

  <h2>Selected Filmography</h2>
  <table>
    <tr><th>Title</th><th>Rating</th><th>Synopsis</th></tr>
    {filmography_rows}
  </table>

  <h2>Audience Reviews (real, via TMDB)</h2>
  {reviews_html}

  <div class="provenance">Source: TMDB (The Movie Database) public API &mdash; biography, filmography ratings/synopses, and reviews are real, not fabricated. Generated for Dataflix's Casting Recommendation feature.</div>
</body>
</html>
"""


def esc(s):
    return html.escape(s or "")


def fetch_actor(actor_id: int) -> dict:
    r = requests.get(f"{TMDB_BASE}/person/{actor_id}", params={"api_key": TMDB_API_KEY}, timeout=20)
    r.raise_for_status()
    return r.json()


def fetch_credits(actor_id: int) -> list[dict]:
    r = requests.get(
        f"{TMDB_BASE}/person/{actor_id}/movie_credits", params={"api_key": TMDB_API_KEY}, timeout=20
    )
    r.raise_for_status()
    cast = r.json().get("cast", [])
    cast = [c for c in cast if c.get("overview")]
    cast.sort(key=lambda c: c.get("popularity", 0), reverse=True)
    return cast[:FILMS_PER_ACTOR]


def fetch_reviews(movie_id: int) -> list[dict]:
    r = requests.get(f"{TMDB_BASE}/movie/{movie_id}/reviews", params={"api_key": TMDB_API_KEY}, timeout=20)
    r.raise_for_status()
    return r.json().get("results", [])[:REVIEWS_PER_FILM]


def build_html(actor_row: dict, person: dict, films: list[dict], reviews_by_film: dict) -> str:
    filmography_rows = []
    for f in films:
        filmography_rows.append(
            f"<tr><td>{esc(f.get('title'))} ({(f.get('release_date') or '????')[:4]})</td>"
            f"<td>{f.get('vote_average', 0):.1f}/10</td>"
            f"<td>{esc((f.get('overview') or '')[:280])}</td></tr>"
        )

    review_blocks = []
    for f in films:
        for rev in reviews_by_film.get(f["id"], []):
            review_blocks.append(
                f'<div class="review"><span class="review-author">{esc(rev.get("author"))}</span> '
                f'on <em>{esc(f.get("title"))}</em>: {esc((rev.get("content") or "")[:400])}</div>'
            )
    reviews_html = "".join(review_blocks) if review_blocks else '<p style="font-size:12px;color:#888;">No public reviews available for this actor\'s recent films.</p>'

    return TEMPLATE.format(
        actor_name=esc(person.get("name")),
        industry=esc(actor_row["industry"]),
        popularity=f"{actor_row['popularity']:.2f}",
        biography=esc(person.get("biography")) or "<em>No biography available.</em>",
        filmography_rows="".join(filmography_rows),
        reviews_html=reviews_html,
    )


def main():
    actors = json.loads(
        (ROOT / "data" / "raw" / "actor_profile_targets.json").read_text()
    )
    print(f"Generating profiles for {len(actors)} actors...")

    manifest = []
    for i, row in enumerate(actors, start=1):
        actor_id = int(row["actor_id"])
        try:
            person = fetch_actor(actor_id)
            films = fetch_credits(actor_id)
            reviews_by_film = {}
            for f in films:
                try:
                    revs = fetch_reviews(f["id"])
                    if revs:
                        reviews_by_film[f["id"]] = revs
                except requests.HTTPError:
                    pass
                time.sleep(0.05)
        except requests.HTTPError as e:
            print(f"  SKIP {row['actor_name']} ({actor_id}): {e}")
            continue

        html_content = build_html(row, person, films, reviews_by_film)
        fname = f"actor_{actor_id}.html"
        (HTML_DIR / fname).write_text(html_content)
        manifest.append({**row, "filename": f"actor_{actor_id}.pdf"})
        print(f"  [{i}/{len(actors)}] {row['actor_name']}: {len(films)} films, "
              f"{sum(len(v) for v in reviews_by_film.values())} reviews")

    (ROOT / "data" / "raw" / "actor_profiles_manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\n{len(manifest)} HTML profiles written to {HTML_DIR}")

    print("Converting to PDF...")
    pdf_gen = (
        ROOT.parent
        / ".claude" / "plugins" / "cache" / "claude-plugins-official" / "databricks" / "0.2.12"
        / "skills" / "databricks-unstructured-pdf-generation" / "scripts" / "pdf_generator.py"
    )
    subprocess.run(
        [str(ROOT / ".venv" / "bin" / "python"), str(pdf_gen), "convert",
         "--input", str(HTML_DIR), "--output", str(PDF_DIR)],
        check=True,
    )


if __name__ == "__main__":
    main()
