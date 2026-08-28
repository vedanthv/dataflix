"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { getPersona, PERSONAS } from "../../../lib/personas";

// Safety net: force a blank line before any markdown image tag that isn't
// already preceded by one. A single \n is a soft line break in CommonMark,
// not a paragraph break, so "**Poster:**\n![...](...)" renders as one merged
// paragraph -- looks visually squished even though the markdown is "valid".
function normalizeImageSpacing(text) {
  return text.replace(/([^\n])\n(!\[[^\]]*\]\()/g, "$1\n\n$2");
}

const VARIANT_LABELS = {
  original: "Original",
  face_closeup: "Close-Up",
  dramatic_regrade: "Cinematic Grade",
  text_overlay: "Title Card",
};

// Maps the Supervisor's raw tool names (from route.js's "tool_call" SSE
// events, sourced structurally from function_call items in the Responses-API
// stream -- not prose self-reporting) to display labels for the Sources Used
// panel. Keep in sync with the tool names registered on the live Supervisor
// Agent (`databricks supervisor-agents get-supervisor-agent`).
const TOOL_LABELS = {
  engagement: "Engagement",
  licensing: "Licensing",
  documents: "Documents",
  content_signals: "Content Signals",
  marketing: "Marketing",
};

// The Supervisor's 6 canonical region_code values, mapped to a flag + display
// name for the Region badge. DE stands in for "EU" region-wise -- there's no
// broader EU code in this schema, see fact_licensing/fact_engagement's
// region_code convention.
const REGION_LABELS = {
  US: { flag: "\u{1F1FA}\u{1F1F8}", name: "United States" },
  IN: { flag: "\u{1F1EE}\u{1F1F3}", name: "India" },
  BR: { flag: "\u{1F1E7}\u{1F1F7}", name: "Brazil" },
  DE: { flag: "\u{1F1E9}\u{1F1EA}", name: "Germany" },
  JP: { flag: "\u{1F1EF}\u{1F1F5}", name: "Japan" },
  UK: { flag: "\u{1F1EC}\u{1F1E7}", name: "United Kingdom" },
};

// How many recent turns get sent back to the Supervisor as context on every
// new message -- bounded so payload/token usage doesn't grow unbounded over
// a long session.
const MAX_HISTORY_MESSAGES = 10;

function norm(q) {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueInOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function ThinkingIndicator() {
  const phrases = ["Reading your question…", "Pulling the relevant data…", "Putting together an answer…"];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % phrases.length), 1700);
    return () => clearInterval(id);
  }, []);
  return <span style={{ color: "#a3a3a3" }}>{phrases[i]}</span>;
}

function SourcesUsed({ toolCalls, pending }) {
  const distinct = uniqueInOrder(toolCalls);
  if (distinct.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 10 }}>
      <span style={{ fontSize: 11, color: "#8c8c8c" }}>{pending ? "Checking:" : "Sources used:"}</span>
      {distinct.map((name) => (
        <span key={name} style={sourceChipStyle(pending)}>
          {TOOL_LABELS[name] || name}
        </span>
      ))}
    </div>
  );
}

const sourceChipStyle = (pending) => ({
  fontSize: 11,
  color: "#c9c9c9",
  background: "#262626",
  border: "1px solid #3a3a3a",
  borderRadius: 999,
  padding: "3px 10px",
  opacity: pending ? 0.7 : 1,
});

function extractRegions(content) {
  const match = content.match(/<!--REGIONS:(\[[\s\S]*?\])-->/);
  if (!match) {
    const openIdx = content.indexOf("<!--REGIONS:");
    if (openIdx !== -1) return { cleaned: content.slice(0, openIdx).trim(), regions: null };
    return { cleaned: content, regions: null };
  }
  const cleaned = (content.slice(0, match.index) + content.slice(match.index + match[0].length)).trim();
  let codes;
  try {
    codes = JSON.parse(match[1]);
  } catch {
    return { cleaned, regions: null };
  }
  if (!Array.isArray(codes)) return { cleaned, regions: null };
  const regions = uniqueInOrder(codes.filter((c) => REGION_LABELS[c]));
  return { cleaned, regions: regions.length ? regions : null };
}

function RegionBadge({ regions }) {
  if (!regions || regions.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
      {regions.map((code) => {
        const info = REGION_LABELS[code];
        return (
          <span key={code} style={regionBadgeStyle}>
            <span>{info.flag}</span>
            <span>{info.name}</span>
          </span>
        );
      })}
    </div>
  );
}

const regionBadgeStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: "#fff",
  background: "#E50914",
  borderRadius: 999,
  padding: "3px 10px",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
};

function extractThumbnails(content) {
  const match = content.match(/<!--THUMBNAILS:(\[[\s\S]*?\])-->/);
  if (!match) {
    const openIdx = content.indexOf("<!--THUMBNAILS:");
    if (openIdx !== -1) return { cleaned: content.slice(0, openIdx).trim(), groups: null };
    return { cleaned: content, groups: null };
  }
  const cleaned = (content.slice(0, match.index) + content.slice(match.index + match[0].length)).trim();
  let items;
  try {
    items = JSON.parse(match[1]);
  } catch {
    return { cleaned, groups: null };
  }
  const groups = {};
  for (const item of items) {
    const title = item.title || "This title";
    const variantId = item.variant_id || item.variant || "variant";
    const imageUrl = item.image_url || item.url;
    if (!imageUrl) continue;
    const ctr = item.ctr;
    (groups[title] ||= []).push({ variantId, imageUrl, ctr });
  }
  return { cleaned, groups: Object.keys(groups).length ? groups : null };
}

function ThumbnailCarousel({ title, variants }) {
  const [index, setIndex] = useState(0);
  const n = variants.length;
  const current = variants[index];
  const go = (delta) => setIndex((i) => (i + delta + n) % n);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "#a3a3a3", marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        {n > 1 && (
          <button onClick={() => go(-1)} aria-label="Previous variant" style={carouselArrowStyle}>
            ‹
          </button>
        )}
        <div
          title={`${VARIANT_LABELS[current.variantId] || current.variantId}${
            typeof current.ctr === "number" ? ` — ${(current.ctr * 100).toFixed(1)}% CTR` : ""
          }`}
          style={{ textAlign: "center" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.imageUrl}
            alt={`${title} ${current.variantId}`}
            style={{ width: 240, height: "auto", borderRadius: 10, display: "block" }}
          />
          <div style={{ fontSize: 13, color: "#fff", marginTop: 6, fontWeight: 600 }}>
            {VARIANT_LABELS[current.variantId] || current.variantId}
            <span style={{ color: "#a3a3a3", fontWeight: 400 }}>
              {" "}
              ·{" "}
              {typeof current.ctr === "number" ? `${(current.ctr * 100).toFixed(1)}% CTR` : "Reference"}
            </span>
          </div>
        </div>
        {n > 1 && (
          <button onClick={() => go(1)} aria-label="Next variant" style={carouselArrowStyle}>
            ›
          </button>
        )}
      </div>
      {n > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 8 }}>
          {variants.map((v, i) => (
            <button
              key={v.variantId}
              onClick={() => setIndex(i)}
              aria-label={`Show ${VARIANT_LABELS[v.variantId] || v.variantId}`}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                border: "none",
                padding: 0,
                cursor: "pointer",
                background: i === index ? "#E50914" : "#444",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const carouselArrowStyle = {
  background: "#262626",
  color: "#fff",
  border: "none",
  borderRadius: "50%",
  width: 32,
  height: 32,
  fontSize: 18,
  lineHeight: "32px",
  textAlign: "center",
  cursor: "pointer",
  flexShrink: 0,
};

function ThumbnailComparison({ groups }) {
  return (
    <div style={{ marginTop: 8 }}>
      {Object.entries(groups).map(([title, variants]) => (
        <ThumbnailCarousel key={title} title={title} variants={variants} />
      ))}
    </div>
  );
}

function CastingResult({ result, error, loading, filename }) {
  if (loading) {
    return (
      <div style={{ color: "#a3a3a3" }}>
        analyzing <strong>{filename}</strong> against real actor profiles…
      </div>
    );
  }
  if (error) {
    return <div style={{ color: "#ff6b6b" }}>Casting analysis failed: {error}</div>;
  }
  if (!result) return null;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <span style={castingTagStyle}>🎭 {result.genre}</span>
        <span style={castingTagStyle}>{result.tone}</span>
      </div>
      {result.logline && (
        <div style={{ fontSize: 13, fontStyle: "italic", color: "#a3a3a3", marginBottom: 6 }}>
          &ldquo;{result.logline}&rdquo;
        </div>
      )}
      <div style={{ fontSize: 13, color: "#d2d2d2", marginBottom: 14, lineHeight: 1.5 }}>{result.themes}</div>
      <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 8, fontWeight: 700 }}>
        RECOMMENDED CAST (real actor data + Dataflix catalog performance)
      </div>
      {(result.recommendations || []).map((rec, i) => (
        <div key={rec.actor_name + i} style={castingCardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#fff" }}>
              {i + 1}. {rec.actor_name}
            </span>
            <span style={{ fontSize: 11, color: "#8c8c8c" }}>{rec.industry}</span>
          </div>
          <div style={{ fontSize: 13, color: "#d2d2d2", marginTop: 4, lineHeight: 1.5 }}>{rec.justification}</div>
          <div style={{ fontSize: 11, color: "#8c8c8c", marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {rec.career_genre_stats ? (
              <span>
                🎬 {rec.career_genre_stats.film_count} real {result.genre} credit(s), avg{" "}
                {rec.career_genre_stats.avg_vote_average}/10 TMDB rating
              </span>
            ) : (
              <span>No {result.genre} credits found in this actor&rsquo;s TMDB filmography</span>
            )}
            {rec.dataflix_history && (
              <span>
                📊 Dataflix catalog: {rec.dataflix_history.titles_in_genre} title(s) in {result.genre} ·{" "}
                {rec.dataflix_history.avg_completion_rate_pct}% avg completion ·{" "}
                {Number(rec.dataflix_history.total_watch_hours).toLocaleString()} watch hours
              </span>
            )}
          </div>
        </div>
      ))}

      {result.characterCasting?.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: "#8c8c8c", margin: "16px 0 8px", fontWeight: 700 }}>
            PER-CHARACTER CASTING
          </div>
          {result.characterCasting.map((c, i) => (
            <div key={c.character + i} style={castingCardStyle}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#fff", marginBottom: 3 }}>
                {c.character} <span style={{ color: "#8c8c8c", fontWeight: 400 }}>→</span> {c.actor_name}
              </div>
              <div style={{ fontSize: 13, color: "#d2d2d2", lineHeight: 1.5 }}>{c.justification}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const RISK_COLORS = { Low: "#3fb950", Medium: "#d29922", High: "#f85149" };

// Compliance memo results (see /api/compliance-memo) -- like casting,
// deliberately its own structured card rather than markdown prose, so a
// compliance/legal reviewer sees a scannable memo (summary, certification,
// cited regulatory points, a recommendation, a risk level) instead of a
// paragraph they have to parse themselves.
function ComplianceMemo({ result, error, loading, titleName }) {
  const [downloading, setDownloading] = useState(false);

  if (loading) {
    return (
      <div style={{ color: "#a3a3a3" }}>
        drafting a compliance memo for <strong>{titleName}</strong>…
      </div>
    );
  }
  if (error) {
    return <div style={{ color: "#ff6b6b" }}>Memo generation failed: {error}</div>;
  }
  if (!result) return null;

  async function downloadPdf() {
    setDownloading(true);
    try {
      const resp = await fetch("/api/compliance-memo/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      if (!resp.ok) throw new Error("PDF generation failed");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `compliance-memo-${result.titleName.replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF download failed:", err);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "#8c8c8c", fontWeight: 700, letterSpacing: 0.5 }}>COMPLIANCE MEMO</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginTop: 2 }}>
            {result.titleName}
            {result.region && <span style={{ color: "#8c8c8c", fontWeight: 500 }}> — {result.region}</span>}
          </div>
        </div>
        {result.riskLevel && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#fff",
              background: RISK_COLORS[result.riskLevel] || "#555",
              borderRadius: 999,
              padding: "3px 10px",
              flexShrink: 0,
            }}
          >
            {result.riskLevel} risk
          </span>
        )}
      </div>

      {result.licenseSummary && (
        <div style={{ marginBottom: 10 }}>
          <div style={memoLabelStyle}>License Summary</div>
          <div style={memoBodyStyle}>{result.licenseSummary}</div>
        </div>
      )}
      {result.certificationNote && (
        <div style={{ marginBottom: 10 }}>
          <div style={memoLabelStyle}>Certification</div>
          <div style={memoBodyStyle}>{result.certificationNote}</div>
        </div>
      )}
      {result.regulatoryConsiderations?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={memoLabelStyle}>Regulatory Considerations</div>
            {result.regulatorySourcesVerifiedReal && (
              <span style={{ fontSize: 10, color: "#3fb950", fontWeight: 600 }}>✓ Real regulatory sources only</span>
            )}
          </div>
          {result.regulatoryConsiderations.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: "#d2d2d2", lineHeight: 1.5, marginTop: 4 }}>
              • {c.point} <span style={{ color: "#8c8c8c", fontSize: 11 }}>[{c.source}]</span>
            </div>
          ))}
        </div>
      )}
      {result.recommendation && (
        <div style={{ marginBottom: 14 }}>
          <div style={memoLabelStyle}>Recommendation</div>
          <div style={memoBodyStyle}>{result.recommendation}</div>
        </div>
      )}

      <button onClick={downloadPdf} disabled={downloading} style={downloadMemoBtnStyle(downloading)}>
        {downloading ? "Generating PDF…" : "⬇ Download as PDF"}
      </button>
    </div>
  );
}

// Contract auto-ingestion results (see /api/contract-ingest) -- a
// before/after card so it's obvious at a glance whether this was a fresh
// license or a renewal that changed terms, since the whole point is "no
// manual data-entry step" and the user should be able to trust that at a
// glance rather than digging through fact_licensing themselves.
function ContractIngestResult({ result, error, loading, filename }) {
  if (loading) {
    return (
      <div style={{ color: "#a3a3a3" }}>
        parsing <strong>{filename}</strong> and updating licensing records…
      </div>
    );
  }
  if (error) {
    return <div style={{ color: "#ff6b6b" }}>Contract ingestion failed: {error}</div>;
  }
  if (!result) return null;

  const u = result.updated;
  const p = result.previous;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "#8c8c8c", fontWeight: 700, letterSpacing: 0.5 }}>
            CONTRACT AUTO-INGESTION
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginTop: 2 }}>
            {result.titleName} <span style={{ color: "#8c8c8c", fontWeight: 500 }}>— {result.regionCode}</span>
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#fff",
            background: result.wasRenewal ? "#d29922" : "#3fb950",
            borderRadius: 999,
            padding: "3px 10px",
            flexShrink: 0,
          }}
        >
          {result.wasRenewal ? "Renewal" : "New license"}
        </span>
      </div>

      <div style={{ fontSize: 12, color: "#3fb950", fontWeight: 600, marginBottom: 10 }}>
        ✓ Written to fact_licensing
      </div>

      <div style={castingCardStyle}>
        {[
          ["License type", u.licenseType, p?.license_type],
          ["Expiry", u.licenseExpiry, p?.license_expiry],
          ["Renewal cost", `$${Number(u.renewalCostEstimate).toLocaleString()}`, p ? `$${Number(p.renewal_cost_estimate).toLocaleString()}` : null],
          ["Exclusive", u.exclusivityFlag ? "Yes" : "No", p ? (p.exclusivity_flag ? "Yes" : "No") : null],
          ["Rights holder", u.rightsHolder || "—", p?.rights_holder],
        ].map(([label, value, prevValue]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
            <span style={{ color: "#8c8c8c" }}>{label}</span>
            <span style={{ color: "#d2d2d2", textAlign: "right" }}>
              {prevValue != null && String(prevValue) !== String(value) && (
                <span style={{ color: "#6b6b6b", textDecoration: "line-through", marginRight: 6 }}>{prevValue}</span>
              )}
              {value}
            </span>
          </div>
        ))}
      </div>

      {result.userNote && (
        <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 10, fontStyle: "italic" }}>&ldquo;{result.userNote}&rdquo;</div>
      )}
    </div>
  );
}

const downloadMemoBtnStyle = (disabled) => ({
  background: "transparent",
  border: "1px solid #E50914",
  color: "#E50914",
  fontSize: 12,
  fontWeight: 700,
  padding: "7px 14px",
  borderRadius: 6,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.6 : 1,
});

const memoLabelStyle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  color: "#8c8c8c",
  textTransform: "uppercase",
  marginBottom: 4,
};

const memoBodyStyle = {
  fontSize: 13,
  color: "#d2d2d2",
  lineHeight: 1.5,
};

const castingCardStyle = {
  background: "#1f1f1f",
  border: "1px solid #333",
  borderRadius: 8,
  padding: "10px 12px",
  marginBottom: 8,
};

const castingTagStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: "#fff",
  background: "#E50914",
  borderRadius: 999,
  padding: "3px 10px",
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// A row of clickable question pills -- used both for the persona's rotating
// sample-question pool (above the composer) and for per-answer follow-ups
// (rendered on their own line right under a finished answer).
function QuestionChips({ label, questions, onPick, disabled, variant = "sample" }) {
  if (!questions || questions.length === 0) return null;
  return (
    <div style={{ marginTop: variant === "followup" ? 10 : 0 }}>
      {label && (
        <div style={{ fontSize: 11, color: variant === "followup" ? "#8c8c8c" : "#a3a3a3", marginBottom: 6, fontWeight: 600, letterSpacing: 0.3 }}>
          {label}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {questions.map((q) => (
          <button
            key={q}
            disabled={disabled}
            onClick={() => onPick(q)}
            style={variant === "followup" ? followupChipStyle(disabled) : sampleChipStyle(disabled)}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

const sampleChipStyle = (disabled) => ({
  fontSize: 13,
  color: "#e5e5e5",
  background: "#1f1f1f",
  border: "1px solid #3a3a3a",
  borderRadius: 999,
  padding: "8px 14px",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
  textAlign: "left",
});

const followupChipStyle = (disabled) => ({
  fontSize: 12,
  color: "#ffb3b8",
  background: "rgba(229,9,20,0.08)",
  border: "1px solid rgba(229,9,20,0.4)",
  borderRadius: 999,
  padding: "6px 12px",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
  textAlign: "left",
});

// Converts a rendered message into the plain-text form sent back to the
// Supervisor as conversation context -- strips the structural markers
// (THUMBNAILS/REGIONS) the same way the UI does before display, and
// collapses a casting/memo turn into one referenceable line instead of raw
// JSON.
function toHistoryText(m) {
  if (m.streaming) return null;
  if (m.kind === "casting") {
    if (m.castingResult) {
      const names = (m.castingResult.recommendations || []).map((r) => r.actor_name).join(", ");
      return `[Casting shortlist for "${m.castingResult.filename}" (${m.castingResult.genre}): ${names}]`;
    }
    return null;
  }
  if (m.kind === "memo") {
    if (m.memoResult) {
      return `[Compliance memo for "${m.memoResult.titleName}"${m.memoResult.region ? ` (${m.memoResult.region})` : ""}: ${m.memoResult.recommendation || m.memoResult.licenseSummary || ""}]`;
    }
    return null;
  }
  if (m.kind === "contract") {
    if (m.contractResult) {
      const r = m.contractResult;
      return `[Contract ${r.wasRenewal ? "renewal" : "new license"} ingested for "${r.titleName}" (${r.regionCode}): ${r.updated.licenseType}, expires ${r.updated.licenseExpiry}, $${r.updated.renewalCostEstimate}]`;
    }
    return null;
  }
  let text = m.content || "";
  text = extractThumbnails(text).cleaned;
  text = extractRegions(text).cleaned;
  return text.trim() || null;
}

function buildHistory(allMessages) {
  const usable = allMessages
    .map((m) => ({ role: m.role, content: toHistoryText(m) }))
    .filter((m) => m.content);
  return usable.slice(-MAX_HISTORY_MESSAGES);
}

// Rehydrates one Lakebase message row into the same shape the live chat
// renders. Casting turns are stored as structured JSON (see
// /api/casting/route.js) specifically so a resumed session gets back the
// real attachment chip / result card, not a flattened summary line.
function hydrateHistoryRow(row) {
  const toolCalls = row.tool_calls ? (typeof row.tool_calls === "string" ? JSON.parse(row.tool_calls) : row.tool_calls) : [];
  if (row.role === "user") {
    try {
      const parsed = JSON.parse(row.content);
      if (parsed && typeof parsed === "object" && "attachment" in parsed) {
        return { role: "user", content: parsed.note || "", attachment: parsed.attachment };
      }
      if (parsed && typeof parsed === "object" && "memoRequest" in parsed) {
        return { role: "user", content: `📄 Compliance memo request: ${parsed.memoRequest}${parsed.region ? ` (${parsed.region})` : ""}` };
      }
    } catch {
      // not JSON -- a normal text question
    }
    return { role: "user", content: row.content };
  }
  try {
    const parsed = JSON.parse(row.content);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.recommendations)) {
      return { role: "assistant", kind: "casting", castingResult: parsed };
    }
    if (parsed && typeof parsed === "object" && "regulatoryConsiderations" in parsed) {
      return { role: "assistant", kind: "memo", memoResult: parsed };
    }
    if (parsed && typeof parsed === "object" && "wasRenewal" in parsed) {
      return { role: "assistant", kind: "contract", contractResult: parsed };
    }
  } catch {
    // not JSON -- a normal text answer
  }
  return { role: "assistant", content: row.content, toolCalls, streaming: false };
}

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const persona = getPersona(params.persona);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [askedSet, setAskedSet] = useState(new Set());
  const [sessionId, setSessionId] = useState(null);
  const [personalizedQuestions, setPersonalizedQuestions] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  // In-progress compliance-memo slot-filling (see handleMemoTurn below):
  // { titleName: string|null, region: string|null, awaiting: "title"|"region" }
  const [pendingMemo, setPendingMemo] = useState(null);

  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);
  const userStoppedRef = useRef(false);

  useEffect(() => {
    if (!persona) return;
    createNewSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona?.id]);

  useEffect(() => {
    if (pinnedToBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, pinnedToBottom]);

  if (!persona) {
    return (
      <div style={{ minHeight: "100vh", background: "#141414", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 18 }}>Unknown persona.</div>
        <button onClick={() => router.push("/")} style={ctaBtnStyleSmall}>
          ← Choose a role
        </button>
      </div>
    );
  }

  async function createNewSession() {
    setMessages([]);
    setAskedSet(new Set());
    setSessionId(null);
    setPersonalizedQuestions([]);
    let newSessionId = null;
    try {
      const resp = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: persona.name }),
      });
      const data = await resp.json();
      if (data.sessionId) {
        newSessionId = data.sessionId;
        setSessionId(data.sessionId);
      }
    } catch {
      // session history is best-effort -- chat still works without one
    }
    loadPersonalization(newSessionId);
  }

  // Tailors the suggested-question pool to this specific person's history in
  // this persona (see /api/history-questions): always seeds askedSet with
  // every plain question they've asked before (so a returning user never
  // sees a suggestion they've already used, even across sessions), and --
  // once there's enough signal -- swaps in an ai_query-personalized batch
  // instead of the generic static pool from lib/personas.js.
  async function loadPersonalization(currentSessionId) {
    try {
      const qs = new URLSearchParams({ persona: persona.name });
      if (currentSessionId) qs.set("sessionId", currentSessionId);
      const resp = await fetch(`/api/history-questions?${qs.toString()}`);
      const data = await resp.json();
      if (data.pastQuestions?.length) {
        setAskedSet((prev) => {
          const next = new Set(prev);
          data.pastQuestions.forEach((q) => next.add(norm(q)));
          return next;
        });
      }
      setPersonalizedQuestions(data.suggestions || []);
    } catch {
      setPersonalizedQuestions([]);
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const resp = await fetch(`/api/sessions?persona=${encodeURIComponent(persona.name)}`);
      const data = await resp.json();
      setHistoryList(data.sessions || []);
    } catch {
      setHistoryList([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function resumeSession(id) {
    setHistoryOpen(false);
    try {
      const resp = await fetch(`/api/sessions/${id}`);
      const data = await resp.json();
      const hydrated = (data.messages || []).map(hydrateHistoryRow);
      setMessages(hydrated);
      setSessionId(id);
      setPinnedToBottom(true);

      const newAsked = new Set();
      hydrated.forEach((m) => {
        if (m.role === "user" && m.content) newAsked.add(norm(m.content));
      });
      setAskedSet(newAsked);
      loadPersonalization(id);

      const lastIdx = hydrated.length - 1;
      const last = hydrated[lastIdx];
      if (last && last.role === "assistant" && last.kind !== "casting" && last.kind !== "memo" && last.kind !== "contract" && last.content) {
        for (let j = lastIdx - 1; j >= 0; j--) {
          if (hydrated[j].role === "user" && hydrated[j].content) {
            fetchFollowups(lastIdx, hydrated[j].content, last.content);
            break;
          }
        }
      }
    } catch {
      // leave the current conversation untouched on failure
    }
  }

  function markAsked(question) {
    setAskedSet((prev) => new Set(prev).add(norm(question)));
  }

  function appendToLastAssistant(updater) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, ...updater(last) };
      return next;
    });
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setPinnedToBottom(nearBottom);
  }

  function scrollToBottom() {
    setPinnedToBottom(true);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  function autoResizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function fetchFollowups(msgIndex, question, answer) {
    setMessages((prev) => {
      const next = [...prev];
      if (next[msgIndex]) next[msgIndex] = { ...next[msgIndex], followupsLoading: true };
      return next;
    });
    try {
      const resp = await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: persona.name, question, answer }),
      });
      const data = await resp.json();
      setMessages((prev) => {
        const next = [...prev];
        if (next[msgIndex]) next[msgIndex] = { ...next[msgIndex], followups: data.followups || [], followupsLoading: false };
        return next;
      });
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        if (next[msgIndex]) next[msgIndex] = { ...next[msgIndex], followupsLoading: false };
        return next;
      });
    }
  }

  async function sendCastingMessage(fileOverride, noteOverride) {
    const file = fileOverride || attachedFile;
    const note = (noteOverride ?? input).trim();
    if (!file || loading) return;

    markAsked(note || file.name);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: note, attachment: file.name },
      { role: "assistant", kind: "casting", castingLoading: true, castingFilename: file.name },
    ]);
    setInput("");
    setAttachedFile(null);
    setLoading(true);

    try {
      const scriptPdfBase64 = await fileToBase64(file);
      const resp = await fetch("/api/casting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptPdfBase64, filename: file.name, userNote: note, sessionId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || resp.statusText);

      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", kind: "casting", castingResult: data };
        return next;
      });
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          kind: "casting",
          castingError: String(err.message || err),
          castingFilename: file.name,
        };
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  // Contract auto-ingestion (see /api/contract-ingest) -- same attach-and-send
  // shape as casting's script upload, routed here instead whenever the
  // current persona isn't Casting (see sendChatMessage below).
  async function sendContractMessage(fileOverride, noteOverride) {
    const file = fileOverride || attachedFile;
    const note = (noteOverride ?? input).trim();
    if (!file || loading) return;

    markAsked(note || file.name);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: note, attachment: file.name },
      { role: "assistant", kind: "contract", contractLoading: true, contractFilename: file.name },
    ]);
    setInput("");
    setAttachedFile(null);
    setLoading(true);

    try {
      const contractPdfBase64 = await fileToBase64(file);
      const resp = await fetch("/api/contract-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractPdfBase64, filename: file.name, userNote: note, sessionId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || resp.statusText);

      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", kind: "contract", contractResult: data };
        return next;
      });
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          kind: "contract",
          contractError: String(err.message || err),
          contractFilename: file.name,
        };
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  function pushAssistantText(text) {
    setMessages((prev) => [...prev, { role: "assistant", content: text, streaming: false }]);
  }

  // Runs the actual memo generation once title (required) and region
  // (optional -- null means "all licensed regions") are both resolved. Same
  // off-Supervisor architecture as casting: direct SQL + ai_query, no
  // Genie/NL2SQL needed since we already know exactly what to fetch.
  async function generateComplianceMemo(titleName, region) {
    setMessages((prev) => [...prev, { role: "assistant", kind: "memo", memoLoading: true, memoTitleName: titleName }]);
    setLoading(true);
    try {
      const resp = await fetch("/api/compliance-memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titleName, region: region || null, sessionId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || resp.statusText);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", kind: "memo", memoResult: data };
        return next;
      });
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", kind: "memo", memoError: String(err.message || err), memoTitleName: titleName };
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  // Conversational compliance-memo flow, triggered by the word "memo"
  // anywhere in a message (or a reply while one is already in progress) --
  // no dedicated button/form. Slot-fills title then region across at most
  // two clarifying questions (via a cheap ai_query entity-extraction call,
  // /api/compliance-memo's `extractFrom` mode -- robust to free phrasing
  // like "draft a memo for Dhurandhar's renewal in India" in one shot, or
  // "Dhurandhar" / "just India" answered turn by turn) before drafting.
  async function handleMemoTurn(text) {
    const knownTitle = pendingMemo?.titleName || null;
    const knownRegion = pendingMemo?.region || null;
    const awaitingRegion = pendingMemo?.awaiting === "region";

    markAsked(text);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    let extracted = { titleName: null, region: null };
    try {
      const resp = await fetch("/api/compliance-memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extractFrom: text }),
      });
      extracted = await resp.json();
    } catch {
      // extraction failed -- fall through, the slot logic below just treats
      // this reply as unparsed rather than breaking the flow
    }

    const titleName = extracted.titleName || knownTitle;
    const region = extracted.region || knownRegion;

    if (!titleName) {
      setPendingMemo({ titleName: null, region, awaiting: "title" });
      pushAssistantText("Sure — which title is this compliance memo for?");
      setLoading(false);
      return;
    }

    if (!region && !awaitingRegion) {
      setPendingMemo({ titleName, region: null, awaiting: "region" });
      pushAssistantText(`Got it — which region should the memo for "${titleName}" cover? (US, IN, BR, DE, JP, or UK — or just say "all regions")`);
      setLoading(false);
      return;
    }

    setPendingMemo(null);
    setLoading(false);
    await generateComplianceMemo(titleName, region);
  }

  async function sendChatMessage(textOverride, opts = {}) {
    const { skipUserBubble = false, skipMarkAsked = false } = opts;
    const text = (textOverride ?? input).trim();
    if (attachedFile) return persona.isCasting ? sendCastingMessage(attachedFile, text) : sendContractMessage(attachedFile, text);
    if (!text || loading) return;
    if (pendingMemo || /\bmemo\b/i.test(text)) return handleMemoTurn(text);

    const history = buildHistory(messages);
    const baseLen = messages.length;

    if (!skipMarkAsked) markAsked(text);
    const assistantIndex = baseLen + (skipUserBubble ? 0 : 1);
    setMessages((prev) =>
      skipUserBubble
        ? [...prev, { role: "assistant", content: "", streaming: true, toolCalls: [], forQuestion: text }]
        : [
            ...prev,
            { role: "user", content: text },
            { role: "assistant", content: "", streaming: true, toolCalls: [], forQuestion: text },
          ]
    );
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);
    userStoppedRef.current = false;

    const IDLE_TIMEOUT_MS = 30000;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    let idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId, history }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => ({}));
        appendToLastAssistant(() => ({ content: `Error: ${data.error || resp.statusText}`, streaming: false }));
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        resetIdleTimer();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();

        for (const raw of events) {
          const line = raw.trim();
          if (!line.startsWith("data: ")) continue;
          let evt;
          try {
            evt = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (evt.type === "text") {
            appendToLastAssistant((last) => ({ content: last.content + evt.delta }));
          } else if (evt.type === "tool_call") {
            appendToLastAssistant((last) => ({ toolCalls: [...(last.toolCalls || []), evt.name] }));
          } else if (evt.type === "done") {
            appendToLastAssistant(() => ({ streaming: false }));
          }
        }
      }
    } catch (err) {
      const message =
        err?.name === "AbortError"
          ? userStoppedRef.current
            ? "_Stopped._"
            : "_Connection stalled (no response for 30s) -- please try again._"
          : `Something went wrong: ${err}`;
      appendToLastAssistant((last) => ({
        content: last.content ? `${last.content}\n\n${message}` : message,
        streaming: false,
      }));
    } finally {
      clearTimeout(idleTimer);
      abortControllerRef.current = null;
      appendToLastAssistant(() => ({ streaming: false }));
      setLoading(false);
      setMessages((prev) => {
        const finalMsg = prev[assistantIndex];
        if (finalMsg && finalMsg.content && !userStoppedRef.current) {
          fetchFollowups(assistantIndex, text, finalMsg.content);
        }
        return prev;
      });
    }
  }

  function handleStop() {
    userStoppedRef.current = true;
    abortControllerRef.current?.abort();
  }

  function regenerateLast() {
    if (loading) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || last.kind === "casting" || last.kind === "memo" || last.kind === "contract" || !last.forQuestion) return;
    const question = last.forQuestion;
    setMessages((prev) => prev.slice(0, -1));
    sendChatMessage(question, { skipUserBubble: true, skipMarkAsked: true });
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendChatMessage();
  }

  function handleComposerKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  }

  function handleChipClick(question) {
    if (loading) return;
    if (persona.isCasting) {
      // Casting is upload-driven -- a sample prompt just seeds the note
      // field so the user can still attach a script and send.
      setInput(question);
      markAsked(question);
      return;
    }
    sendChatMessage(question);
  }

  const suggestionPool = personalizedQuestions.length ? personalizedQuestions : persona.questions;
  const visibleSamples = suggestionPool.filter((q) => !askedSet.has(norm(q))).slice(0, 4);
  const suggestionsLabel = personalizedQuestions.length
    ? "Picking up where you left off:"
    : persona.isCasting
    ? "Try a brief:"
    : "Suggested questions:";
  const lastMessage = messages[messages.length - 1];
  const canRegenerate =
    !loading &&
    lastMessage &&
    lastMessage.role === "assistant" &&
    lastMessage.kind !== "casting" &&
    lastMessage.kind !== "memo" &&
    lastMessage.kind !== "contract" &&
    lastMessage.forQuestion;

  return (
    <div style={{ height: "100dvh", background: "#141414", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        .blink-cursor { animation: blink 1s step-start infinite; }
      `}</style>

      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid #232323",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={() => router.push("/")} style={backBtnStyle} aria-label="Back to roles">
            ←
          </button>
          <div style={{ fontFamily: "'Bebas Neue', 'Inter', sans-serif", color: "#E50914", fontSize: 20, letterSpacing: 1.5 }}>
            DATAFLIX
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => router.push("/capabilities")} style={headerActionBtnStyle} title="See what each role can do">
            Capabilities
          </button>
          <button onClick={() => router.push("/architecture")} style={headerActionBtnStyle} title="See how Dataflix is built, end to end">
            Architecture
          </button>
          <button onClick={createNewSession} style={headerActionBtnStyle} title="Start a new chat">
            + New Chat
          </button>
          <button onClick={openHistory} style={headerActionBtnStyle} title="View past sessions">
            History
          </button>
        </div>
      </header>

      {/* Capabilities navbar -- every persona is still the same full-capability
          assistant underneath (see the product decision this maps to: no
          hard scoping, just a wayfinding layer), so this doubles as an
          explicit "ask anything, this just tailors your suggestions" cue. */}
      <nav style={capsNavStyle}>
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            onClick={() => p.id !== persona.id && router.push(`/chat/${p.id}`)}
            title={p.tagline}
            style={capsPillStyle(p.id === persona.id)}
          >
            <span>{p.icon}</span>
            <span>{p.name}</span>
          </button>
        ))}
      </nav>
      <div style={capsTaglineStyle}>{persona.tagline}</div>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={scrollRef} onScroll={handleScroll} style={{ height: "100%", overflowY: "auto" }}>
          <div style={{ maxWidth: 780, margin: "0 auto", padding: "20px 20px 8px", display: "flex", flexDirection: "column", gap: 14 }}>
            {messages.length === 0 && (
              <div style={{ color: "#8c8c8c", fontSize: 14, marginTop: 8 }}>
                {persona.isCasting
                  ? "Attach a script PDF and (optionally) a note describing what you're looking for, then send."
                  : `Ask ${persona.name} anything, try one of the suggestions below, or attach a signed contract PDF to auto-update licensing.`}
              </div>
            )}
            {messages.map((m, i) => {
              let cleaned = m.content || "";
              let groups = null;
              let regions = null;
              if (m.role === "assistant" && m.kind !== "casting" && m.kind !== "memo" && m.kind !== "contract") {
                ({ cleaned, groups } = extractThumbnails(cleaned));
                ({ cleaned, regions } = extractRegions(cleaned));
              }
              const isLast = i === messages.length - 1;
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={m.role === "user" ? userBubbleStyle : assistantBubbleStyle}>
                    {m.role === "user" ? (
                      <div style={{ whiteSpace: "pre-wrap" }}>
                        {m.attachment && (
                          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: m.content ? 4 : 0, display: "flex", alignItems: "center", gap: 4 }}>
                            📎 {m.attachment}
                          </div>
                        )}
                        {m.content}
                      </div>
                    ) : m.kind === "casting" ? (
                      <CastingResult result={m.castingResult} error={m.castingError} loading={m.castingLoading} filename={m.castingFilename} />
                    ) : m.kind === "memo" ? (
                      <ComplianceMemo result={m.memoResult} error={m.memoError} loading={m.memoLoading} titleName={m.memoTitleName} />
                    ) : m.kind === "contract" ? (
                      <ContractIngestResult result={m.contractResult} error={m.contractError} loading={m.contractLoading} filename={m.contractFilename} />
                    ) : (
                      <>
                        {cleaned === "" && m.streaming && !(m.toolCalls && m.toolCalls.length) ? (
                          <ThinkingIndicator />
                        ) : cleaned !== "" ? (
                          <>
                            <RegionBadge regions={regions} />
                            <ReactMarkdown
                              components={{
                                img: ({ node, ...props }) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    {...props}
                                    style={{ width: 90, height: "auto", borderRadius: 6, display: "inline-block", verticalAlign: "top", margin: "4px 6px 4px 0" }}
                                  />
                                ),
                                p: ({ node, ...props }) => <p style={{ margin: "0 0 8px" }} {...props} />,
                              }}
                            >
                              {normalizeImageSpacing(cleaned)}
                            </ReactMarkdown>
                            {groups && <ThumbnailComparison groups={groups} />}
                          </>
                        ) : null}
                        {m.toolCalls && m.toolCalls.length > 0 && <SourcesUsed toolCalls={m.toolCalls} pending={m.streaming} />}
                        {m.role === "assistant" && m.streaming && cleaned !== "" && <span className="blink-cursor">▍</span>}
                      </>
                    )}
                  </div>
                  {m.role === "assistant" && !m.streaming && m.kind !== "casting" && m.kind !== "memo" && m.kind !== "contract" && (
                    <div style={{ maxWidth: "85%", marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                      {(m.followups?.length > 0 || m.followupsLoading) &&
                        (m.followupsLoading ? (
                          <div style={{ fontSize: 11, color: "#8c8c8c", marginTop: 6 }}>Finding follow-ups…</div>
                        ) : (
                          <QuestionChips
                            label="Follow up:"
                            questions={m.followups}
                            onPick={(q) => {
                              markAsked(q);
                              sendChatMessage(q);
                            }}
                            disabled={loading}
                            variant="followup"
                          />
                        ))}
                      {isLast && canRegenerate && (
                        <button onClick={regenerateLast} style={regenerateBtnStyle}>
                          ↻ Regenerate
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>

        {!pinnedToBottom && (
          <button onClick={scrollToBottom} style={scrollToBottomBtnStyle} aria-label="Scroll to latest message">
            ↓
          </button>
        )}
      </div>

      <div style={{ flexShrink: 0, maxWidth: 780, width: "100%", margin: "0 auto", padding: "10px 20px 20px", boxSizing: "border-box" }}>
        {visibleSamples.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <QuestionChips
              label={suggestionsLabel}
              questions={visibleSamples}
              onPick={handleChipClick}
              disabled={loading}
              variant="sample"
            />
          </div>
        )}

        {attachedFile && (
          <div style={attachedFileStyle}>
            📎 {attachedFile.name}
            <button type="button" onClick={() => setAttachedFile(null)} aria-label="Remove attachment" style={removeAttachmentBtnStyle}>
              ✕
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => setAttachedFile(e.target.files?.[0] || null)}
            style={{ display: "none" }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            title={persona.isCasting ? "Attach a script PDF for a casting recommendation" : "Attach a signed contract PDF to auto-update licensing"}
            aria-label={persona.isCasting ? "Attach a script PDF" : "Attach a contract PDF"}
            style={attachBtnStyle(loading)}
          >
            📎
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResizeTextarea();
            }}
            onKeyDown={handleComposerKeyDown}
            rows={1}
            placeholder={
              attachedFile
                ? persona.isCasting
                  ? "Add a note (optional) and send for a casting recommendation..."
                  : "Add a note (optional) and send to auto-update licensing..."
                : persona.isCasting
                ? "Describe what you're looking for, or just attach a script and send..."
                : `Ask about ${persona.name.toLowerCase()}... (Shift+Enter for a new line)`
            }
            style={textareaStyle}
          />
          {loading ? (
            <button type="button" onClick={handleStop} style={stopBtnStyle}>
              ■ Stop
            </button>
          ) : (
            <button type="submit" style={sendBtnStyle(false)}>
              Send
            </button>
          )}
        </form>
      </div>

      {historyOpen && (
        <>
          <div style={drawerOverlayStyle} onClick={() => setHistoryOpen(false)} />
          <div style={drawerStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 18px", borderBottom: "1px solid #2a2a2a" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>Past sessions</div>
              <button onClick={() => setHistoryOpen(false)} style={removeAttachmentBtnStyle} aria-label="Close history">
                ✕
              </button>
            </div>
            <div style={{ overflowY: "auto", flex: 1, padding: "8px 10px" }}>
              {historyLoading ? (
                <div style={{ color: "#8c8c8c", fontSize: 13, padding: 10 }}>Loading…</div>
              ) : historyList.length === 0 ? (
                <div style={{ color: "#8c8c8c", fontSize: 13, padding: 10 }}>No past sessions for {persona.name} yet.</div>
              ) : (
                historyList.map((s) => (
                  <button key={s.id} onClick={() => resumeSession(s.id)} style={historyItemStyle(s.id === sessionId)}>
                    <div style={{ fontSize: 13, color: "#e5e5e5", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.preview || "(empty)"}
                    </div>
                    <div style={{ fontSize: 11, color: "#8c8c8c" }}>{relativeTime(s.last_active_at)}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const backBtnStyle = {
  background: "transparent",
  border: "1px solid #3a3a3a",
  color: "#e5e5e5",
  width: 32,
  height: 32,
  borderRadius: "50%",
  cursor: "pointer",
  fontSize: 16,
};

const ctaBtnStyleSmall = {
  background: "#E50914",
  border: "none",
  color: "#fff",
  padding: "10px 20px",
  borderRadius: 4,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const capsNavStyle = {
  flexShrink: 0,
  display: "flex",
  gap: 6,
  padding: "10px 20px 0",
  overflowX: "auto",
};

const capsPillStyle = (active) => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
  flexShrink: 0,
  background: active ? "rgba(229,9,20,0.15)" : "transparent",
  border: `1px solid ${active ? "#E50914" : "#2e2e2e"}`,
  color: active ? "#fff" : "#a3a3a3",
  fontWeight: active ? 700 : 500,
  fontSize: 12,
  padding: "7px 12px",
  borderRadius: 999,
  cursor: active ? "default" : "pointer",
});

const capsTaglineStyle = {
  flexShrink: 0,
  padding: "8px 20px 4px",
  fontSize: 12,
  color: "#8c8c8c",
  borderBottom: "1px solid #232323",
};

const headerActionBtnStyle = {
  background: "transparent",
  border: "1px solid #3a3a3a",
  color: "#d2d2d2",
  padding: "7px 14px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const userBubbleStyle = {
  maxWidth: "85%",
  background: "#E50914",
  color: "#fff",
  padding: "10px 14px",
  borderRadius: "12px 12px 2px 12px",
  lineHeight: 1.5,
  fontSize: 14,
};

const assistantBubbleStyle = {
  maxWidth: "85%",
  background: "#1f1f1f",
  color: "#e5e5e5",
  padding: "10px 14px",
  borderRadius: "12px 12px 12px 2px",
  lineHeight: 1.5,
  fontSize: 14,
  border: "1px solid #2a2a2a",
};

const regenerateBtnStyle = {
  alignSelf: "flex-start",
  background: "none",
  border: "1px solid #3a3a3a",
  color: "#a3a3a3",
  fontSize: 11,
  padding: "5px 10px",
  borderRadius: 999,
  cursor: "pointer",
};

const scrollToBottomBtnStyle = {
  position: "absolute",
  bottom: 16,
  left: "50%",
  transform: "translateX(-50%)",
  background: "#E50914",
  color: "#fff",
  border: "none",
  width: 34,
  height: 34,
  borderRadius: "50%",
  cursor: "pointer",
  fontSize: 16,
  boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
};

const attachedFileStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  color: "#d2d2d2",
  background: "#1f1f1f",
  border: "1px solid #3a3a3a",
  borderRadius: 8,
  padding: "6px 10px",
  marginBottom: 10,
  alignSelf: "flex-start",
};

const removeAttachmentBtnStyle = {
  background: "none",
  border: "none",
  color: "#a3a3a3",
  cursor: "pointer",
  fontSize: 14,
};

const attachBtnStyle = (loading) => ({
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #3a3a3a",
  background: "#1f1f1f",
  color: "#a3a3a3",
  cursor: loading ? "default" : "pointer",
  fontSize: 16,
});

const textareaStyle = {
  flex: 1,
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #3a3a3a",
  background: "#1f1f1f",
  color: "#fff",
  fontSize: 14,
  fontFamily: "inherit",
  resize: "none",
  maxHeight: 160,
  lineHeight: 1.4,
};

const sendBtnStyle = (loading) => ({
  padding: "10px 22px",
  borderRadius: 8,
  border: "none",
  background: loading ? "#444" : "#E50914",
  color: "#fff",
  fontWeight: 700,
  cursor: loading ? "default" : "pointer",
  fontSize: 14,
});

const stopBtnStyle = {
  padding: "10px 22px",
  borderRadius: 8,
  border: "1px solid #E50914",
  background: "transparent",
  color: "#E50914",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 14,
};

const drawerOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  zIndex: 8,
};

const drawerStyle = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: 320,
  maxWidth: "88vw",
  background: "#181818",
  borderLeft: "1px solid #2a2a2a",
  zIndex: 9,
  display: "flex",
  flexDirection: "column",
  boxShadow: "-8px 0 24px rgba(0,0,0,0.5)",
};

const historyItemStyle = (active) => ({
  display: "block",
  width: "100%",
  textAlign: "left",
  background: active ? "#262626" : "transparent",
  border: "none",
  borderRadius: 6,
  padding: "10px 10px",
  cursor: "pointer",
  marginBottom: 2,
});
