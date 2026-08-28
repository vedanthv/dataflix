// Generates 2-3 contextual follow-up questions for the answer that was just
// shown, so the chat UI can render them right under the message (on their
// own line) as clickable next steps. Deliberately off the Supervisor/Genie
// path entirely -- same reasoning as /api/casting: this is a cheap, single
// ai_query call on a small instruct model, not something that needs
// NL2SQL/tool routing, so it shouldn't compete for the Supervisor's quota.

import { runSql, sqlEscape } from "../../../lib/databricks";

export const runtime = "nodejs";

const FM_ENDPOINT = "databricks-meta-llama-3-3-70b-instruct";

export async function POST(request) {
  try {
    const { persona, question, answer } = await request.json();
    if (!question || !answer) {
      return Response.json({ error: "question and answer are required" }, { status: 400 });
    }

    const prompt = `You are helping a "${persona || "content strategy"}" persona at a streaming platform explore a data assistant. They just asked:
Q: ${question}
A: ${answer.slice(0, 1500)}

Suggest exactly 3 short, natural follow-up questions this person would plausibly ask next -- digging deeper into the same title/topic or a closely related angle (another region, licensing/compliance implications, marketing/casting angle, or trend over time). Each under 16 words, phrased as a direct question, no numbering, no leading dashes. Respond with ONLY a JSON object of this exact shape: {"followups": ["...", "...", "..."]}`;

    const rows = await runSql(
      `SELECT ai_query(
         '${FM_ENDPOINT}',
         '${sqlEscape(prompt)}',
         responseFormat => '{"type":"json_object"}',
         failOnError => false
       ).result AS followups_json`,
      { waitTimeout: "30s" }
    );

    let followups = [];
    try {
      const parsed = JSON.parse(rows[0]?.followups_json || "{}");
      if (Array.isArray(parsed.followups)) {
        followups = parsed.followups.filter((q) => typeof q === "string" && q.trim()).slice(0, 3);
      }
    } catch {
      followups = [];
    }

    return Response.json({ followups });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
