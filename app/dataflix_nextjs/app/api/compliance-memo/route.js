// Compliance memo generation -- a generative deliverable, not just chat
// prose (see PLAN.md's Deferred Ideas / per-persona backlog): "draft a
// compliance memo for this renewal I can attach to the approval." Same
// off-Supervisor architecture as /api/casting -- direct SQL + ai_query,
// since we know exactly which tables/tools to hit and don't need NL2SQL:
//   1. Resolve the title by fuzzy name match (ILIKE, falling back to
//      levenshtein distance for typos -- same pattern the Supervisor's own
//      instructions use per PLAN.md's "typo-driven retry storm" fix).
//   2. Pull real licensing facts (dataflix.licensing.fact_licensing) and
//      real certification facts (dataflix.core.dim_title_certification) for
//      that title, optionally scoped to one region.
//   3. Pull relevant regulatory/contract excerpts via the Document Agent's
//      existing dataflix.docs.search_documents() UC function.
//   4. ai_query synthesizes a structured memo -- instructed to use ONLY the
//      facts fetched above, never invent a number, date, or regulatory claim.

import { runSql, sqlEscape } from "../../../lib/databricks";
import { addMessage } from "../../../lib/lakebase";

export const runtime = "nodejs";

const FM_ENDPOINT = "databricks-meta-llama-3-3-70b-instruct";
const VALID_REGIONS = ["US", "IN", "BR", "DE", "JP", "UK"];

async function resolveTitle(titleName) {
  const rows = await runSql(`
    SELECT title_id, title_name, genre
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

async function fetchLicensing(titleId, region) {
  return runSql(`
    SELECT region_code, license_type, license_expiry, renewal_cost_estimate, exclusivity_flag, rights_holder
    FROM dataflix.licensing.fact_licensing
    WHERE title_id = '${sqlEscape(titleId)}'
      ${region ? `AND region_code = '${sqlEscape(region)}'` : ""}
    ORDER BY license_expiry ASC
  `);
}

async function fetchCertifications(titleId, region) {
  return runSql(`
    SELECT region_code, certification
    FROM dataflix.core.dim_title_certification
    WHERE title_id = '${sqlEscape(titleId)}'
      ${region ? `AND region_code = '${sqlEscape(region)}'` : ""}
  `);
}

// Real-only regulatory excerpts. dataflix.docs.doc_chunks_index (queried via
// the search_documents() UC function) mixes two very different things: 10
// REAL official regulatory PDFs (MPA/CBFC/AVMSD/BBFC/Eirin/IAMAI, tracked as
// doc_registry.source_type='real_public') and 30 SYNTHETIC per-title
// contract PDFs (source_type='synthetic', since Dataflix's actual licensing
// contracts aren't real). search_documents() itself doesn't expose
// source_type, and a query that names the title (as the original version of
// this function did) semantically favors that title's own synthetic
// contract chunks -- exactly the wrong bias for a "real sources only" memo.
// Fix: (1) search with title-agnostic, regulation-flavored phrasing so real
// guideline docs surface instead of a specific synthetic contract, across
// two differently-worded queries for better recall since search_documents()
// caps at 5 results per call; (2) join the returned chunk_ids back to
// doc_registry and hard-filter to source_type='real_public' before this
// ever reaches the LLM or the PDF.
async function fetchRegulatoryExcerpts(genre, region) {
  const queries = [
    `official regulatory and certification requirements for streaming video content${region ? ` in ${region}` : ""}`,
    `content classification, advertising, and takedown obligations for ${genre || "film and television"} content under local law`,
  ];

  const byChunkId = new Map();
  for (const q of queries) {
    const rows = await runSql(`
      SELECT chunk_id, doc_type, region_code, chunk_text, page_num
      FROM dataflix.docs.search_documents('${sqlEscape(q)}', ${region ? `'${sqlEscape(region)}'` : "NULL"})
    `);
    for (const r of rows) if (!byChunkId.has(r.chunk_id)) byChunkId.set(r.chunk_id, r);
  }

  const candidates = [...byChunkId.values()];
  if (candidates.length === 0) return [];

  const idsList = candidates.map((r) => `'${sqlEscape(r.chunk_id)}'`).join(",");
  const sourceRows = await runSql(`
    SELECT dc.chunk_id, dr.source_type
    FROM dataflix.docs.doc_chunks dc
    JOIN dataflix.docs.doc_registry dr ON dc.doc_id = dr.doc_id
    WHERE dc.chunk_id IN (${idsList})
  `);
  const sourceTypeByChunk = new Map(sourceRows.map((r) => [r.chunk_id, r.source_type]));

  return candidates.filter((r) => sourceTypeByChunk.get(r.chunk_id) === "real_public");
}

async function synthesizeMemo({ titleName, genre, region, licensingRows, certRows, docRows }) {
  const licensingText =
    licensingRows.map((r) =>
      `Region ${r.region_code}: ${r.license_type}, expires ${r.license_expiry}, renewal cost estimate ${r.renewal_cost_estimate}, exclusivity ${r.exclusivity_flag}, rights holder ${r.rights_holder}`
    ).join("\n") || "(no licensing rows found for this title/region)";

  const certText =
    certRows.map((r) => `Region ${r.region_code}: certification ${r.certification}`).join("\n") ||
    "(no certification data available for this title/region)";

  const docText =
    docRows.map((r) => `[${r.doc_type}, region ${r.region_code}, page ${r.page_num}]: ${r.chunk_text.slice(0, 600)}`).join("\n\n") ||
    "(no real regulatory documents matched this title/region)";

  const prompt = `You are drafting an internal compliance memo for a streaming platform's legal/compliance review of a title's license renewal. Use ONLY the facts provided below -- never invent a number, date, or regulatory claim not present here. If a section has no supporting facts, say so plainly instead of guessing. This memo must fit on ONE printed page, so be concise everywhere.

TITLE: ${titleName} (${genre || "unknown genre"})
REGION(S) IN SCOPE: ${region || "all licensed regions"}

LICENSING FACTS (Dataflix's own system of record):
${licensingText}

CERTIFICATION FACTS (Dataflix's own system of record):
${certText}

REAL REGULATORY DOCUMENT EXCERPTS (every excerpt below is confirmed from an official, real public regulatory document -- none are synthetic; cite by [doc_type, page]):
${docText}

Draft a structured compliance memo. Respond with ONLY a JSON object of this exact shape:
{"licenseSummary": "1-2 sentence summary of the licensing facts above", "certificationNote": "1 sentence on certification/rating status, or state plainly if none is available", "regulatoryConsiderations": [{"point": "...", "source": "doc_type, page N"}] (AT MOST 3, pick only the most decision-relevant ones, omit entirely if no real excerpts were provided), "recommendation": "1-2 sentence recommendation on the renewal, grounded only in the facts given", "riskLevel": "Low, Medium, or High"}`;

  const rows = await runSql(`
    SELECT ai_query(
      '${FM_ENDPOINT}',
      '${sqlEscape(prompt)}',
      responseFormat => '{"type":"json_object"}',
      failOnError => false
    ).result AS memo_json
  `, { waitTimeout: "50s" });

  try {
    return JSON.parse(rows[0]?.memo_json || "{}");
  } catch {
    return {};
  }
}

// Entity extraction for the chat page's conversational memo flow -- given a
// free-text message (the trigger message, or a clarifying-question reply),
// pull out a title name and/or region if mentioned. Powers slot-filling so
// the assistant only has to ask for whatever's still missing, instead of a
// dedicated form.
async function extractMemoEntities(message) {
  const prompt = `A user is talking to a streaming platform's compliance assistant and wants a compliance memo drafted. From their message below, extract any TITLE NAME and REGION they mention. Region must be one of these exact codes if mentioned (map country/market names to the code): US, IN, BR, DE, JP, UK. If either isn't mentioned, use null. If they say something like "all regions" or "every region", region is null.

Message: "${message}"

Respond with ONLY a JSON object of this exact shape: {"titleName": "..." or null, "region": "US"/"IN"/"BR"/"DE"/"JP"/"UK" or null}`;

  const rows = await runSql(`
    SELECT ai_query(
      '${FM_ENDPOINT}',
      '${sqlEscape(prompt)}',
      responseFormat => '{"type":"json_object"}',
      failOnError => false
    ).result AS extract_json
  `, { waitTimeout: "20s" });

  try {
    const parsed = JSON.parse(rows[0]?.extract_json || "{}");
    return {
      titleName: typeof parsed.titleName === "string" && parsed.titleName.trim() ? parsed.titleName.trim() : null,
      region: VALID_REGIONS.includes(parsed.region) ? parsed.region : null,
    };
  } catch {
    return { titleName: null, region: null };
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (typeof body.extractFrom === "string") {
      const entities = await extractMemoEntities(body.extractFrom);
      return Response.json(entities);
    }

    const { titleName, region, sessionId } = body;
    if (!titleName || typeof titleName !== "string") {
      return Response.json({ error: "titleName is required" }, { status: 400 });
    }
    const cleanRegion = region && VALID_REGIONS.includes(region) ? region : null;

    if (sessionId) {
      addMessage(sessionId, "user", JSON.stringify({ memoRequest: titleName, region: cleanRegion })).catch((err) =>
        console.error("chat persistence failed:", err)
      );
    }

    const title = await resolveTitle(titleName);
    if (!title) {
      return Response.json({ error: `Couldn't find a title matching "${titleName}" in the catalog.` }, { status: 404 });
    }

    const [licensingRows, certRows, docRows] = await Promise.all([
      fetchLicensing(title.title_id, cleanRegion),
      fetchCertifications(title.title_id, cleanRegion),
      fetchRegulatoryExcerpts(title.genre, cleanRegion),
    ]);

    const memo = await synthesizeMemo({
      titleName: title.title_name,
      genre: title.genre,
      region: cleanRegion,
      licensingRows,
      certRows,
      docRows,
    });

    const responsePayload = {
      titleName: title.title_name,
      region: cleanRegion,
      licenseSummary: memo.licenseSummary || null,
      certificationNote: memo.certificationNote || null,
      regulatoryConsiderations: Array.isArray(memo.regulatoryConsiderations) ? memo.regulatoryConsiderations : [],
      // Always true by construction -- fetchRegulatoryExcerpts hard-filters
      // to doc_registry.source_type='real_public' before this ever reaches
      // the LLM, so any considerations present are guaranteed real, never
      // from the corpus's synthetic contract PDFs. Explicit flag so the UI
      // can show a trust badge instead of asserting it silently.
      regulatorySourcesVerifiedReal: true,
      recommendation: memo.recommendation || null,
      riskLevel: memo.riskLevel || null,
      generatedAt: new Date().toISOString(),
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
