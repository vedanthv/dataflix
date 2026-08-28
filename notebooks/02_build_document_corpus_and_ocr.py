"""
Tier 0 / Section 3 — extract text from the document corpus and chunk it into
dataflix.docs.doc_chunks, tracked in doc_registry. OCR (/scanned_ocr) is
deferred per Tier 0's explicit scope cut.

Corpus (already uploaded to the volume by this point):
  /ratings_guidelines  — 3 real PDFs (MPA, CBFC x2), source_type=real_public
  /regional_compliance — 2 real PDFs (EU AVMSD, India IT Rules), source_type=real_public
  /contracts           — 10 synthetic PDFs (fictional rights holders), source_type=synthetic

Chunking: ~500 tokens/~50 overlap, approximated via word count (1 token
~= 0.75 words, so ~375 words/chunk with ~40 word overlap) since we don't have
a tokenizer dependency in this local environment.

Usage:
  .venv/bin/python notebooks/02_build_document_corpus_and_ocr.py
"""

import re
import uuid
from pathlib import Path

import pandas as pd
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
REGULATORY_DIR = ROOT / "data" / "raw" / "docs" / "regulatory"
CONTRACTS_DIR = ROOT / "data" / "raw" / "docs" / "contracts" / "pdf"
OUT_DIR = ROOT / "data" / "raw" / "docs"

WORDS_PER_CHUNK = 375  # approximates ~500 tokens
OVERLAP_WORDS = 40  # approximates ~50 tokens

# (filename, doc_type, source_type, volume_subfolder, title_id, region_code)
# title_id/region_code are None for the real regulatory docs (not tied to one title)
REGULATORY_DOCS = [
    ("mpa_classification_rating_rules.pdf", "ratings_guideline", "real_public", "ratings_guidelines", None, "US"),
    ("cbfc_certification_rules_1983.pdf", "ratings_guideline", "real_public", "ratings_guidelines", None, "IN"),
    ("cbfc_certification_rules_2024.pdf", "ratings_guideline", "real_public", "ratings_guidelines", None, "IN"),
    ("eu_avmsd_directive_2010_13_eu.pdf", "regional_compliance", "real_public", "regional_compliance", None, "DE"),
    ("india_it_rules_2021.pdf", "regional_compliance", "real_public", "regional_compliance", None, "IN"),
    ("bbfc_classification_guidelines.pdf", "ratings_guideline", "real_public", "ratings_guidelines", None, "UK"),
    ("brazil_portaria_502_en.pdf", "regional_compliance", "real_public", "regional_compliance", None, "BR"),
    ("brazil_guia_pratico_en.pdf", "ratings_guideline", "real_public", "ratings_guidelines", None, "BR"),
    ("japan_eirin_summary.pdf", "ratings_guideline", "real_public", "ratings_guidelines", None, "JP"),
    ("india_iamai_ott_self_regulation_code.pdf", "regional_compliance", "real_public", "regional_compliance", None, "IN"),
    # brazil_portaria_502_classificacao.pdf and brazil_classind_guia_pratico.pdf (the
    # raw Portuguese originals) are deliberately NOT indexed -- entirely in Portuguese,
    # and the embedding model is English-only. They're uploaded to the volume for
    # provenance (see manifest note). The _en.pdf files above are page-by-page
    # Databricks SQL ai_translate() output of these same two documents, run against
    # the real extracted PDF text -- that's what's actually indexed.
]

# auto-discovered from filenames written by notebooks/02a_generate_synthetic_contracts.py
# (pattern: {title_id}_{region_code}.pdf)
CONTRACT_DOCS = [
    (p.name, "_".join(p.stem.split("_")[:-1]), p.stem.split("_")[-1])
    for p in sorted(CONTRACTS_DIR.glob("*.pdf"))
]


def extract_pages(pdf_path: Path) -> list[str]:
    reader = PdfReader(str(pdf_path))
    return [page.extract_text() or "" for page in reader.pages]


def chunk_pages(pages: list[str]) -> list[dict]:
    """Chunk across page boundaries, tracking the starting page_num per chunk."""
    words_with_page = []
    for page_num, text in enumerate(pages, start=1):
        for w in re.split(r"\s+", text.strip()):
            if w:
                words_with_page.append((w, page_num))

    chunks = []
    i = 0
    n = len(words_with_page)
    step = WORDS_PER_CHUNK - OVERLAP_WORDS
    while i < n:
        window = words_with_page[i : i + WORDS_PER_CHUNK]
        if not window:
            break
        chunk_text = " ".join(w for w, _ in window)
        page_num = window[0][1]
        chunks.append({"chunk_text": chunk_text, "page_num": page_num})
        if i + WORDS_PER_CHUNK >= n:
            break
        i += step
    return chunks


def main():
    doc_registry_rows = []
    doc_chunks_rows = []

    for filename, doc_type, source_type, subfolder, title_id, region_code in REGULATORY_DOCS:
        pdf_path = REGULATORY_DIR / filename
        doc_id = f"doc_{uuid.uuid5(uuid.NAMESPACE_URL, filename).hex[:12]}"
        pages = extract_pages(pdf_path)
        chunks = chunk_pages(pages)

        doc_registry_rows.append(
            {
                "doc_id": doc_id,
                "doc_type": doc_type,
                "is_scanned": False,
                "source_type": source_type,
                "source_path": f"/Volumes/dataflix/docs/raw_documents/{subfolder}/{filename}",
            }
        )
        for idx, c in enumerate(chunks):
            doc_chunks_rows.append(
                {
                    "chunk_id": f"{doc_id}_chunk{idx:03d}",
                    "doc_id": doc_id,
                    "doc_type": doc_type,
                    "title_id": title_id,
                    "region_code": region_code,
                    "source_path": f"/Volumes/dataflix/docs/raw_documents/{subfolder}/{filename}",
                    "chunk_text": c["chunk_text"],
                    "page_num": c["page_num"],
                }
            )
        print(f"{filename}: {len(pages)} pages -> {len(chunks)} chunks")

    for filename, title_id, region_code in CONTRACT_DOCS:
        pdf_path = CONTRACTS_DIR / filename
        doc_id = f"doc_{uuid.uuid5(uuid.NAMESPACE_URL, filename).hex[:12]}"
        pages = extract_pages(pdf_path)
        chunks = chunk_pages(pages)

        doc_registry_rows.append(
            {
                "doc_id": doc_id,
                "doc_type": "contract",
                "is_scanned": False,
                "source_type": "synthetic",
                "source_path": f"/Volumes/dataflix/docs/raw_documents/contracts/{filename}",
            }
        )
        for idx, c in enumerate(chunks):
            doc_chunks_rows.append(
                {
                    "chunk_id": f"{doc_id}_chunk{idx:03d}",
                    "doc_id": doc_id,
                    "doc_type": "contract",
                    "title_id": title_id,
                    "region_code": region_code,
                    "source_path": f"/Volumes/dataflix/docs/raw_documents/contracts/{filename}",
                    "chunk_text": c["chunk_text"],
                    "page_num": c["page_num"],
                }
            )
        print(f"{filename}: {len(pages)} pages -> {len(chunks)} chunks")

    doc_registry = pd.DataFrame(doc_registry_rows)
    doc_chunks = pd.DataFrame(doc_chunks_rows)

    doc_registry.to_parquet(OUT_DIR / "doc_registry.parquet", index=False)
    doc_chunks.to_parquet(OUT_DIR / "doc_chunks.parquet", index=False)

    print(f"\ndoc_registry: {len(doc_registry)} rows -> {OUT_DIR / 'doc_registry.parquet'}")
    print(f"doc_chunks:   {len(doc_chunks)} rows -> {OUT_DIR / 'doc_chunks.parquet'}")
    print(f"\nby source_type:\n{doc_registry.source_type.value_counts()}")
    print(f"\nby doc_type:\n{doc_registry.doc_type.value_counts()}")


if __name__ == "__main__":
    main()
