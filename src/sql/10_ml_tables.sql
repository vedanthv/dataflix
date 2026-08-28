-- dataflix.ml: offline anomaly detection output (Section 4) + demo query cache (Section 5)

CREATE TABLE IF NOT EXISTS dataflix.ml.anomaly_scores (
  title_id                    STRING NOT NULL,
  region_code                 STRING NOT NULL,
  snapshot_week                DATE NOT NULL,
  wow_completion_rate_change   DOUBLE,
  wow_watch_hours_change       DOUBLE,
  anomaly_score                DOUBLE COMMENT 'IsolationForest decision_function, normalized 0-1',
  likely_driver                STRING COMMENT 'support_ticket_spike | competitive_pressure | engagement_pattern_unexplained',
  computed_at                  TIMESTAMP
) USING DELTA;

CREATE TABLE IF NOT EXISTS dataflix.ml.demo_query_cache (
  question    STRING NOT NULL,
  persona     STRING,
  answer      STRING,
  sources     STRING COMMENT 'JSON array of tool/source names used to answer',
  cached_at   TIMESTAMP
) USING DELTA;
