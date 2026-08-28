-- dataflix.support: Genie Space E (Support Signal)

CREATE TABLE IF NOT EXISTS dataflix.support.fact_support_tickets (
  ticket_id    STRING NOT NULL,
  title_id     STRING,
  region_code  STRING,
  category     STRING,
  volume       INT,
  ticket_date  DATE
) USING DELTA;
