-- dataflix.competitive: Genie Space F (Competitive Catalog)

CREATE TABLE IF NOT EXISTS dataflix.competitive.fact_competitive_catalog (
  title_id                 STRING NOT NULL,
  competitor_platform      STRING,
  exclusivity_status       STRING,
  competitor_release_date  DATE
) USING DELTA;
