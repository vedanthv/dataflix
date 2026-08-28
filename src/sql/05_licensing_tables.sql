-- dataflix.licensing: Genie Space B (Licensing & Rights)

CREATE TABLE IF NOT EXISTS dataflix.licensing.fact_licensing (
  title_id                STRING NOT NULL,
  region_code             STRING NOT NULL,
  license_type            STRING,
  license_expiry          DATE,
  renewal_cost_estimate   DOUBLE,
  exclusivity_flag        BOOLEAN,
  rights_holder           STRING COMMENT 'fictional entity, per Section 1 caution'
) USING DELTA;
