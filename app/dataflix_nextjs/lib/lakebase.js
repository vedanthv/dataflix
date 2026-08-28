// Session-history storage on Databricks Lakebase (Postgres Autoscaling).
// Connects with the app's own service-principal OAuth credentials via
// PG{HOST,PORT,DATABASE,USER} (auto-injected by the platform once the
// "postgres" resource is attached to the app) + a short-lived database
// credential minted from LAKEBASE_ENDPOINT (see databricks-lakebase skill,
// "Attach Lakebase to an existing app"). Session history is best-effort: a
// Lakebase hiccup should never break the chat itself, so every call site in
// the API routes wraps these in try/catch.

import { randomUUID } from "crypto";
import { Pool } from "pg";
import { getAccessToken } from "./databricks";

function normalizeHost(host) {
  return host.startsWith("http") ? host : `https://${host}`;
}

let cachedDbToken = null;
let cachedDbTokenExpiry = 0;

// Database credentials are OAuth tokens valid up to 1 hour -- refresh well
// within that window rather than tracking the exact expire_time.
async function getDbToken() {
  const now = Date.now();
  if (cachedDbToken && now < cachedDbTokenExpiry) return cachedDbToken;

  const token = await getAccessToken();
  const host = normalizeHost(process.env.DATABRICKS_HOST);

  const resp = await fetch(`${host}/api/2.0/postgres/credentials`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: process.env.LAKEBASE_ENDPOINT }),
  });
  if (!resp.ok) {
    throw new Error(`Lakebase credential generation failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  cachedDbToken = data.token;
  cachedDbTokenExpiry = now + 45 * 60 * 1000; // refresh at 45m of the up-to-60m lifetime
  return cachedDbToken;
}

let pool = null;
function getPool() {
  if (pool) return pool;
  pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    // pg (>=8.11) calls `password` as a function on every new physical
    // connection, so the pool always presents a fresh-enough token instead
    // of a value baked in at pool-creation time.
    password: getDbToken,
    ssl: { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 30000,
  });
  return pool;
}

let schemaReady = null;
// A brand-new schema (not the default "public", which may already be owned
// by another role) so the app's service principal owns everything it
// creates here -- see the databricks-lakebase skill's schema-ownership note.
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(`
      CREATE SCHEMA IF NOT EXISTS dataflix_app;
      CREATE TABLE IF NOT EXISTS dataflix_app.sessions (
        id UUID PRIMARY KEY,
        persona TEXT NOT NULL,
        user_email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE dataflix_app.sessions ADD COLUMN IF NOT EXISTS user_email TEXT;
      CREATE INDEX IF NOT EXISTS sessions_persona_user_idx ON dataflix_app.sessions(persona, user_email);
      CREATE TABLE IF NOT EXISTS dataflix_app.messages (
        id BIGSERIAL PRIMARY KEY,
        session_id UUID NOT NULL REFERENCES dataflix_app.sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS messages_session_idx ON dataflix_app.messages(session_id, created_at);
    `).catch((err) => {
      schemaReady = null; // allow a retry on the next call rather than sticking on a failed attempt
      throw err;
    });
  }
  return schemaReady;
}

export async function createSession(persona, userEmail) {
  await ensureSchema();
  const id = randomUUID();
  await getPool().query("INSERT INTO dataflix_app.sessions (id, persona, user_email) VALUES ($1, $2, $3)", [
    id,
    persona,
    userEmail || null,
  ]);
  return id;
}

export async function addMessage(sessionId, role, content, toolCalls) {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO dataflix_app.messages (session_id, role, content, tool_calls) VALUES ($1, $2, $3, $4)`,
    [sessionId, role, content, toolCalls && toolCalls.length ? JSON.stringify(toolCalls) : null]
  );
  await getPool().query("UPDATE dataflix_app.sessions SET last_active_at = now() WHERE id = $1", [sessionId]);
}

// Sessions with a preview (first user message) for the chat page's history
// drawer -- only sessions that actually have a message (a session row is
// created on every chat-page mount, so most never get a real turn). Scoped
// to the requesting user (via x-forwarded-email, see the route) so one
// person's history drawer never shows another person's sessions.
export async function listSessions(persona, userEmail, limit = 20) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT s.id, s.created_at, s.last_active_at,
            (SELECT content FROM dataflix_app.messages m
               WHERE m.session_id = s.id AND m.role = 'user'
               ORDER BY m.created_at ASC LIMIT 1) AS preview
     FROM dataflix_app.sessions s
     WHERE s.persona = $1
       AND s.user_email IS NOT DISTINCT FROM $2
       AND EXISTS (SELECT 1 FROM dataflix_app.messages m WHERE m.session_id = s.id)
     ORDER BY s.last_active_at DESC
     LIMIT $3`,
    [persona, userEmail || null, limit]
  );
  return rows;
}

// This user's past questions for this persona, most recent first, across
// every session except the current one -- feeds both the baseline
// "never re-suggest something already asked" dedup and (once there's
// enough signal) the ai_query-personalized suggestion batch in
// /api/history-questions.
export async function getPastUserQuestions(persona, userEmail, excludeSessionId, limit = 30) {
  if (!userEmail) return [];
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT m.content
     FROM dataflix_app.messages m
     JOIN dataflix_app.sessions s ON s.id = m.session_id
     WHERE s.persona = $1 AND s.user_email = $2 AND m.role = 'user'
       AND ($3::UUID IS NULL OR m.session_id != $3)
     ORDER BY m.created_at DESC
     LIMIT $4`,
    [persona, userEmail, excludeSessionId || null, limit]
  );
  return rows.map((r) => r.content);
}

export async function getSessionHistory(sessionId) {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT role, content, tool_calls, created_at FROM dataflix_app.messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );
  return rows;
}
