"""
Tier 0 / Section 1 — synthetic business-metric generation for fact_engagement
and fact_licensing, keyed to the REAL title_ids fetched in
00_fetch_real_movie_data.py. Runs locally (no external network dependency,
but follows the same local-generate -> volume -> SQL-load pattern as Step 0
for consistency; Free Edition serverless notebook execution isn't required
here since there's nothing to fetch).

fact_engagement is fully synthetic (plain random generation, not correlated
to dim_title's real vote_average/popularity columns -- kept simple per
explicit direction).

fact_licensing is fully synthetic for Dataflix's own (fictional) internal
license terms -- rights_holder is always a fictional entity per Section 1's
caution against attaching invented legal terms to real studios/people. Real
availability lives separately in dataflix.core.real_watch_providers (loaded
in Step 0) and is NOT merged into this table -- they're two different
concepts (who Dataflix licenses from vs. who else streams it today).

Two hero titles get hand-tuned end-to-end data (strong engagement in one
region, license expiring soon, favorable ROI) for the anchor-question demo:
  - movie_969681  "Spider-Man: Brand New Day" (Hollywood) -> strong in US
  - movie_1291608 "Dhurandhar"                (Bollywood)  -> strong in IN

fact_campaign_performance (added 2026-08-23, Tier 4/Genie G brought forward
per explicit user request tied to a real product need -- "accurate metrics
of which thumbnails generate more engagement"): fully synthetic campaign
spend/impressions/CTR/conversion, keyed to the REAL thumbnail_variant_ids
generated in notebooks/04_multimodal_tagging_job.py's task 2 (must run
BEFORE this script, since the variant_id keys come from there). One title
(the Spider-Man hero) is hand-tuned so v2 (tighter crop + boosted
saturation) clearly outperforms v1 (unmodified control) -- a realistic,
non-random "winner" for the demo, consistent with the pattern used for the
engagement/licensing hero titles.

Output (data/raw/synthetic/):
  dim_region.parquet      — region_code, region_name
  fact_engagement.parquet — title_id, region_code, snapshot_week, watch_hours,
                             completion_rate, day_1_retention
  fact_licensing.parquet  — title_id, region_code, license_type, license_expiry,
                             renewal_cost_estimate, exclusivity_flag, rights_holder
  fact_campaign_performance.parquet — campaign_id, title_id, region_code,
                             thumbnail_variant_id, spend, impressions, ctr,
                             conversion_rate

Usage:
  .venv/bin/python notebooks/01_generate_synthetic_data.py
"""

import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
from faker import Faker

ROOT = Path(__file__).resolve().parent.parent
TMDB_DIR = ROOT / "data" / "raw" / "tmdb"
OUT_DIR = ROOT / "data" / "raw" / "synthetic"
OUT_DIR.mkdir(parents=True, exist_ok=True)

SEED = 42
rng = np.random.default_rng(SEED)
fake = Faker()
Faker.seed(SEED)

TODAY = dt.date(2026, 8, 23)

REGIONS = [
    ("US", "United States"),
    ("IN", "India"),
    ("BR", "Brazil"),
    ("DE", "Germany"),
    ("JP", "Japan"),
    ("UK", "United Kingdom"),
]

HERO_TITLES = {
    "movie_969681": "US",  # Spider-Man: Brand New Day
    "movie_1291608": "IN",  # Dhurandhar
}

FICTIONAL_RIGHTS_HOLDERS = [
    "Northgate Media Partners",
    "Silverline Rights Group",
    "Blue Harbor Studios Licensing",
    "Meridian Content Alliance",
    "Cascade Entertainment Holdings",
    "Ironwood Distribution Co.",
    "Lumen Global Rights",
    "Harborview Media Licensing",
]

LICENSE_TYPES = ["exclusive_svod", "non_exclusive_svod", "avod", "output_deal"]


def load_titles() -> pd.DataFrame:
    return pd.read_parquet(TMDB_DIR / "dim_title.parquet")[
        ["title_id", "genre", "industry", "content_type"]
    ]


def gen_dim_region() -> pd.DataFrame:
    return pd.DataFrame(REGIONS, columns=["region_code", "region_name"])


def gen_fact_engagement(titles: pd.DataFrame) -> pd.DataFrame:
    rows = []
    snapshot_weeks = [TODAY - dt.timedelta(weeks=w) for w in range(9, -1, -1)]  # oldest -> newest

    # ~5% of (title, region) pairs get an injected anomaly week (sudden
    # spike or drop) so the offline anomaly-detection job (Section 4) has
    # genuine signal to find, not just noise.
    all_pairs = [
        (t, r) for t in titles.title_id for r, _ in REGIONS
    ]
    n_anomalous = max(1, int(len(all_pairs) * 0.05))
    anomalous_idx = set(rng.choice(len(all_pairs), size=n_anomalous, replace=False))

    pair_idx = 0
    for title_id in titles.title_id:
        for region_code, _ in REGIONS:
            is_hero_region = HERO_TITLES.get(title_id) == region_code
            base_completion = 0.78 if is_hero_region else rng.beta(5, 4)
            base_watch_hours = rng.lognormal(mean=9.5 if is_hero_region else 8.0, sigma=0.5)
            anomaly_week = None
            if pair_idx in anomalous_idx and not is_hero_region:
                anomaly_week = rng.integers(2, len(snapshot_weeks) - 1)
                anomaly_direction = rng.choice([-1, 1])

            for week_idx, snapshot_week in enumerate(snapshot_weeks):
                noise = rng.normal(0, 0.03)
                completion_rate = float(np.clip(base_completion + noise, 0.02, 0.99))
                watch_hours = float(max(0, base_watch_hours * (1 + rng.normal(0, 0.08))))
                day_1_retention = float(
                    np.clip(completion_rate * rng.uniform(0.75, 0.95), 0.01, 0.99)
                )

                if anomaly_week is not None and week_idx == anomaly_week:
                    shock = 0.45 * anomaly_direction
                    completion_rate = float(np.clip(completion_rate + shock, 0.02, 0.99))
                    watch_hours = float(max(0, watch_hours * (1 + shock)))
                    day_1_retention = float(np.clip(day_1_retention + shock * 0.8, 0.01, 0.99))

                rows.append(
                    {
                        "title_id": title_id,
                        "region_code": region_code,
                        "snapshot_week": snapshot_week,
                        "watch_hours": round(watch_hours, 2),
                        "completion_rate": round(completion_rate, 4),
                        "day_1_retention": round(day_1_retention, 4),
                    }
                )
            pair_idx += 1

    return pd.DataFrame(rows)


def gen_fact_licensing(titles: pd.DataFrame) -> pd.DataFrame:
    rows = []
    region_codes = [r for r, _ in REGIONS]

    for title_id in titles.title_id:
        hero_region = HERO_TITLES.get(title_id)
        n_regions = rng.integers(2, 4)  # 2-3 regions per title -> ~300 rows total
        chosen_regions = set(rng.choice(region_codes, size=n_regions, replace=False))
        if hero_region:
            chosen_regions.add(hero_region)

        for region_code in chosen_regions:
            is_hero_row = hero_region == region_code
            if is_hero_row:
                license_expiry = TODAY + dt.timedelta(days=int(rng.integers(15, 45)))
                renewal_cost_estimate = round(float(rng.uniform(15_000, 40_000)), 2)
            else:
                license_expiry = TODAY + dt.timedelta(days=int(rng.integers(10, 365)))
                renewal_cost_estimate = round(float(rng.uniform(5_000, 250_000)), 2)

            rows.append(
                {
                    "title_id": title_id,
                    "region_code": region_code,
                    "license_type": rng.choice(LICENSE_TYPES),
                    "license_expiry": license_expiry,
                    "renewal_cost_estimate": renewal_cost_estimate,
                    "exclusivity_flag": bool(rng.random() < 0.35),
                    "rights_holder": rng.choice(FICTIONAL_RIGHTS_HOLDERS),
                }
            )

    return pd.DataFrame(rows)


def load_thumbnail_variants() -> pd.DataFrame:
    path = OUT_DIR.parent / "content_signals" / "thumbnail_variant_signals.parquet"
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found -- run notebooks/04_multimodal_tagging_job.py "
            "(--task thumbnail) before this script, fact_campaign_performance "
            "is keyed to its real variant_ids"
        )
    return pd.read_parquet(path)[["title_id", "variant_id", "face_count", "has_expressive_face"]]


CAMPAIGN_REGIONS_PER_VARIANT = 2
CAMPAIGNS_PER_REGION = 4
HERO_THUMBNAIL_TITLE = "movie_969681"  # Spider-Man: Brand New Day
HERO_THUMBNAIL_REGION = "US"

# Base rate is UNIFORM across variant TYPES on purpose (2026-08-23 revision --
# an earlier version ranked face_closeup > dramatic_regrade > text_overlay as
# a fixed type-level prior, which made face_closeup win 10/10 titles even
# when the real per-row signals were tied -- not the "mix" a hackathon demo
# wants). What differentiates a variant now is ONLY: (a) its real signals
# (has_expressive_face, face_count -- Netflix's findings, see
# notebooks/04_multimodal_tagging_job.py's docstring), and (b) a per-
# (title, variant) "execution quality" multiplier below, standing in for the
# real-world fact that not every crop/grade/overlay is executed equally well
# for every poster -- large enough to plausibly flip the winner when (a) is
# tied across a title's 3 variants, which happens for ~half the subset.
BASE_CTR = 0.042
BASE_CONV = 0.088


def gen_fact_campaign_performance(variants: pd.DataFrame) -> pd.DataFrame:
    rows = []
    region_codes = [r for r, _ in REGIONS]
    campaign_seq = 0

    # one stable multiplier per (title_id, variant_id), not re-rolled per
    # campaign row -- represents "how well this specific variant was executed
    # for this specific poster", reused across all of that variant's rows.
    execution_quality = {
        (row.title_id, row.variant_id): float(rng.uniform(0.75, 1.3))
        for row in variants.itertuples()
    }

    for title_id, variant_group in variants.groupby("title_id"):
        chosen_regions = rng.choice(region_codes, size=CAMPAIGN_REGIONS_PER_VARIANT, replace=False)
        if title_id == HERO_THUMBNAIL_TITLE and HERO_THUMBNAIL_REGION not in chosen_regions:
            chosen_regions = [HERO_THUMBNAIL_REGION, *chosen_regions[1:]]

        for region_code in chosen_regions:
            for _, variant_row in variant_group.iterrows():
                variant_id = variant_row.variant_id
                is_hero = title_id == HERO_THUMBNAIL_TITLE and region_code == HERO_THUMBNAIL_REGION

                base_ctr = BASE_CTR * execution_quality[(title_id, variant_id)]
                base_conv = BASE_CONV * execution_quality[(title_id, variant_id)]

                # Netflix's actual published findings, applied generally across
                # the whole subset (not just the hand-tuned hero title below):
                # expressive faces perform better, and images with many people
                # (>3) underperform.
                if variant_row.has_expressive_face:
                    base_ctr *= 1.25
                    base_conv *= 1.3
                if variant_row.face_count > 3:
                    base_ctr *= 0.7
                    base_conv *= 0.75
                elif variant_row.face_count == 0:
                    base_ctr *= 0.9  # no clear focal face, mild penalty

                if is_hero and variant_id == "face_closeup":
                    # extra deterministic boost so the demo has one clean,
                    # low-noise "obvious winner" title to point to, on top of
                    # the general Netflix-inspired pattern above.
                    base_ctr *= 1.3
                    base_conv *= 1.3

                for _ in range(CAMPAIGNS_PER_REGION):
                    campaign_seq += 1
                    impressions = int(rng.integers(5_000, 80_000))
                    ctr = float(np.clip(base_ctr + rng.normal(0, 0.004), 0.005, 0.25))
                    conversion_rate = float(np.clip(base_conv + rng.normal(0, 0.01), 0.01, 0.5))
                    spend = round(float(impressions * rng.uniform(0.02, 0.08)), 2)

                    rows.append(
                        {
                            "campaign_id": f"camp_{campaign_seq:05d}",
                            "title_id": title_id,
                            "region_code": region_code,
                            "thumbnail_variant_id": variant_id,
                            "spend": spend,
                            "impressions": impressions,
                            "ctr": round(ctr, 4),
                            "conversion_rate": round(conversion_rate, 4),
                        }
                    )

    return pd.DataFrame(rows)


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--task", choices=["core", "campaign", "all"], default="all",
        help="'core' = dim_region+fact_engagement+fact_licensing, "
             "'campaign' = fact_campaign_performance only (needs thumbnail_variant_signals.parquet)",
    )
    args = parser.parse_args()

    titles = load_titles()
    print(f"Loaded {len(titles)} real titles as generation keys")

    if args.task in ("core", "all"):
        dim_region = gen_dim_region()
        fact_engagement = gen_fact_engagement(titles)
        fact_licensing = gen_fact_licensing(titles)

        dim_region.to_parquet(OUT_DIR / "dim_region.parquet", index=False)
        fact_engagement.to_parquet(OUT_DIR / "fact_engagement.parquet", index=False)
        fact_licensing.to_parquet(OUT_DIR / "fact_licensing.parquet", index=False)

        print(f"dim_region:      {len(dim_region)} rows")
        print(f"fact_engagement: {len(fact_engagement)} rows")
        print(f"fact_licensing:  {len(fact_licensing)} rows")

    if args.task in ("campaign", "all"):
        variants = load_thumbnail_variants()
        fact_campaign_performance = gen_fact_campaign_performance(variants)
        fact_campaign_performance.to_parquet(OUT_DIR / "fact_campaign_performance.parquet", index=False)
        print(f"fact_campaign_performance: {len(fact_campaign_performance)} rows")

        hero = fact_campaign_performance[
            (fact_campaign_performance.title_id == HERO_THUMBNAIL_TITLE)
            & (fact_campaign_performance.region_code == HERO_THUMBNAIL_REGION)
        ]
        for variant_id, grp in hero.groupby("thumbnail_variant_id"):
            print(f"  {HERO_THUMBNAIL_TITLE} {variant_id}: avg ctr={grp.ctr.mean():.4f}, "
                  f"avg conversion_rate={grp.conversion_rate.mean():.4f}")

    if args.task == "campaign":
        return  # fact_engagement/fact_licensing weren't (re)generated this run

    for title_id, region in HERO_TITLES.items():
        hero_eng = fact_engagement[
            (fact_engagement.title_id == title_id) & (fact_engagement.region_code == region)
        ]
        hero_lic = fact_licensing[
            (fact_licensing.title_id == title_id) & (fact_licensing.region_code == region)
        ]
        print(f"\nHero {title_id} in {region}:")
        print(
            f"  engagement: avg completion_rate={hero_eng.completion_rate.mean():.2f}, "
            f"avg watch_hours={hero_eng.watch_hours.mean():.1f}"
        )
        print(
            f"  licensing: expiry={hero_lic.license_expiry.iloc[0]}, "
            f"renewal_cost=${hero_lic.renewal_cost_estimate.iloc[0]:,.0f}"
        )


if __name__ == "__main__":
    main()
