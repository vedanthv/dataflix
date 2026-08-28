-- dataflix.marketing: Genie Space G (Marketing Campaign Performance)
-- joins to content_signals.thumbnail_variant_signals via thumbnail_variant_id
-- (that table lives in content_signals, see 06_content_signals_tables.sql;
-- Genie Space G is granted cross-schema SELECT on it rather than duplicating it)

CREATE TABLE IF NOT EXISTS dataflix.marketing.fact_campaign_performance (
  campaign_id           STRING NOT NULL,
  title_id              STRING,
  region_code           STRING,
  thumbnail_variant_id  STRING,
  spend                 DOUBLE,
  impressions           BIGINT,
  ctr                   DOUBLE,
  conversion_rate       DOUBLE
) USING DELTA;
