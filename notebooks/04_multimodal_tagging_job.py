"""
Tier 1 / Section 4 — poster + thumbnail-variant tagging for Genie C (Content
Signals), plus synthetic thumbnail-variant campaign performance for Genie G
(Marketing Campaign Performance).

Task 1 (poster tagging): calls a vision-capable Databricks Foundation Model
serving endpoint (databricks-llama-4-maverick) on the real TMDB poster images
already downloaded in notebooks/00_fetch_real_movie_data.py, and upserts
structured tags into dataflix.content_signals.poster_signals.

Coverage: intentionally partial, top 15 Hollywood + top 5 Bollywood titles by
real TMDB vote_count (most recognizable), not the full 130-title catalog --
stated openly in the demo per PLAN.md. Both hero titles (movie_969681,
movie_1291608) land in this subset naturally.

Task 2 (thumbnail variant tagging, added 2026-08-23, revised same day):
reversal of the earlier scope-cut -- user has a real product need ("accurate
metrics of which thumbnails generate more engagement"), which needs BOTH a
variant-tagging step AND the campaign-performance numbers it joins against
(Genie G), not tagging alone. First pass (2 variants, fixed-percentage crop +
saturation boost) was judged "too elementary" -- revised to 3 genuinely
distinct variant types grounded in Netflix's own published A/B-testing
findings (netflixtechblog.com/selecting-the-best-artwork-for-videos-through-
a-b-testing-f6155c4595f6: fewer people in frame and expressive faces
correlate with better performance):
  - face_closeup: REAL face detection (OpenCV FaceDetectorYN / YuNet ONNX
    model, data/cv_models/face_detection_yunet.onnx) locates the largest
    actual face in the poster and crops tightly around it -- not a fixed
    percentage box, genuinely different per poster. Falls back to a
    center-upper crop if no face is detected.
  - dramatic_regrade: full original frame, cinematic contrast+desaturation
    grade -- a mood/color variant, not a crop variant.
  - text_overlay: full frame + a bottom gradient banner with the real title
    name burned in as bold text (PIL ImageDraw/ImageFont) -- real streaming
    thumbnails almost always carry text; this is the most common real-world
    pattern missing from the first pass entirely.
Each variant vision-tagged the same way as posters, PLUS the vision model is
now also asked to report person_count (Netflix's actual "images with >3
people underperform" finding is baked into fact_campaign_performance's
synthetic ctr/conversion_rate generation in notebooks/01 -- not just for the
hand-tuned hero title, but as a general pattern across the whole subset).

subtitle_signals / pacing tagging is (still) cut from this job -- see
PLAN.md Section 4's 2026-08-23 scope-cut note (no clean real data source,
low demo value, and unrelated to the thumbnail-metrics need above).

Usage:
  .venv/bin/python notebooks/04_multimodal_tagging_job.py [--task poster|thumbnail|all]
"""

import base64
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
import requests
from databricks.sdk.core import Config
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = Path(__file__).resolve().parent.parent
TMDB_DIR = ROOT / "data" / "raw" / "tmdb"
POSTER_DIR = TMDB_DIR / "posters"
HIRES_POSTER_DIR = TMDB_DIR / "posters_hires"
HIRES_POSTER_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR = ROOT / "data" / "raw" / "content_signals"
OUT_DIR.mkdir(parents=True, exist_ok=True)
VARIANT_DIR = OUT_DIR / "thumbnail_variants"
VARIANT_DIR.mkdir(parents=True, exist_ok=True)
FACE_MODEL_PATH = ROOT / "data" / "cv_models" / "face_detection_yunet.onnx"
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

ENDPOINT_NAME = "databricks-llama-4-maverick"
# w185 (not w500) for poster_url -- this is what gets surfaced inline in chat
# answers, so it should be thumbnail-sized by default, not a full-res poster.
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w185"
# "original" (not w500) as the SOURCE for thumbnail variants specifically --
# face_closeup crops a small region out of the source image, and cropping out
# of the w500 poster (500x750) produced ~104x195px crops that looked visibly
# pixelated once displayed at carousel size (240px). original-size TMDB art
# (~1500x2250 for most posters) gives the crop real detail to work with.
TMDB_HIRES_BASE = "https://image.tmdb.org/t/p/original"
FINAL_VARIANT_WIDTH = 500  # all 3 variants resized to this width (LANCZOS) before saving


def fetch_hires_poster(title_id: str, poster_path_field: str) -> Path:
    dest = HIRES_POSTER_DIR / f"{title_id}.jpg"
    if not dest.exists():
        resp = requests.get(f"{TMDB_HIRES_BASE}{poster_path_field}", timeout=30)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
    return dest


def resize_final(img: Image.Image, width: int = FINAL_VARIANT_WIDTH) -> Image.Image:
    """Consistent, good-quality resample so every saved variant looks crisp at
    the app's display size, regardless of how large/small the crop was."""
    w, h = img.size
    if w == width:
        return img
    new_h = int(h * (width / w))
    return img.resize((width, new_h), Image.LANCZOS)
N_HOLLYWOOD = 15
N_BOLLYWOOD = 5
N_THUMBNAIL_HOLLYWOOD = 7
N_THUMBNAIL_BOLLYWOOD = 3
SLEEP_BETWEEN_CALLS_SEC = 1.5

DOMINANT_COLOR_TONES = ["warm", "cool", "neutral", "high-contrast", "muted", "dark", "vibrant"]
COMPOSITION_STYLES = [
    "character-focused",
    "ensemble",
    "action-collage",
    "minimalist",
    "text-heavy",
    "landscape/establishing",
]
EMOTIONAL_TONES = ["tense", "uplifting", "dark", "comedic", "dramatic", "mysterious", "romantic"]

PROMPT = f"""You are tagging a movie/TV poster for a content-strategy analytics catalog.
Look at the poster image and classify it using EXACTLY one value per field from the
given options. Respond with ONLY a single-line JSON object, no markdown fences, no
explanation.

Fields:
- dominant_color_tone: one of {DOMINANT_COLOR_TONES}
- composition_style: one of {COMPOSITION_STYLES}
- emotional_tone: one of {EMOTIONAL_TONES}

Example response: {{"dominant_color_tone": "dark", "composition_style": "character-focused", "emotional_tone": "tense"}}
"""


def select_subset() -> pd.DataFrame:
    dim_title = pd.read_parquet(TMDB_DIR / "dim_title.parquet")
    hollywood = dim_title[dim_title.industry == "Hollywood"].sort_values("vote_count", ascending=False).head(N_HOLLYWOOD)
    bollywood = dim_title[dim_title.industry == "Bollywood"].sort_values("vote_count", ascending=False).head(N_BOLLYWOOD)
    subset = pd.concat([hollywood, bollywood], ignore_index=True)

    hero_ids = {"movie_969681", "movie_1291608"}
    missing_heroes = hero_ids - set(subset.title_id)
    if missing_heroes:
        extra = dim_title[dim_title.title_id.isin(missing_heroes)]
        subset = pd.concat([subset, extra], ignore_index=True)

    return subset


def query_vision_endpoint(cfg: Config, host: str, headers: dict, image_b64: str) -> dict:
    payload = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                ],
            }
        ],
        "max_tokens": 200,
        "temperature": 0.0,
    }
    resp = requests.post(
        f"{host}/serving-endpoints/{ENDPOINT_NAME}/invocations",
        headers=headers,
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if not match:
        raise ValueError(f"no JSON object found in model response: {content!r}")
    return json.loads(match.group(0))


def validate_tags(tags: dict) -> dict:
    if tags.get("dominant_color_tone") not in DOMINANT_COLOR_TONES:
        raise ValueError(f"invalid dominant_color_tone: {tags.get('dominant_color_tone')!r}")
    if tags.get("composition_style") not in COMPOSITION_STYLES:
        raise ValueError(f"invalid composition_style: {tags.get('composition_style')!r}")
    if tags.get("emotional_tone") not in EMOTIONAL_TONES:
        raise ValueError(f"invalid emotional_tone: {tags.get('emotional_tone')!r}")
    return tags


def select_thumbnail_subset() -> pd.DataFrame:
    dim_title = pd.read_parquet(TMDB_DIR / "dim_title.parquet")
    hollywood = (
        dim_title[dim_title.industry == "Hollywood"]
        .sort_values("vote_count", ascending=False)
        .head(N_THUMBNAIL_HOLLYWOOD)
    )
    bollywood = (
        dim_title[dim_title.industry == "Bollywood"]
        .sort_values("vote_count", ascending=False)
        .head(N_THUMBNAIL_BOLLYWOOD)
    )
    subset = pd.concat([hollywood, bollywood], ignore_index=True)

    hero_ids = {"movie_969681", "movie_1291608"}
    missing_heroes = hero_ids - set(subset.title_id)
    if missing_heroes:
        extra = dim_title[dim_title.title_id.isin(missing_heroes)]
        subset = pd.concat([subset, extra], ignore_index=True)

    return subset


_face_detector = None


def get_face_detector():
    global _face_detector
    if _face_detector is None:
        _face_detector = cv2.FaceDetectorYN_create(str(FACE_MODEL_PATH), "", (320, 320), score_threshold=0.7)
    return _face_detector


def detect_faces(poster_path: Path):
    """Real face detection (OpenCV YuNet ONNX model). Returns (largest_face_bbox
    or None, total_face_count) -- both used downstream: the bbox drives the
    face_closeup crop, the count feeds Netflix's "fewer people performs
    better" pattern into the synthetic campaign-performance generation."""
    img = cv2.imread(str(poster_path))
    h, w = img.shape[:2]
    detector = get_face_detector()
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    if faces is None or len(faces) == 0:
        return None, 0
    areas = faces[:, 2] * faces[:, 3]
    largest = faces[areas.argmax()]
    x, y, fw, fh = largest[:4].astype(int)
    return (max(0, x), max(0, y), fw, fh), len(faces)


def crop_face_closeup(img: Image.Image, face_bbox, pad: float = 0.6) -> Image.Image:
    w, h = img.size
    if face_bbox is None:
        # fallback: no face detected -- center-upper crop, same as the old fixed box
        return img.crop((int(w * 0.15), int(h * 0.05), int(w * 0.85), int(h * 0.65)))

    x, y, fw, fh = face_bbox
    pad_x, pad_y = int(fw * pad), int(fh * pad)
    left = max(0, x - pad_x)
    top = max(0, y - pad_y)
    right = min(w, x + fw + pad_x)
    bottom = min(h, y + fh + int(pad_y * 2.2))  # more room below the face than above
    crop = img.crop((left, top, right, bottom))
    return ImageEnhance.Sharpness(crop).enhance(1.2)


def apply_dramatic_regrade(img: Image.Image) -> Image.Image:
    graded = ImageEnhance.Contrast(img).enhance(1.25)
    graded = ImageEnhance.Color(graded).enhance(0.85)  # slight desaturation -- moodier, not punchier
    graded = ImageEnhance.Brightness(graded).enhance(0.92)
    return graded


def get_dominant_color(img: Image.Image) -> tuple:
    """Cheap dominant-color extraction (downscale + quantize + most-common
    palette color) -- used to tint the text_overlay scrim to each specific
    poster instead of a generic gray/black box."""
    small = img.resize((60, 60)).convert("RGB").quantize(colors=8, method=Image.MEDIANCUT).convert("RGB")
    colors = small.getcolors(60 * 60)
    colors.sort(key=lambda c: -c[0])
    for _, rgb in colors:
        # skip near-black/near-white so the tint is actually a color, not gray
        if not (max(rgb) < 40 or min(rgb) > 220):
            return rgb
    return colors[0][1]


CERT_REGION_PRIORITY = ["US", "IN", "UK", "DE", "BR", "JP"]


def lookup_certification(title_id: str, cert_df: pd.DataFrame) -> str | None:
    rows = cert_df[cert_df.title_id == title_id]
    by_region = dict(zip(rows.region_code, rows.certification))
    for region in CERT_REGION_PRIORITY:
        val = by_region.get(region)
        if val and val not in ("NR", "Not Rated", ""):
            return val
    return None


def apply_text_overlay(img: Image.Image, title_name: str, certification: str | None) -> Image.Image:
    """Real streaming-thumbnail treatment combining 4 elements (all requested
    on user feedback that the plain solid-banner version was "too simple"):
      1. Color-matched gradient scrim (tinted to each poster's own dominant
         color, not a generic gray/black box)
      2. A real rating/certification badge (from dim_title_certification)
      3. A centered play-button + a 'TRENDING NOW' corner ribbon
      4. Stylized title typography (drop shadow, not flat text)
    """
    w, h = img.size
    base = img.crop((0, 0, w, int(h * 0.76)))  # drop existing burned-in title art first
    w, h = base.size
    dom_color = get_dominant_color(base)
    tint = tuple(max(0, c // 4) for c in dom_color)

    canvas = base.convert("RGBA")
    scrim_h = int(h * 0.55)
    scrim = Image.new("RGBA", (w, scrim_h), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(scrim)
    for i in range(scrim_h):
        alpha = int(235 * (i / scrim_h) ** 1.3)
        sdraw.line([(0, i), (w, i)], fill=(*tint, alpha))
    canvas.alpha_composite(scrim, (0, h - scrim_h))
    draw = ImageDraw.Draw(canvas)

    # 3a. Play button, centered in the upper part of the scrim
    play_r = int(w * 0.09)
    cx, cy = w // 2, h - int(scrim_h * 0.62)
    draw.ellipse([cx - play_r, cy - play_r, cx + play_r, cy + play_r], fill=(255, 255, 255, 235))
    tri = [(cx - play_r * 0.32, cy - play_r * 0.5), (cx - play_r * 0.32, cy + play_r * 0.5), (cx + play_r * 0.55, cy)]
    draw.polygon(tri, fill=(20, 20, 20, 255))

    badge_font = ImageFont.truetype(FONT_PATH, max(12, int(w * 0.045)))
    pad = 7

    # 3b. "TRENDING NOW" ribbon, top-left
    ribbon_text = "TRENDING NOW"
    rb = draw.textbbox((0, 0), ribbon_text, font=badge_font)
    rw, rh = rb[2] - rb[0], rb[3] - rb[1]
    draw.rectangle([10, 10, 10 + rw + 2 * pad, 10 + rh + 2 * pad], fill=(216, 30, 30, 255))
    draw.text((10 + pad, 10 + pad - rb[1]), ribbon_text, font=badge_font, fill=(255, 255, 255, 255))

    # 2. Real certification badge, top-right (only if we have a real value)
    if certification:
        cb = draw.textbbox((0, 0), certification, font=badge_font)
        cw_, ch_ = cb[2] - cb[0], cb[3] - cb[1]
        draw.rectangle([w - 10 - cw_ - 2 * pad, 10, w - 10, 10 + ch_ + 2 * pad], fill=(0, 0, 0, 210))
        draw.text((w - 10 - cw_ - pad, 10 + pad - cb[1]), certification, font=badge_font, fill=(255, 255, 255, 255))

    # 4. Title, bold with a drop shadow instead of flat text
    font_size = max(16, int(w * 0.09))
    font = ImageFont.truetype(FONT_PATH, font_size)
    text = title_name.upper()
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    while text_w > w * 0.88 and font_size > 10:
        font_size -= 2
        font = ImageFont.truetype(FONT_PATH, font_size)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    tx = (w - text_w) / 2
    ty = h - int(scrim_h * 0.16) - text_h - bbox[1]
    shadow = max(2, font_size // 14)
    draw.text((tx + shadow, ty + shadow), text, font=font, fill=(0, 0, 0, 190))
    draw.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))

    return canvas.convert("RGB")


def generate_variant_images(poster_path: Path, title_name: str, title_id: str, cert_df: pd.DataFrame) -> dict:
    """3 genuinely distinct variants from the one real poster, grounded in
    Netflix's own published A/B-testing findings (fewer people in frame +
    expressive faces perform better -- see module docstring for the citation):
      - face_closeup: real face-detected crop (not a fixed percentage box)
      - dramatic_regrade: full frame, cinematic contrast/desaturation grade
      - text_overlay: full frame + color-matched scrim, play button, real
        certification badge, 'TRENDING NOW' ribbon, and stylized title text
    """
    img = Image.open(poster_path).convert("RGB")
    face_bbox, face_count = detect_faces(poster_path)
    certification = lookup_certification(title_id, cert_df)

    face_closeup = resize_final(crop_face_closeup(img, face_bbox))
    dramatic_regrade = resize_final(apply_dramatic_regrade(img))
    text_overlay = resize_final(apply_text_overlay(img, title_name, certification))

    face_desc = (
        "tight face-detected close-up crop" if face_bbox is not None
        else "center-upper crop (no face detected)"
    )
    return {
        "face_closeup": (face_closeup, face_desc, face_count),
        "dramatic_regrade": (dramatic_regrade, "full scene, cinematic desaturated contrast grade", face_count),
        "text_overlay": (
            text_overlay,
            f"full scene, color-matched scrim, play button, 'TRENDING NOW' ribbon"
            f"{f', {certification} rating badge' if certification else ''}, and stylized '{title_name}' title text",
            face_count,
        ),
    }


VARIANT_PROMPT = f"""You are tagging a movie/TV thumbnail image variant for a marketing
analytics catalog, using criteria from Netflix's published artwork A/B-testing research
(fewer people in frame and expressive facial close-ups tend to perform better). Respond
with ONLY a single-line JSON object, no markdown fences, no explanation.

Fields:
- dominant_color_tone: one of {DOMINANT_COLOR_TONES}
- variant_description: a short (under 14 words) plain-English description of this
  specific treatment, e.g. "tight expressive close-up, warm saturated tones"
- has_expressive_face: true if a clearly visible, emotionally expressive face is the
  focal point of this image, false otherwise

Example response: {{"dominant_color_tone": "vibrant", "variant_description": "tight close-up, determined expression", "has_expressive_face": true}}
"""


def query_variant_tags(cfg: Config, host: str, headers: dict, image_b64: str) -> dict:
    payload = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": VARIANT_PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                ],
            }
        ],
        "max_tokens": 150,
        "temperature": 0.0,
    }
    resp = requests.post(
        f"{host}/serving-endpoints/{ENDPOINT_NAME}/invocations",
        headers=headers,
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if not match:
        raise ValueError(f"no JSON object found in model response: {content!r}")
    return json.loads(match.group(0))


def run_thumbnail_variant_tagging(cfg: Config, host: str, headers: dict) -> pd.DataFrame:
    subset = select_thumbnail_subset()
    cert_df = pd.read_parquet(TMDB_DIR / "dim_title_certification.parquet")
    print(f"\ngenerating + tagging thumbnail variants for {len(subset)} titles "
          f"({(subset.industry == 'Hollywood').sum()} Hollywood, "
          f"{(subset.industry == 'Bollywood').sum()} Bollywood)")

    rows = []
    for i, row in enumerate(subset.itertuples(), start=1):
        poster_path = POSTER_DIR / f"{row.title_id}.jpg"
        if not poster_path.exists():
            print(f"  [{i}/{len(subset)}] {row.title_id}: no poster file, skipping")
            continue

        try:
            hires_path = fetch_hires_poster(row.title_id, row.poster_path)
        except Exception as e:
            print(f"  [{i}/{len(subset)}] {row.title_id}: hi-res fetch FAILED ({e}), falling back to w500")
            hires_path = poster_path

        variants = generate_variant_images(hires_path, row.title_name, row.title_id, cert_df)
        for variant_id, (img, fallback_desc, face_count) in variants.items():
            out_path = VARIANT_DIR / f"{row.title_id}_{variant_id}.jpg"
            img.save(out_path, "JPEG", quality=90)

            image_b64 = base64.b64encode(out_path.read_bytes()).decode("ascii")
            try:
                tags = query_variant_tags(cfg, host, headers, image_b64)
                dominant_color_tone = tags.get("dominant_color_tone")
                if dominant_color_tone not in DOMINANT_COLOR_TONES:
                    raise ValueError(f"invalid dominant_color_tone: {dominant_color_tone!r}")
                description = tags.get("variant_description") or fallback_desc
                has_expressive_face = bool(tags.get("has_expressive_face", False))
            except Exception as e:
                print(f"    {row.title_id}_{variant_id}: tagging FAILED ({e}), using fallback description")
                dominant_color_tone = None
                description = fallback_desc
                has_expressive_face = False

            rows.append(
                {
                    "title_id": row.title_id,
                    "variant_id": variant_id,
                    "variant_description": description,
                    "dominant_color_tone": dominant_color_tone,
                    "face_count": face_count,
                    "has_expressive_face": has_expressive_face,
                    "tagged_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            print(f"  [{i}/{len(subset)}] {row.title_id}_{variant_id}: "
                  f"{dominant_color_tone} -- {description} (faces={face_count}, expressive={has_expressive_face})")
            time.sleep(SLEEP_BETWEEN_CALLS_SEC)

    return pd.DataFrame(rows)


def run_poster_tagging(cfg: Config, host: str, headers: dict) -> pd.DataFrame:
    subset = select_subset()
    print(f"tagging {len(subset)} titles ({(subset.industry == 'Hollywood').sum()} Hollywood, "
          f"{(subset.industry == 'Bollywood').sum()} Bollywood)")

    rows = []
    failures = []
    for i, row in enumerate(subset.itertuples(), start=1):
        poster_path = POSTER_DIR / f"{row.title_id}.jpg"
        if not poster_path.exists():
            print(f"  [{i}/{len(subset)}] {row.title_id} ({row.title_name}): no poster file, skipping")
            failures.append(row.title_id)
            continue

        image_b64 = base64.b64encode(poster_path.read_bytes()).decode("ascii")
        try:
            tags = validate_tags(query_vision_endpoint(cfg, host, headers, image_b64))
            rows.append(
                {
                    "title_id": row.title_id,
                    "dominant_color_tone": tags["dominant_color_tone"],
                    "composition_style": tags["composition_style"],
                    "emotional_tone": tags["emotional_tone"],
                    "poster_url": f"{TMDB_IMAGE_BASE}{row.poster_path}",
                    # stored as ISO string, not a pandas Timestamp: pandas writes
                    # tz-aware timestamps to parquet at nanosecond precision, which
                    # Spark's Parquet reader rejects (PARQUET_TYPE_ILLEGAL); cast to
                    # TIMESTAMP in the SQL load statement instead.
                    "tagged_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            print(f"  [{i}/{len(subset)}] {row.title_id} ({row.title_name}): {tags}")
        except Exception as e:
            print(f"  [{i}/{len(subset)}] {row.title_id} ({row.title_name}): FAILED - {e}")
            failures.append(row.title_id)

        time.sleep(SLEEP_BETWEEN_CALLS_SEC)

    poster_signals = pd.DataFrame(rows)
    out_path = OUT_DIR / "poster_signals.parquet"
    poster_signals.to_parquet(out_path, index=False)

    print(f"\nposter_signals: {len(poster_signals)} rows -> {out_path}")
    if failures:
        print(f"failed/skipped ({len(failures)}): {failures}")

    return poster_signals


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=["poster", "thumbnail", "all"], default="all")
    args = parser.parse_args()

    cfg = Config()
    headers = cfg.authenticate()
    host = cfg.host if cfg.host.startswith("http") else f"https://{cfg.host}"

    if args.task in ("poster", "all"):
        run_poster_tagging(cfg, host, headers)

    if args.task in ("thumbnail", "all"):
        thumbnail_variant_signals = run_thumbnail_variant_tagging(cfg, host, headers)
        out_path = OUT_DIR / "thumbnail_variant_signals.parquet"
        thumbnail_variant_signals.to_parquet(out_path, index=False)
        print(f"\nthumbnail_variant_signals: {len(thumbnail_variant_signals)} rows -> {out_path}")


if __name__ == "__main__":
    main()
