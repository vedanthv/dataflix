// Contract auto-ingestion (PLAN.md Deferred Ideas): a user uploads a real
// signed contract PDF, ai_parse_document extracts the licensing terms, and
// they're written straight into dataflix.licensing.fact_licensing -- no
// manual data-entry step. Same off-Supervisor architecture as /api/casting
// and /api/compliance-memo (direct SQL + ai_query, since we know exactly
// which fields/table this needs, no NL2SQL ambiguity):
//   1. ai_parse_document -- extract text from the uploaded contract PDF
//      (uploaded to a UC Volume first via the Files API, same pattern as
//      casting's script uploads, but its own volume/path so these uploads
//      never mix into the Document Agent's search corpus).
//   2. ai_extract -- pull title name, territory, license type (constrained
//      to the real controlled-vocab values already in fact_licensing),
//      exclusivity, expiry date, renewal cost, and rights holder.
//   3. Resolve the title by fuzzy name match against dim_title (same
//      ILIKE/levenshtein pattern as the compliance-memo route).
//   4. MERGE INTO fact_licensing keyed on (title_id, region_code) -- a
//      re-uploaded renewal contract for an already-licensed title/region
//      should update those terms, not create a duplicate row; a title not
//      yet licensed in that region gets a new row.

import { runSql, sqlEscape, uploadToVolume } from "../../../lib/databricks";
import { addMessage } from "../../../lib/lakebase";

export const runtime = "nodejs";

const FM_ENDPOINT = "databricks-meta-llama-3-3-70b-instruct";
const CONTRACTS_VOLUME_PATH = "/Volumes/dataflix/licensing/raw_documents/uploaded_contracts";
const VALID_REGIONS = ["US", "IN", "BR", "DE", "JP", "UK"];

function safeFilename(name) {
  return (name || "contract.pdf").replace(/[^a-zA-Z0-9_.-]/g, "_");
}

async function fetchRealLicenseTypes() {
  const rows = await runSql("SELECT DISTINCT license_type FROM dataflix.licensing.fact_licensing ORDER BY license_type");
  return rows.map((r) => r.license_type);
}

async function extractContractTerms(volumeFilePath, realLicenseTypes) {
  const schema = JSON.stringify({
    title_name: { type: "string" },
    region_code: { type: "enum", labels: VALID_REGIONS },
    license_type: { type: "enum", labels: realLicenseTypes },
    exclusivity_flag: { type: "boolean" },
    license_expiry: { type: "string" },
    renewal_cost_estimate: { type: "number" },
    rights_holder: { type: "string" },
  });

  const rows = await runSql(`
    WITH parsed AS (
      SELECT ai_parse_document(content, map('version','2.0')) AS parsed
      FROM read_files('${sqlEscape(volumeFilePath)}', format => 'binaryFile')
    ),
    txt AS (
      SELECT concat_ws('\\n', transform(variant_get(parsed, '$.document.elements', 'ARRAY<VARIANT>'), e -> e:content::STRING)) AS text_blocks
      FROM parsed
    ),
    extracted AS (
      SELECT text_blocks,
             ai_extract(
               text_blocks,
               '${sqlEscape(schema)}',
               map(
                 'version', '2.0',
                 'instructions', 'This is a signed content licensing contract between a rights holder and a streaming platform. Extract the licensed title name, the territory/region it covers (as a region code), the license type/category, whether the grant is exclusive (true) or non-exclusive (false) within the territory, the agreement expiry/end date in YYYY-MM-DD format, the renewal cost or license fee as a plain number with no currency symbols or commas, and the name of the rights-holder/licensor party.'
               )
             ) AS extraction
      FROM txt
    )
    SELECT
      length(text_blocks) AS text_len,
      extraction:response:title_name::STRING AS title_name,
      extraction:response:region_code::STRING AS region_code,
      extraction:response:license_type::STRING AS license_type,
      extraction:response:exclusivity_flag::STRING AS exclusivity_flag,
      extraction:response:license_expiry::STRING AS license_expiry,
      extraction:response:renewal_cost_estimate::STRING AS renewal_cost_estimate,
      extraction:response:rights_holder::STRING AS rights_holder,
      extraction:error_message::STRING AS extract_error
    FROM extracted
  `, { waitTimeout: "50s" });

  const row = rows[0];
  if (!row || Number(row.text_len) < 100) {
    throw new Error("Couldn't extract readable text from this PDF.");
  }
  if (row.extract_error) throw new Error(`Contract analysis failed: ${row.extract_error}`);
  if (!row.title_name) throw new Error("Couldn't find a title name in this contract.");
  if (!row.region_code || !VALID_REGIONS.includes(row.region_code)) {
    throw new Error("Couldn't determine a valid licensed territory for this contract.");
  }
  if (!row.license_type || !realLicenseTypes.includes(row.license_type)) {
    throw new Error("Couldn't determine a valid license type for this contract.");
  }
  const licenseExpiry = /^\d{4}-\d{2}-\d{2}$/.test(row.license_expiry || "") ? row.license_expiry : null;
  if (!licenseExpiry) throw new Error("Couldn't find a valid expiry date in this contract.");
  const renewalCost = Number(row.renewal_cost_estimate);
  if (!Number.isFinite(renewalCost)) throw new Error("Couldn't find a valid renewal cost in this contract.");

  return {
    titleName: row.title_name,
    regionCode: row.region_code,
    licenseType: row.license_type,
    exclusivityFlag: row.exclusivity_flag === "true",
    licenseExpiry,
    renewalCostEstimate: renewalCost,
    rightsHolder: row.rights_holder || null,
  };
}

async function resolveTitle(titleName) {
  const rows = await runSql(`
    SELECT title_id, title_name
    FROM dataflix.core.dim_title
    WHERE title_name ILIKE '%${sqlEscape(titleName)}%'
       OR levenshtein(lower(title_name), lower('${sqlEscape(titleName)}')) <= 5
    ORDER BY
      CASE WHEN title_name ILIKE '%${sqlEscape(titleName)}%' THEN 0 ELSE 1 END,
      levenshtein(lower(title_name), lower('${sqlEscape(titleName)}'))
    LIMIT 1
  `);
  return rows[0] || null;
}

// Existing row (if any) for this title/region -- fetched before the MERGE so
// the response can tell the user whether this was a fresh license or a
// renewal, and show what changed.
async function fetchExistingLicense(titleId, regionCode) {
  const rows = await runSql(`
    SELECT license_type, license_expiry, renewal_cost_estimate, exclusivity_flag, rights_holder
    FROM dataflix.licensing.fact_licensing
    WHERE title_id = '${sqlEscape(titleId)}' AND region_code = '${sqlEscape(regionCode)}'
  `);
  return rows[0] || null;
}

async function upsertLicense(titleId, terms) {
  await runSql(`
    MERGE INTO dataflix.licensing.fact_licensing AS target
    USING (SELECT
      '${sqlEscape(titleId)}' AS title_id,
      '${sqlEscape(terms.regionCode)}' AS region_code,
      '${sqlEscape(terms.licenseType)}' AS license_type,
      DATE '${sqlEscape(terms.licenseExpiry)}' AS license_expiry,
      ${terms.renewalCostEstimate} AS renewal_cost_estimate,
      ${terms.exclusivityFlag ? "true" : "false"} AS exclusivity_flag,
      ${terms.rightsHolder ? `'${sqlEscape(terms.rightsHolder)}'` : "NULL"} AS rights_holder
    ) AS source
    ON target.title_id = source.title_id AND target.region_code = source.region_code
    WHEN MATCHED THEN UPDATE SET
      license_type = source.license_type,
      license_expiry = source.license_expiry,
      renewal_cost_estimate = source.renewal_cost_estimate,
      exclusivity_flag = source.exclusivity_flag,
      rights_holder = source.rights_holder
    WHEN NOT MATCHED THEN INSERT (title_id, region_code, license_type, license_expiry, renewal_cost_estimate, exclusivity_flag, rights_holder)
    VALUES (source.title_id, source.region_code, source.license_type, source.license_expiry, source.renewal_cost_estimate, source.exclusivity_flag, source.rights_holder)
  `);
}

export async function POST(request) {
  try {
    const { contractPdfBase64, filename, userNote, sessionId } = await request.json();
    if (!contractPdfBase64) {
      return Response.json({ error: "contractPdfBase64 is required" }, { status: 400 });
    }

    if (sessionId) {
      addMessage(sessionId, "user", JSON.stringify({ attachment: filename, note: userNote || "" })).catch((err) =>
        console.error("chat persistence failed:", err)
      );
    }

    const fname = safeFilename(filename);
    const volumeFilePath = `${CONTRACTS_VOLUME_PATH}/${Date.now()}_${fname}`;
    await uploadToVolume(volumeFilePath, Buffer.from(contractPdfBase64, "base64"));

    const realLicenseTypes = await fetchRealLicenseTypes();
    const terms = await extractContractTerms(volumeFilePath, realLicenseTypes);

    const title = await resolveTitle(terms.titleName);
    if (!title) {
      return Response.json({ error: `Couldn't find a title matching "${terms.titleName}" in the catalog.` }, { status: 404 });
    }

    const existing = await fetchExistingLicense(title.title_id, terms.regionCode);
    await upsertLicense(title.title_id, terms);

    const responsePayload = {
      filename,
      userNote: userNote || null,
      titleName: title.title_name,
      regionCode: terms.regionCode,
      wasRenewal: !!existing,
      previous: existing,
      updated: {
        licenseType: terms.licenseType,
        licenseExpiry: terms.licenseExpiry,
        renewalCostEstimate: terms.renewalCostEstimate,
        exclusivityFlag: terms.exclusivityFlag,
        rightsHolder: terms.rightsHolder,
      },
    };

    if (sessionId) {
      addMessage(sessionId, "assistant", JSON.stringify(responsePayload)).catch((err) =>
        console.error("chat persistence failed:", err)
      );
    }

    return Response.json(responsePayload);
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
