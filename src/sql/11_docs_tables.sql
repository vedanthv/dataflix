-- dataflix.docs: Document Agent / Knowledge Assistant corpus (Section 3)

CREATE VOLUME IF NOT EXISTS dataflix.docs.raw_documents;

CREATE TABLE IF NOT EXISTS dataflix.docs.doc_registry (
  doc_id        STRING NOT NULL,
  doc_type      STRING,
  is_scanned    BOOLEAN,
  source_type   STRING COMMENT 'real_public | synthetic',
  source_path   STRING,
  ingested_at   TIMESTAMP,
  CONSTRAINT doc_registry_pk PRIMARY KEY (doc_id)
) USING DELTA;

CREATE TABLE IF NOT EXISTS dataflix.docs.doc_chunks (
  chunk_id      STRING NOT NULL,
  doc_id        STRING NOT NULL,
  doc_type      STRING,
  title_id      STRING,
  region_code   STRING,
  source_path   STRING,
  chunk_text    STRING,
  page_num      INT,
  CONSTRAINT doc_chunks_pk PRIMARY KEY (chunk_id)
) USING DELTA;
