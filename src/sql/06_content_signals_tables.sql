-- dataflix.content_signals: Genie Space C (Content Signals), dual-homed with marketing
-- via thumbnail_variant_signals (see 09_marketing_tables.sql). Populated by
-- notebooks/04_multimodal_tagging_job.py (Section 4).

CREATE TABLE IF NOT EXISTS dataflix.content_signals.poster_signals (
  title_id             STRING NOT NULL,
  dominant_color_tone  STRING,
  composition_style     STRING,
  emotional_tone       STRING,
  poster_url           STRING,  -- real TMDB image CDN URL, https://image.tmdb.org/t/p/w185{poster_path} (thumbnail size, for inline chat display)
  tagged_at            TIMESTAMP
) USING DELTA;

-- subtitle_signals cut, 2026-08-23 -- see PLAN.md Section 4's scope-cut note
-- (no clean real data source, low demo value against the credential/coverage cost).

-- variant_id is one of 'face_closeup' | 'dramatic_regrade' | 'text_overlay' (see
-- notebooks/04_multimodal_tagging_job.py task 2 -- 3 variant types grounded in
-- Netflix's published artwork A/B-testing findings, not a generic v1/v2/v3).
CREATE TABLE IF NOT EXISTS dataflix.content_signals.thumbnail_variant_signals (
  title_id             STRING NOT NULL,
  variant_id           STRING NOT NULL,
  variant_description  STRING,
  dominant_color_tone  STRING,
  face_count           INT,      -- real OpenCV YuNet face-detection count on this variant
  has_expressive_face  BOOLEAN,  -- real vision-FM judgment; both feed Netflix's "fewer people + expressive faces perform better" pattern into fact_campaign_performance
  variant_image_url    STRING,  -- synthetic derivative, no public CDN -- served as a static asset from the dataflix-nextjs app itself, https://dataflix-nextjs-835205684191882.aws.databricksapps.com/thumbnails/{title_id}_{variant_id}.jpg
  tagged_at            TIMESTAMP
) USING DELTA;
