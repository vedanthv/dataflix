-- dataflix.engagement: Genie Space A (Engagement & Catalog)

CREATE TABLE IF NOT EXISTS dataflix.engagement.fact_engagement (
  title_id           STRING NOT NULL,
  region_code        STRING NOT NULL,
  snapshot_week      DATE NOT NULL,
  watch_hours        DOUBLE,
  completion_rate    DOUBLE,
  day_1_retention    DOUBLE
) USING DELTA;
