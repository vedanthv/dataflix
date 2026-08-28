import { getSessionHistory } from "../../../../lib/lakebase";

export const runtime = "nodejs";

// Full turn-by-turn history for one session, used to hydrate the chat page
// when a user resumes a past conversation from the history drawer.
export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const messages = await getSessionHistory(id);
    return Response.json({ messages });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
