import { listSessions } from "../../../lib/lakebase";

export const runtime = "nodejs";

// Backs the chat page's history drawer -- lists this persona's past
// sessions (each with a preview of its first question) so a user can resume
// one instead of starting cold every visit.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const persona = searchParams.get("persona");
    if (!persona) return Response.json({ error: "persona is required" }, { status: 400 });
    const userEmail = request.headers.get("x-forwarded-email");
    const sessions = await listSessions(persona, userEmail);
    return Response.json({ sessions });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
