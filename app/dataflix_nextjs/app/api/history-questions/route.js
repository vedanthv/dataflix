// Tailors the chat page's "Suggested questions" row to this specific
// person's history in this persona, stored in Lakebase. Two layers:
//   1. Baseline (always, no AI): return every plain-text question this user
//      has asked before in this role, across ALL past sessions, so the
//      client can exclude them from ever resurfacing as a suggestion --
//      not just within the current session (see chat page's askedSet).
//   2. Personalized (once there's enough signal): a Databricks-native
//      ai_query call -- the same pattern as /api/followups -- generates a
//      fresh batch of questions that build on the titles/regions/topics
//      this person keeps returning to, instead of the generic static pool
//      in lib/personas.js.

import { getPastUserQuestions } from "../../../lib/lakebase";
import { runSql, sqlEscape } from "../../../lib/databricks";

export const runtime = "nodejs";

const FM_ENDPOINT = "databricks-meta-llama-3-3-70b-instruct";
const MIN_HISTORY_FOR_PERSONALIZATION = 3;

// Casting turns are persisted as structured JSON (see /api/casting), not a
// plain question -- exclude those from both the dedup list and the prompt.
function isPlainQuestion(content) {
  try {
    const parsed = JSON.parse(content);
    return !(parsed && typeof parsed === "object");
  } catch {
    return true;
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const persona = searchParams.get("persona");
    const sessionId = searchParams.get("sessionId");
    if (!persona) return Response.json({ error: "persona is required" }, { status: 400 });

    const userEmail = request.headers.get("x-forwarded-email");
    if (!userEmail) {
      // No identity to key history off of (e.g. local dev without the
      // platform proxy) -- nothing to personalize from yet.
      return Response.json({ pastQuestions: [], suggestions: [] });
    }

    const rawPast = await getPastUserQuestions(persona, userEmail, sessionId, 30);
    const pastQuestions = rawPast.filter(isPlainQuestion);

    if (pastQuestions.length < MIN_HISTORY_FOR_PERSONALIZATION) {
      return Response.json({ pastQuestions, suggestions: [] });
    }

    const prompt = `You are personalizing suggested questions for a "${persona}" persona at a streaming platform's data assistant. Here are questions this specific person has asked before in this role, most recent first:
${pastQuestions.slice(0, 15).map((q, i) => `${i + 1}. ${q}`).join("\n")}

Suggest exactly 4 NEW questions this person would plausibly want to ask next -- build on the same titles, regions, or topics they keep returning to, but do not repeat any question above, even reworded. Stay within a "${persona}" role's business concerns. Each under 18 words, phrased as a direct question, no numbering. Respond with ONLY a JSON object of this exact shape: {"suggestions": ["...", "...", "...", "..."]}`;

    const rows = await runSql(
      `SELECT ai_query(
         '${FM_ENDPOINT}',
         '${sqlEscape(prompt)}',
         responseFormat => '{"type":"json_object"}',
         failOnError => false
       ).result AS suggestions_json`,
      { waitTimeout: "30s" }
    );

    let suggestions = [];
    try {
      const parsed = JSON.parse(rows[0]?.suggestions_json || "{}");
      if (Array.isArray(parsed.suggestions)) {
        suggestions = parsed.suggestions.filter((q) => typeof q === "string" && q.trim()).slice(0, 4);
      }
    } catch {
      suggestions = [];
    }

    return Response.json({ pastQuestions, suggestions });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
