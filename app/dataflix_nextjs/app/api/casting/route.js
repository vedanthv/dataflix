// Casting Recommendation — deliberately bypasses the Supervisor/Genie
// entirely (off the Genie rate-limit quota, and no NL2SQL ambiguity needed
// since we know exactly what SQL/AI Function calls we want). The whole
// pipeline is Databricks-native AI Functions called via SQL, not a separate
// model-serving REST call from Node:
//   1. ai_parse_document -- extract text from the uploaded script PDF
//      (uploaded to a UC Volume first via the Files API).
//   2. ai_summarize + ai_extract -- a one-line logline, and {genre, tone,
//      themes, characters} constrained to the REAL genre values in
//      dim_title via ai_extract's enum field type (can't drift to a
//      non-joinable value).
//   3. dataflix.casting.search_actor_profiles (VECTOR_SEARCH over real
//      actor bio/filmography/review documents) + ai_analyze_sentiment on
//      each candidate's profile text -- semantic content match, not just a
//      genre tag, plus a real sentiment signal from their actual reviews.
//   4. Two quantitative signals: PRIMARY = each candidate's real career-wide
//      TMDB rating in the extracted genre (dataflix.casting.actor_film_stats,
//      built from their actual filmography -- always populated, since it
//      doesn't depend on overlapping Dataflix's own tiny synthetic catalog).
//      SECONDARY = whether they've already appeared in a Dataflix catalog
//      title in this genre (title_cast + fact_engagement) -- a narrower
//      bonus signal, expected to be empty for most external scripts.
//   5. ai_query synthesizes all signals into a ranked, justified
//      recommendation, PLUS a second ai_query pass over the same candidate
//      pool that maps each named character (from step 2's extraction) to
//      its own single best-fit actor -- per-character casting, not just one
//      blanket top-5 for the whole script.

import { runSql, sqlEscape, uploadToVolume } from "../../../lib/databricks";
import { addMessage } from "../../../lib/lakebase";

export const runtime = "nodejs";

const FM_ENDPOINT = "databricks-meta-llama-3-3-70b-instruct";
const SCRIPTS_VOLUME_PATH = "/Volumes/dataflix/casting/raw_documents/scripts";

function safeFilename(name) {
  return (name || "script.pdf").replace(/[^a-zA-Z0-9_.-]/g, "_");
}

async function extractScriptSignal(volumeFilePath, realGenres) {
  const schema = JSON.stringify({
    genre: { type: "enum", labels: realGenres },
    tone: { type: "string" },
    themes: { type: "string" },
    characters: { type: "array", items: { type: "string" } },
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
             ai_summarize(text_blocks, 120) AS logline,
             -- ai_extract is by far the slowest call in this pipeline
             -- (measured ~17-38s on a real 33-page/28K-char script vs.
             -- ~8-12s for ai_parse_document and ~3.5s for ai_summarize
             -- above) because it reads the ENTIRE script just to pull out
             -- genre/tone/themes/character names -- signal a screenplay
             -- almost always establishes in its opening pages. Capping its
             -- input to the first ~15K characters (roughly half of a
             -- typical uploaded script) cuts what it has to read without
             -- losing extraction quality -- empirically still finds more
             -- named characters than the untruncated call did. ai_summarize
             -- stays on the full text_blocks since it's already fast and
             -- the logline should reflect the whole story, not just Act 1.
             ai_extract(
               substring(text_blocks, 1, 15000),
               '${sqlEscape(schema)}',
               map('version','2.0', 'instructions', 'This is a screenplay/script excerpt. Extract the overall genre, emotional tone, thematic summary, and main character names.')
             ) AS extraction
      FROM txt
    )
    SELECT
      length(text_blocks) AS text_len,
      logline,
      extraction:response:genre::STRING AS genre,
      extraction:response:tone::STRING AS tone,
      extraction:response:themes::STRING AS themes,
      extraction:response:characters::STRING AS characters_json,
      extraction:error_message::STRING AS extract_error
    FROM extracted
  `, { waitTimeout: "50s" });

  const row = rows[0];
  if (!row || Number(row.text_len) < 100) {
    throw new Error("Couldn't extract readable text from this PDF.");
  }
  if (row.extract_error) throw new Error(`Script analysis failed: ${row.extract_error}`);
  if (!row.genre || !realGenres.includes(row.genre)) {
    throw new Error("Could not determine a valid genre for this script.");
  }

  let characters = [];
  try {
    characters = JSON.parse(row.characters_json || "[]");
  } catch {
    characters = [];
  }

  return { genre: row.genre, tone: row.tone, themes: row.themes, characters, logline: row.logline };
}

async function fetchCandidateActors(searchQuery) {
  return runSql(`
    SELECT actor_name, industry, chunk_text, ai_analyze_sentiment(chunk_text) AS sentiment
    FROM dataflix.casting.search_actor_profiles('${sqlEscape(searchQuery)}', NULL)
    LIMIT 12
  `);
}

// PRIMARY quantitative signal: each actor's REAL career-wide TMDB rating in
// this genre (dataflix.casting.actor_film_stats, built from their actual
// filmography -- movie + tv credits, real vote_average, real genre tags).
// This is always populated for any script, unlike a Dataflix-catalog-only
// cross-reference, which is nearly always empty for a script that has
// nothing to do with Dataflix's own 130-title synthetic catalog.
async function fetchCareerStats(genre) {
  const rows = await runSql(`
    SELECT actor_name, film_count, avg_vote_average
    FROM dataflix.casting.actor_film_stats
    WHERE genre = '${sqlEscape(genre)}'
  `);
  const byName = {};
  for (const r of rows) byName[r.actor_name] = r;
  return byName;
}

// SECONDARY bonus signal: has this actor already appeared in one of
// Dataflix's own catalog titles in this genre, and if so, how did it
// perform on Dataflix specifically? Narrower and often empty (script has no
// reason to relate to our tiny synthetic catalog), but a real, useful
// "have we already worked with them" signal when it does apply.
async function fetchDataflixHistory(genre) {
  const rows = await runSql(`
    SELECT a.actor_name,
           COUNT(DISTINCT tc.title_id) AS titles_in_genre,
           ROUND(AVG(fe.completion_rate) * 100, 1) AS avg_completion_rate_pct,
           ROUND(SUM(fe.watch_hours), 0) AS total_watch_hours
    FROM dataflix.core.title_cast tc
    JOIN dataflix.core.dim_title t ON tc.title_id = t.title_id
    JOIN dataflix.core.dim_actor a ON tc.actor_id = a.actor_id
    LEFT JOIN dataflix.engagement.fact_engagement fe ON fe.title_id = tc.title_id
    WHERE t.genre = '${sqlEscape(genre)}'
    GROUP BY a.actor_name
    ORDER BY total_watch_hours DESC
  `);
  const byName = {};
  for (const r of rows) byName[r.actor_name] = r;
  return byName;
}

async function synthesizeRanking(signal, candidateRows, careerStatsByName, dataflixHistoryByName) {
  const candidatesText = candidateRows
    .map((r) => `### ${r.actor_name} (${r.industry}, review sentiment: ${r.sentiment})\n${r.chunk_text.slice(0, 800)}`)
    .join("\n\n");

  const careerStatsText =
    Object.entries(careerStatsByName)
      .filter(([name]) => candidateRows.some((r) => r.actor_name === name))
      .map(([name, s]) => `${name}: ${s.film_count} real credit(s) in "${signal.genre}" across their career, avg TMDB rating ${s.avg_vote_average}/10`)
      .join("\n") || "(no career genre data for these actors)";

  const dataflixHistoryText =
    Object.entries(dataflixHistoryByName)
      .filter(([name]) => candidateRows.some((r) => r.actor_name === name))
      .map(([name, s]) => `${name}: ${s.titles_in_genre} Dataflix catalog title(s) in "${signal.genre}", avg completion rate ${s.avg_completion_rate_pct}%, total watch hours ${s.total_watch_hours}`)
      .join("\n") || "(none of these actors currently appear in Dataflix's own catalog in this genre -- expected for an external script, not a gap)";

  const prompt = `You are a casting recommendation assistant for a streaming platform. A new script has been analyzed:
Genre: ${signal.genre}
Tone: ${signal.tone}
Themes: ${signal.themes}
Main characters: ${JSON.stringify(signal.characters)}

Below are three real signals for a set of candidate actors, retrieved by semantic similarity to this script's themes/tone:

1. ACTOR PROFILE EXCERPTS (bio, filmography synopses, real audience reviews, real sentiment score of that review text):
${candidatesText}

2. CAREER-WIDE GENRE PERFORMANCE (real TMDB rating average across this actor's ACTUAL past credits in the "${signal.genre}" genre -- this is the PRIMARY quantitative signal, always meaningful regardless of what script you're casting for):
${careerStatsText}

3. DATAFLIX CATALOG HISTORY (SECONDARY, narrower bonus signal -- only meaningful if this actor happens to already be in Dataflix's own small internal catalog; being absent here is completely normal for a script unrelated to Dataflix's existing titles, NOT a red flag):
${dataflixHistoryText}

Recommend the TOP 5 actors for this script, ranked. For each, give a 1-2 sentence justification referencing (a) something specific and real from their profile/reviews/sentiment that matches this script's tone or themes, and (b) their real career-wide genre rating from signal #2 (the primary quantitative backing -- always cite this when available). Only mention Dataflix catalog history (signal #3) if it's actually present for that actor; never treat its absence as a negative. Never invent a number. Respond with ONLY a JSON object of this exact shape: {"recommendations":[{"actor_name":"...","industry":"...","justification":"..."}]}`;

  const rows = await runSql(`
    SELECT ai_query(
      '${FM_ENDPOINT}',
      '${sqlEscape(prompt)}',
      responseFormat => '{"type":"json_object"}',
      failOnError => false
    ).result AS ranked_json
  `, { waitTimeout: "50s" });

  try {
    const parsed = JSON.parse(rows[0]?.ranked_json || "{}");
    return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  } catch {
    return [];
  }
}

// Per-character casting -- the script signal already extracts a named
// character list (via ai_extract above), but until now the pipeline only
// ever produced one overall top-5 list for the whole script. This reuses
// the SAME candidate pool + stats context (no extra Vector Search calls) to
// map each named character individually to its single best-fit candidate,
// which is a real step up over "one list for the whole script" -- e.g. a
// character described as a hardened detective shouldn't get the same match
// as the film's romantic lead just because both came from the same top-5.
async function synthesizePerCharacterCasting(signal, candidateRows, careerStatsByName) {
  if (!signal.characters || signal.characters.length === 0) return [];

  const candidatesText = candidateRows
    .map((r) => `### ${r.actor_name} (${r.industry}, review sentiment: ${r.sentiment})\n${r.chunk_text.slice(0, 500)}`)
    .join("\n\n");

  const careerStatsText =
    Object.entries(careerStatsByName)
      .filter(([name]) => candidateRows.some((r) => r.actor_name === name))
      .map(([name, s]) => `${name}: ${s.film_count} real credit(s) in "${signal.genre}", avg TMDB rating ${s.avg_vote_average}/10`)
      .join("\n") || "(no career genre data for these actors)";

  const poolSize = candidateRows.length;
  const characterCount = signal.characters.length;
  const uniquenessRule =
    poolSize >= characterCount
      ? `The candidate pool has ${poolSize} actors for only ${characterCount} named character(s), so there is no shortage -- you MUST assign a DIFFERENT actor to each character. Never reuse the same actor for more than one character in your response.`
      : `There are ${characterCount} named characters but only ${poolSize} candidates, so a small number of repeats is unavoidable -- reuse an actor only when you truly run out of distinct good fits, and never repeat one more than necessary.`;

  const prompt = `You are casting individual roles for a screenplay. Named characters: ${JSON.stringify(signal.characters)}.
Script genre: ${signal.genre}. Tone: ${signal.tone}. Themes: ${signal.themes}.

CANDIDATE ACTOR POOL (profile excerpts, real audience-review sentiment):
${candidatesText}

CAREER-WIDE GENRE PERFORMANCE (real TMDB data):
${careerStatsText}

For EACH named character above, pick exactly ONE actor from the candidate pool who best fits that specific character's likely role, tone, or type -- do not invent a name that isn't in the pool. ${uniquenessRule} Give a 1-sentence justification per character tying the actor's real profile/sentiment to that character specifically (not just the script overall). Respond with ONLY a JSON object of this exact shape: {"characterCasting":[{"character":"...","actor_name":"...","justification":"..."}]}`;

  const rows = await runSql(`
    SELECT ai_query(
      '${FM_ENDPOINT}',
      '${sqlEscape(prompt)}',
      responseFormat => '{"type":"json_object"}',
      failOnError => false
    ).result AS cast_json
  `, { waitTimeout: "50s" });

  try {
    const parsed = JSON.parse(rows[0]?.cast_json || "{}");
    return Array.isArray(parsed.characterCasting) ? parsed.characterCasting : [];
  } catch {
    return [];
  }
}

export async function POST(request) {
  try {
    const { scriptPdfBase64, filename, userNote, sessionId } = await request.json();
    if (!scriptPdfBase64) {
      return Response.json({ error: "scriptPdfBase64 is required" }, { status: 400 });
    }

    // Persisted as structured JSON (not a flattened summary string) so the
    // history drawer can rehydrate the exact same attachment chip / casting
    // result card on resume, not just a text approximation.
    if (sessionId) {
      addMessage(sessionId, "user", JSON.stringify({ attachment: filename, note: userNote || "" })).catch((err) =>
        console.error("chat persistence failed:", err)
      );
    }

    const fname = safeFilename(filename);
    const volumeFilePath = `${SCRIPTS_VOLUME_PATH}/${Date.now()}_${fname}`;

    // The volume upload and the genre lookup don't depend on each other --
    // run them concurrently instead of back-to-back. Same for the three
    // signal-dependent lookups below (candidates/career stats/Dataflix
    // history all only need signal.tone/themes/genre, not each other) and
    // the two final ai_query passes (ranking and per-character casting both
    // only need signal + candidateRows + careerStatsByName). Collapsing
    // what was 7 sequential SQL round-trips into 4 concurrent stages is
    // most of what "the inference is slow" was actually about -- most of
    // the wall-clock time was independent network/warehouse round-trips
    // stacked in series, not any single model call being slow.
    const [, genreRows] = await Promise.all([
      uploadToVolume(volumeFilePath, Buffer.from(scriptPdfBase64, "base64")),
      runSql("SELECT DISTINCT genre FROM dataflix.core.dim_title ORDER BY genre"),
    ]);
    const realGenres = genreRows.map((r) => r.genre);

    const signal = await extractScriptSignal(volumeFilePath, realGenres);

    const [candidateRows, careerStatsByName, dataflixHistoryByName] = await Promise.all([
      fetchCandidateActors(`${signal.tone}. ${signal.themes}`),
      fetchCareerStats(signal.genre),
      fetchDataflixHistory(signal.genre),
    ]);

    const [ranked, characterCasting] = await Promise.all([
      synthesizeRanking(signal, candidateRows, careerStatsByName, dataflixHistoryByName),
      synthesizePerCharacterCasting(signal, candidateRows, careerStatsByName),
    ]);

    const recommendations = ranked.map((r) => ({
      actor_name: r.actor_name,
      industry: r.industry,
      justification: r.justification,
      career_genre_stats: careerStatsByName[r.actor_name] || null,
      dataflix_history: dataflixHistoryByName[r.actor_name] || null,
    }));

    const responsePayload = {
      filename,
      userNote: userNote || null,
      genre: signal.genre,
      tone: signal.tone,
      themes: signal.themes,
      characters: signal.characters,
      logline: signal.logline,
      recommendations,
      characterCasting,
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
