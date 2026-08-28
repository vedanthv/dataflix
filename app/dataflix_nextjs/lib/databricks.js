// Shared server-side Databricks helpers for the Casting Recommendation
// feature: OAuth client-credentials token (using the app's auto-injected
// service-principal creds), a synchronous SQL Statement Execution call, and
// a raw file upload to a UC Volume. The entire casting pipeline runs through
// these -- PDF parsing, extraction, sentiment, and final ranking are all
// Databricks AI Functions (ai_parse_document/ai_summarize/ai_extract/
// ai_analyze_sentiment/ai_query) called via SQL, not a separate model-serving
// REST call from Node.

function normalizeHost(host) {
  return host.startsWith("http") ? host : `https://${host}`;
}

let cachedToken = null;
let cachedTokenExpiry = 0;

export async function getAccessToken() {
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
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" }),
  });

  if (!resp.ok) {
    throw new Error(`OAuth token exchange failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// Runs a SQL statement to completion and returns rows as an array of plain
// objects keyed by column name. wait_timeout is capped at "50s" server-side
// -- a cold (stopped/auto-suspended) warehouse can take 30-60s just to spin
// up, and ai_parse_document/ai_extract add more on top of that, so the
// initial call can come back with the statement still PENDING/RUNNING and
// no rows yet. That used to be silently treated as "zero rows" by callers
// (e.g. casting's "Couldn't extract readable text from this PDF" error was
// actually "the warehouse was still cold-starting when the query timed
// out" in disguise) -- poll to a real terminal state instead.
export async function runSql(statement, { waitTimeout = "30s", maxWaitMs = 120000 } = {}) {
  const token = await getAccessToken();
  const host = normalizeHost(process.env.DATABRICKS_HOST);
  const warehouseId = process.env.WAREHOUSE_ID;

  const resp = await fetch(`${host}/api/2.0/sql/statements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ warehouse_id: warehouseId, statement, wait_timeout: waitTimeout }),
  });
  if (!resp.ok) throw new Error(`SQL execution failed: ${resp.status} ${await resp.text()}`);
  let data = await resp.json();

  const deadline = Date.now() + maxWaitMs;
  while (data.status?.state === "PENDING" || data.status?.state === "RUNNING") {
    if (Date.now() > deadline) {
      throw new Error("SQL statement timed out waiting for the warehouse (it may still be starting up -- try again in a moment).");
    }
    await new Promise((r) => setTimeout(r, 1500));
    const pollResp = await fetch(`${host}/api/2.0/sql/statements/${data.statement_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!pollResp.ok) throw new Error(`SQL polling failed: ${pollResp.status} ${await pollResp.text()}`);
    data = await pollResp.json();
  }

  if (data.status?.state === "FAILED") {
    throw new Error(`SQL error: ${data.status?.error?.message || "unknown"}`);
  }
  if (data.status?.state !== "SUCCEEDED") {
    throw new Error(`SQL statement ended in unexpected state: ${data.status?.state}`);
  }

  const columns = data.manifest?.schema?.columns || [];
  const rows = data.result?.data_array || [];
  return rows.map((row) => Object.fromEntries(columns.map((c, i) => [c.name, row[i]])));
}

// Escapes a value for safe inline use inside a SQL string literal built by
// this route (script-derived genre/theme/JSON-schema text, never raw user
// SQL -- the route only ever embeds LLM-extracted text and a fixed schema).
export function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

// Uploads raw bytes to a UC Volume path via the Databricks Files API.
export async function uploadToVolume(volumePath, buffer) {
  const token = await getAccessToken();
  const host = normalizeHost(process.env.DATABRICKS_HOST);
  const resp = await fetch(`${host}/api/2.0/fs/files${volumePath}?overwrite=true`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: buffer,
  });
  if (!resp.ok && resp.status !== 204) {
    throw new Error(`Volume upload failed: ${resp.status} ${await resp.text()}`);
  }
}
