-- dataflix.core: canonical dimensions shared by every Genie Space (name resolution only)

CREATE TABLE IF NOT EXISTS dataflix.core.dim_title (
  title_id           STRING NOT NULL COMMENT 'TMDB-derived PK, format {movie|tv}_{tmdb_id}',
  title_name         STRING,
  genre              STRING,
  content_type       STRING COMMENT 'movie | tv',
  release_date       DATE,
  original_language  STRING,
  industry           STRING COMMENT 'Hollywood | Bollywood',
  poster_path        STRING COMMENT 'TMDB poster_path, joins to local/volume poster image',
  vote_average       DOUBLE COMMENT 'real TMDB signal, not fabricated',
  vote_count         BIGINT COMMENT 'real TMDB signal, not fabricated',
  popularity         DOUBLE COMMENT 'real TMDB signal, not fabricated',
  CONSTRAINT dim_title_pk PRIMARY KEY (title_id)
) USING DELTA;

CREATE TABLE IF NOT EXISTS dataflix.core.dim_actor (
  actor_id    BIGINT NOT NULL COMMENT 'TMDB person id',
  actor_name  STRING,
  popularity  DOUBLE,
  CONSTRAINT dim_actor_pk PRIMARY KEY (actor_id)
) USING DELTA;

CREATE TABLE IF NOT EXISTS dataflix.core.title_cast (
  title_id       STRING NOT NULL,
  actor_id       BIGINT NOT NULL,
  billing_order  INT
) USING DELTA;

CREATE TABLE IF NOT EXISTS dataflix.core.dim_region (
  region_code  STRING NOT NULL COMMENT 'US | IN | BR | DE | JP | UK',
  region_name  STRING,
  CONSTRAINT dim_region_pk PRIMARY KEY (region_code)
) USING DELTA;

-- REAL data: current streaming availability per title/region, JustWatch data
-- via TMDB's free watch/providers endpoint. Not fabricated. Referenced by
-- fact_licensing for real-world context alongside Dataflix's own (synthetic)
-- internal license terms -- these are two different concepts, not merged.
CREATE TABLE IF NOT EXISTS dataflix.core.real_watch_providers (
  title_id       STRING NOT NULL,
  region_code    STRING NOT NULL,
  provider_name  STRING,
  offer_type     STRING COMMENT 'flatrate | rent | buy | free | ads'
) USING DELTA;

-- REAL data: official content certification per title/region (MPAA/CBFC/etc-style
-- ratings), via TMDB's free release_dates (movies) / content_ratings (tv)
-- endpoints. Not fabricated. Feeds the Compliance Risk Scanner: cross-referenced
-- against the real regulatory PDFs in the Document Agent corpus (Section 3).
CREATE TABLE IF NOT EXISTS dataflix.core.dim_title_certification (
  title_id       STRING NOT NULL,
  region_code    STRING NOT NULL,
  certification  STRING COMMENT 'e.g. PG-13, U/A 13+, TV-MA, 18 -- format varies by country'
) USING DELTA;
