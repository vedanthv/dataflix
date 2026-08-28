// Server-side route handler — does the SAME thing as the Streamlit app's
// query_supervisor() function, just in Node: OAuth client-credentials
// exchange using the app's auto-injected service-principal creds, then a
// REST call to the Supervisor Agent's serving endpoint.

import { addMessage } from "../../../lib/lakebase";

export const runtime = "nodejs";

function normalizeHost(host) {
  return host.startsWith("http") ? host : `https://${host}`;
}

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) return cachedToken;

  const host = normalizeHost(process.env.DATABRICKS_HOST);
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const resp = await fetch(`${host}/oidc/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "all-apis",
    }),
  });

  if (!resp.ok) {
    throw new Error(`OAuth token exchange failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = now + (data.expires_in - 60) * 1000; // refresh 60s early
  return cachedToken;
}

// The Supervisor's own SSE stream (Responses-API-shaped) emits two kinds of
// event we care about:
//   response.output_text.delta   -- real token-by-token model output. Every
//     narration/answer message streams this way, keyed by item_id/step.
//   response.output_item.done    -- fires for EVERY item, but for text
//     messages it's just a full-text echo of what deltas already sent (so we
//     ignore it for those); for function_call items there are NO preceding
//     deltas at all (harness-injected, not model-generated), so .done is the
//     only signal we get that a tool is being called. Harness-injected
//     "<name>toolname</name>" marker messages and raw tool-result tables
//     behave the same way (.done only, no deltas) -- we don't forward those,
//     since re-narrating raw pipe-table dumps isn't useful to the user, but
//     we DO surface the tool_call event so the UI can show live progress.
//
// We re-emit a much simpler protocol to the browser: {type:"text",delta} and
// {type:"tool_call",name} and {type:"done"}/{type:"error"}.
//
// IMPORTANT: a Genie tool call can take ~20s of real work with ZERO bytes
// emitted upstream during that gap (deltas only cover model-generated text,
// not the tool round-trip itself). A pull()-per-read design sends nothing to
// the browser during that gap -- and some proxy layer between the browser
// and this app (found this the hard way) has an idle-connection timeout
// shorter than that, which silently kills the stream mid-flight with no
// error surfaced to either side. Fix: race each read against a heartbeat
// timer and emit an SSE comment line (ignored by the client's `data: `
// parser, but real bytes on the wire) to keep the connection alive.
const HEARTBEAT_MS = 8000;

function relayToSimpleSSE(upstreamBody, onDone) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  // The Supervisor streams pre-tool-call narration (e.g. "I'll query the
  // engagement data...") as one output item, then the final synthesized
  // answer as a SEPARATE output item with a different item_id -- each with
  // its own delta stream. We forward deltas as they arrive with no boundary
  // marker, so without this the two runs together with zero separation
  // ("...Dataflix.Dataflix has 100 movies..."). Insert a paragraph break
  // whenever a new text item_id starts (but not before the very first one).
  let lastTextItemId = null;
  // Accumulated purely for Lakebase session-history persistence (onDone) --
  // not used for anything sent to the browser, which already gets its own
  // copy via the per-delta "text"/"tool_call" events below.
  let fullText = "";
  const toolCallNames = [];

  return new ReadableStream({
    async start(controller) {
      let readPromise = reader.read();

      while (true) {
        let heartbeatTimer;
        const heartbeat = new Promise((resolve) => {
          heartbeatTimer = setTimeout(() => resolve("timeout"), HEARTBEAT_MS);
        });

        const result = await Promise.race([readPromise, heartbeat]);
        clearTimeout(heartbeatTimer);

        if (result === "timeout") {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          continue; // keep waiting on the SAME readPromise, don't re-read
        }

        const { done, value } = result;
        if (done) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
          if (onDone) onDone(fullText, toolCallNames).catch((err) => console.error("chat persistence failed:", err));
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep the last (possibly partial) line for next read

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt;
          try {
            evt = JSON.parse(line.slice(6));
          } catch {
            continue; // e.g. a non-JSON sentinel line -- skip defensively
          }

          if (evt.type === "response.output_text.delta") {
            let delta = evt.delta;
            if (evt.item_id && lastTextItemId !== null && evt.item_id !== lastTextItemId) {
              delta = "\n\n" + delta;
            }
            if (evt.item_id) lastTextItemId = evt.item_id;
            fullText += delta;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "text", delta })}\n\n`)
            );
          } else if (evt.type === "response.output_item.done" && evt.item?.type === "function_call") {
            toolCallNames.push(evt.item.name);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "tool_call", name: evt.item.name })}\n\n`)
            );
          }
        }

        readPromise = reader.read(); // issue the next read for the next loop iteration
      }
    },
  });
}

export async function POST(request) {
  try {
    const { message, sessionId, history } = await request.json();
    if (!message || typeof message !== "string") {
      return Response.json({ error: "message is required" }, { status: 400 });
    }

    // Multi-turn context: previously the Supervisor only ever saw the
    // current question in isolation, so a follow-up like "how does that
    // compare to Brazil?" had no idea what "that" referred to. The client
    // sends its own recent turns (already trimmed to a bounded window); we
    // just prepend them to the Responses-API `input` array.
    const inputMessages =
      Array.isArray(history) && history.length
        ? [
            ...history
              .filter((h) => h && typeof h.content === "string" && h.content.trim())
              .map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content })),
            { role: "user", content: message },
          ]
        : [{ role: "user", content: message }];

    // Best-effort, non-blocking: log the user's turn now, and the
    // assistant's full turn once the stream finishes (see onDone below).
    // A Lakebase hiccup should never hold up or break the actual chat.
    if (sessionId) {
      addMessage(sessionId, "user", message).catch((err) => console.error("chat persistence failed:", err));
    }

    const token = await getAccessToken();
    const host = normalizeHost(process.env.DATABRICKS_HOST);
    const endpointName = process.env.SERVING_ENDPOINT_NAME;

    const resp = await fetch(`${host}/serving-endpoints/${endpointName}/invocations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: inputMessages, stream: true }),
    });

    if (!resp.ok || !resp.body) {
      return Response.json(
        { error: `Supervisor call failed: ${resp.status} ${await resp.text()}` },
        { status: 502 }
      );
    }

    const onDone = sessionId
      ? (fullText, toolCallNames) => addMessage(sessionId, "assistant", fullText, toolCallNames)
      : null;

    return new Response(relayToSimpleSSE(resp.body, onDone), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // disable response buffering on Nginx-style proxies
      },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
