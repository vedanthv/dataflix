"""
Tier 0 / Section 1 — generate synthetic licensing-contract PDFs, one per
title/region row pulled from dataflix.licensing.fact_licensing (so contract
content matches the SQL data exactly -- same terms an eval question or a
Supervisor answer could cross-reference). Fictional rights-holder entities
only, per Section 1's caution against attaching invented legal terms to real
studios/people. Licensee is "Dataflix Streaming, Inc." -- our own fictional
platform, not a real company.

Runs locally: writes HTML to data/raw/docs/contracts/html/, then converts to
PDF via plutoprint (same mechanism as the databricks-unstructured-pdf-generation
skill).

Usage:
  .venv/bin/python notebooks/02a_generate_synthetic_contracts.py
"""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML_DIR = ROOT / "data" / "raw" / "docs" / "contracts" / "html"
PDF_DIR = ROOT / "data" / "raw" / "docs" / "contracts" / "pdf"
HTML_DIR.mkdir(parents=True, exist_ok=True)
PDF_DIR.mkdir(parents=True, exist_ok=True)

LICENSE_TYPE_LABELS = {
    "exclusive_svod": "Exclusive Subscription Video-on-Demand (SVOD)",
    "non_exclusive_svod": "Non-Exclusive Subscription Video-on-Demand (SVOD)",
    "avod": "Advertising-Supported Video-on-Demand (AVOD)",
    "output_deal": "Output Deal (Multi-Title Forward License)",
}

REGION_NAMES = {
    "US": "United States",
    "IN": "India",
    "BR": "Brazil",
    "DE": "Germany",
    "JP": "Japan",
    "UK": "United Kingdom",
}

# (title_id, title_name, genre, region_code, license_type, license_expiry,
#  renewal_cost_estimate, exclusivity_flag, rights_holder)
# Hero rows match the exact SQL rows in fact_licensing for the anchor question.
CONTRACTS = [
    ("movie_969681", "Spider-Man: Brand New Day", "Science Fiction", "US", "avod",
     "2026-10-05", 28944.47, True, "Blue Harbor Studios Licensing"),
    ("movie_1291608", "Dhurandhar", "Action", "IN", "avod",
     "2026-10-03", 27957.27, False, "Silverline Rights Group"),
    ("movie_1558796", "Never Change!", "Comedy", "US", "exclusive_svod",
     "2027-07-09", 61899.89, False, "Silverline Rights Group"),
    ("movie_1288445", "Mutiny", "Action", "BR", "avod",
     "2026-12-05", 188642.50, True, "Cascade Entertainment Holdings"),
    ("movie_950028", "The Invite", "Comedy", "US", "avod",
     "2027-04-22", 95909.30, False, "Harborview Media Licensing"),
    ("movie_1232569", "Pinocchio: Unstrung", "Horror", "BR", "non_exclusive_svod",
     "2027-03-25", 50580.87, True, "Cascade Entertainment Holdings"),
    ("movie_1169516", "Welcome To The Jungle", "Action", "UK", "output_deal",
     "2027-08-15", 128038.71, True, "Northgate Media Partners"),
    ("movie_1698863", "The Odyssey", "Adventure", "US", "avod",
     "2027-02-05", 86131.13, False, "Cascade Entertainment Holdings"),
    ("movie_1416391", "Toaster", "Comedy", "JP", "non_exclusive_svod",
     "2026-11-19", 179924.22, True, "Silverline Rights Group"),
    ("movie_1582770", "Dhurandhar: The Revenge", "Action", "JP", "output_deal",
     "2026-10-24", 14358.58, False, "Blue Harbor Studios Licensing"),
    # --- expanded coverage batch 2, spread across all 6 regions + both industries ---
    ("movie_1368337", "The Odyssey", "Adventure", "UK", "output_deal",
     "2027-05-02", 104958.80, False, "Silverline Rights Group"),
    ("movie_1368337", "The Odyssey", "Adventure", "IN", "exclusive_svod",
     "2027-07-02", 147798.87, True, "Northgate Media Partners"),
    ("movie_1275779", "Disclosure Day", "Science Fiction", "DE", "exclusive_svod",
     "2027-03-05", 30904.90, False, "Cascade Entertainment Holdings"),
    ("movie_1083381", "Backrooms", "Horror", "JP", "output_deal",
     "2027-01-31", 112770.91, False, "Harborview Media Licensing"),
    ("movie_1081003", "Supergirl", "Action", "BR", "exclusive_svod",
     "2027-06-24", 210382.49, False, "Blue Harbor Studios Licensing"),
    ("movie_1081003", "Supergirl", "Action", "JP", "output_deal",
     "2026-10-25", 34238.76, False, "Blue Harbor Studios Licensing"),
    ("movie_454639", "Masters of the Universe", "Action", "IN", "avod",
     "2027-05-06", 243677.27, False, "Ironwood Distribution Co."),
    ("movie_1273221", "Scary Movie", "Comedy", "DE", "exclusive_svod",
     "2026-12-21", 153866.33, True, "Blue Harbor Studios Licensing"),
    ("movie_1084244", "Toy Story 5", "Animation", "BR", "exclusive_svod",
     "2027-04-11", 90923.11, True, "Silverline Rights Group"),
    ("movie_1212763", "Evil Dead Burn", "Horror", "JP", "non_exclusive_svod",
     "2026-10-27", 163173.69, True, "Cascade Entertainment Holdings"),
    ("movie_1284041", "The Last House", "Horror", "UK", "exclusive_svod",
     "2026-09-27", 212429.39, False, "Harborview Media Licensing"),
    ("movie_1284041", "The Last House", "Horror", "IN", "output_deal",
     "2026-12-02", 180020.45, False, "Meridian Content Alliance"),
    ("movie_980431", "Avatar Aang: The Last Airbender", "Animation", "JP", "output_deal",
     "2027-01-14", 221537.67, False, "Silverline Rights Group"),
    ("movie_980431", "Avatar Aang: The Last Airbender", "Animation", "DE", "exclusive_svod",
     "2026-10-01", 36062.38, False, "Silverline Rights Group"),
    ("movie_1389149", "Accused", "Thriller", "BR", "non_exclusive_svod",
     "2027-08-20", 110309.50, True, "Cascade Entertainment Holdings"),
    ("movie_1227739", "Homebound", "Drama", "UK", "output_deal",
     "2027-01-31", 148551.65, True, "Harborview Media Licensing"),
    ("movie_1227739", "Homebound", "Drama", "IN", "non_exclusive_svod",
     "2027-06-29", 10728.96, False, "Meridian Content Alliance"),
    ("movie_1239134", "Bhooth Bangla", "Horror", "US", "avod",
     "2026-09-02", 79185.56, False, "Ironwood Distribution Co."),
    ("movie_1446616", "Tu Yaa Main", "Thriller", "IN", "exclusive_svod",
     "2027-04-01", 168217.66, False, "Northgate Media Partners"),
    ("movie_1446616", "Tu Yaa Main", "Thriller", "UK", "output_deal",
     "2027-04-05", 175217.20, False, "Silverline Rights Group"),
]

TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: Georgia, serif; font-size: 12pt; line-height: 1.5; margin: 1in; color: #111; }}
  h1 {{ font-size: 16pt; text-align: center; margin-bottom: 0.2in; }}
  h2 {{ font-size: 13pt; margin-top: 0.4in; border-bottom: 1px solid #333; padding-bottom: 4px; }}
  .meta {{ text-align: center; color: #555; margin-bottom: 0.5in; }}
  .clause {{ margin: 0.15in 0; }}
  table {{ width: 100%; border-collapse: collapse; margin: 0.2in 0; }}
  td, th {{ border: 1px solid #999; padding: 6px 10px; text-align: left; }}
  .sig {{ margin-top: 0.6in; }}
  .sig-block {{ display: inline-block; width: 45%; vertical-align: top; }}
</style>
</head>
<body>
<h1>CONTENT LICENSE AGREEMENT</h1>
<div class="meta">Agreement Reference: DFX-LIC-{title_id}-{region_code}</div>

<div class="clause">
This Content License Agreement ("Agreement") is entered into by and between
<strong>{rights_holder}</strong> ("Licensor"), a media rights holding entity,
and <strong>Dataflix Streaming, Inc.</strong> ("Licensee"), a digital streaming
platform operator, collectively the "Parties."
</div>

<h2>1. Licensed Content</h2>
<table>
  <tr><th>Title</th><td>{title_name}</td></tr>
  <tr><th>Genre</th><td>{genre}</td></tr>
  <tr><th>Territory</th><td>{region_name} ({region_code})</td></tr>
</table>

<h2>2. Grant of Rights</h2>
<div class="clause">
Licensor hereby grants to Licensee a {exclusivity_word} license, under the
category of <strong>{license_type_label}</strong>, to exhibit, stream, and
otherwise distribute the Licensed Content within the Territory specified in
Section 1, subject to the terms of this Agreement.
</div>
<div class="clause">
{exclusivity_clause}
</div>

<h2>3. Term and Expiry</h2>
<div class="clause">
This Agreement shall remain in effect until <strong>{license_expiry}</strong>
("Expiry Date"), unless earlier terminated in accordance with Section 6.
Licensee shall have the right, but not the obligation, to negotiate a renewal
of this Agreement prior to the Expiry Date.
</div>

<h2>4. Compensation and Renewal Cost</h2>
<div class="clause">
In consideration for the rights granted herein, Licensee shall pay Licensor a
renewal license fee currently estimated at <strong>${renewal_cost_estimate:,.2f}
(USD)</strong> for the subsequent term, subject to good-faith renegotiation at
the time of renewal based on then-current performance and market conditions.
</div>

<h2>5. Reporting</h2>
<div class="clause">
Licensee shall provide Licensor with quarterly viewership summaries for the
Licensed Content within the Territory, including aggregate watch-hours and
completion-rate metrics, for the sole purpose of informing renewal
negotiations under Section 3.
</div>

<h2>6. Termination</h2>
<div class="clause">
Either Party may terminate this Agreement upon material breach by the other
Party that remains uncured for thirty (30) days following written notice.
Upon termination or expiry, Licensee shall remove the Licensed Content from
its platform within the Territory within five (5) business days.
</div>

<h2>7. Representations and Warranties</h2>
<div class="clause">
Licensor represents and warrants that it holds all necessary rights to grant
the license described in Section 2, and that such grant does not infringe
upon the rights of any third party. Licensee represents that it will exhibit
the Licensed Content in accordance with applicable regional content
classification and regulatory requirements for the Territory.
</div>

<h2>8. Miscellaneous</h2>
<div class="clause">
This Agreement constitutes the entire understanding between the Parties with
respect to the Licensed Content and supersedes all prior negotiations. This
Agreement shall be governed by the laws applicable to the Territory of
exhibition. Any amendment must be in writing and signed by both Parties.
</div>

<div class="sig">
  <div class="sig-block">
    <div>_______________________________</div>
    <div>For {rights_holder} (Licensor)</div>
  </div>
  <div class="sig-block">
    <div>_______________________________</div>
    <div>For Dataflix Streaming, Inc. (Licensee)</div>
  </div>
</div>

</body>
</html>
"""


def build_html(row) -> str:
    (title_id, title_name, genre, region_code, license_type, license_expiry,
     renewal_cost_estimate, exclusivity_flag, rights_holder) = row

    if exclusivity_flag:
        exclusivity_word = "exclusive"
        exclusivity_clause = (
            "This license is exclusive within the Territory: Licensor shall not "
            "grant any competing streaming license for the Licensed Content "
            "within the Territory for the duration of this Agreement."
        )
    else:
        exclusivity_word = "non-exclusive"
        exclusivity_clause = (
            "This license is non-exclusive within the Territory: Licensor "
            "reserves the right to license the Licensed Content to other "
            "distributors or platforms within the Territory during the term "
            "of this Agreement."
        )

    return TEMPLATE.format(
        title_id=title_id,
        title_name=title_name,
        genre=genre,
        region_code=region_code,
        region_name=REGION_NAMES[region_code],
        license_type_label=LICENSE_TYPE_LABELS[license_type],
        license_expiry=license_expiry,
        renewal_cost_estimate=renewal_cost_estimate,
        exclusivity_word=exclusivity_word,
        exclusivity_clause=exclusivity_clause,
        rights_holder=rights_holder,
    )


def main():
    for row in CONTRACTS:
        title_id, _, _, region_code = row[0], row[1], row[2], row[3]
        fname = f"{title_id}_{region_code}.html"
        html = build_html(row)
        (HTML_DIR / fname).write_text(html)
        print(f"wrote {fname}")

    print(f"\n{len(CONTRACTS)} HTML contracts written to {HTML_DIR}")
    print("Converting to PDF...")

    pdf_gen = (
        ROOT.parent
        / ".claude"
        / "plugins"
        / "cache"
        / "claude-plugins-official"
        / "databricks"
        / "0.2.12"
        / "skills"
        / "databricks-unstructured-pdf-generation"
        / "scripts"
        / "pdf_generator.py"
    )
    subprocess.run(
        [
            str(ROOT / ".venv" / "bin" / "python"),
            str(pdf_gen),
            "convert",
            "--input",
            str(HTML_DIR),
            "--output",
            str(PDF_DIR),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
