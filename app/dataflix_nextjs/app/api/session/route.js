import { createSession } from "../../../lib/lakebase";

export const runtime = "nodejs";

// Creates one Lakebase session row per chat-page visit so every turn can be
// tagged and persisted for history -- see lib/lakebase.js. Best-effort: if
// Lakebase is unreachable, the chat UI still works, it just runs without a
// server-side session id (route.js's addMessage calls are all try/caught).
export async function POST(request) {
  try {
    const { persona } = await request.json();
    if (!persona || typeof persona !== "string") {
      return Response.json({ error: "persona is required" }, { status: 400 });
    }
    // Injected by the Databricks Apps platform proxy for every request --
    // every visitor is already SSO-authenticated to reach the app at all
    // (see the databricks-apps skill), so this is reliable in production.
    // Absent in local dev, where sessions just fall back to anonymous.
    const userEmail = request.headers.get("x-forwarded-email");
    const sessionId = await createSession(persona, userEmail);
    return Response.json({ sessionId });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
