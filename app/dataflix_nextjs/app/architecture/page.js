"use client";

// The interactive architecture map, restyled to match the rest of Dataflix
// (same #141414/#E50914/Bebas Neue+Inter tokens as chat/capabilities) rather
// than living as an isolated iframe with its own visual system. Node/
// connection/detail content is unchanged from the standalone version --
// grounded directly in PLAN.md and the real codebase -- only the skin and
// the render mechanism (React instead of hand-rolled DOM manipulation)
// changed.

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import ARCH from "../../lib/architectureData.json";
import ICONS from "../../lib/architectureIcons.json";

const { nodes: NODES, connections: CONNECTIONS, layers: LAYERS, details: DETAILS } = ARCH;

// No Databricks icon exists for "external, non-Databricks data" -- a plain
// muted glyph in the outline-icon style, deliberately unbranded so it reads
// as "outside the platform" next to the colorful Databricks icons everywhere else.
const EXTERNAL_ICON =
  '<circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<ellipse cx="24" cy="24" rx="15" ry="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
  '<line x1="9" y1="24" x2="39" y2="24" stroke="currentColor" stroke-width="1.4"/>' +
  '<path d="M24 9 C 17 16, 17 32, 24 39" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
  '<path d="M24 9 C 31 16, 31 32, 24 39" fill="none" stroke="currentColor" stroke-width="1.4"/>';

function IconSvg({ id, size = 26 }) {
  const inner = id === "__external__" ? EXTERNAL_ICON : ICONS[id] || "";
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

const RED = "#E50914";

function pickAnchor(a, b) {
  const dx = (b.left + b.right) / 2 - (a.left + a.right) / 2;
  const dy = (b.top + b.bottom) / 2 - (a.top + a.bottom) / 2;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy > 0
      ? { x1: (a.left + a.right) / 2, y1: a.bottom, x2: (b.left + b.right) / 2, y2: b.top, vert: true }
      : { x1: (a.left + a.right) / 2, y1: a.top, x2: (b.left + b.right) / 2, y2: b.bottom, vert: true };
  }
  return dx > 0
    ? { x1: a.right, y1: (a.top + a.bottom) / 2, x2: b.left, y2: (b.top + b.bottom) / 2, vert: false }
    : { x1: a.left, y1: (a.top + a.bottom) / 2, x2: b.right, y2: (b.top + b.bottom) / 2, vert: false };
}

function pathFor(p) {
  if (p.vert) {
    const midY = (p.y1 + p.y2) / 2;
    return `M ${p.x1},${p.y1} C ${p.x1},${midY} ${p.x2},${midY} ${p.x2},${p.y2}`;
  }
  const midX = (p.x1 + p.x2) / 2;
  return `M ${p.x1},${p.y1} C ${midX},${p.y1} ${midX},${p.y2} ${p.x2},${p.y2}`;
}

const HERO_STATS = [
  ["11", "components mapped"],
  ["4", "Genie spaces"],
  ["7", "AI Functions in play"],
  ["130", "real TMDB titles"],
  ["10+30", "real / synthetic documents"],
];

export default function ArchitecturePage() {
  const router = useRouter();
  const stageRef = useRef(null);
  const nodeRefs = useRef({});
  const detailRefs = useRef({});
  const [paths, setPaths] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [pulseKey, setPulseKey] = useState(null);

  const recompute = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const rects = {};
    NODES.forEach((n) => {
      const el = nodeRefs.current[n.id];
      if (!el) return;
      const r = el.getBoundingClientRect();
      rects[n.id] = {
        left: r.left - stageRect.left,
        right: r.right - stageRect.left,
        top: r.top - stageRect.top,
        bottom: r.bottom - stageRect.top,
      };
    });
    const next = CONNECTIONS.map(([a, b]) => {
      const A = rects[a], B = rects[b];
      if (!A || !B) return null;
      return pathFor(pickAnchor(A, B));
    }).filter(Boolean);
    setPaths(next);
  }, []);

  useEffect(() => {
    recompute();
    const onResize = () => {
      clearTimeout(onResize._t);
      onResize._t = setTimeout(recompute, 120);
    };
    window.addEventListener("resize", onResize);
    const raf1 = requestAnimationFrame(() => requestAnimationFrame(recompute));
    if (document.fonts?.ready) document.fonts.ready.then(recompute);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf1);
    };
  }, [recompute]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          setActiveId(e.target.dataset.id);
        });
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 }
    );
    Object.values(detailRefs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  function jumpTo(id) {
    const el = detailRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setPulseKey(`${id}-${Date.now()}`);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#141414", color: "#e5e5e5" }}>
      <style>{`
        @keyframes archPulse {
          0% { box-shadow: 0 0 0 0 rgba(229,9,20,.55); border-color: ${RED}; }
          70% { box-shadow: 0 0 0 20px rgba(229,9,20,0); border-color: ${RED}; }
          100% { box-shadow: 0 0 0 0 rgba(229,9,20,0); border-color: #333; }
        }
        @keyframes archDash { to { stroke-dashoffset: -20; } }
        .arch-pulse { animation: archPulse 1.4s ease; }
        .arch-flow { animation: archDash 1.8s linear infinite; }
        .arch-node:hover { transform: translateY(-3px); border-color: ${RED} !important; }
        .arch-node:hover .arch-cta { opacity: 1 !important; transform: translateX(0) !important; }
        .arch-jumpchip:hover { color: #fff !important; border-color: rgba(255,255,255,0.45) !important; }
        @media (prefers-reduced-motion: reduce) {
          .arch-flow { animation: none; }
          .arch-pulse { animation: none; }
        }
      `}</style>

      {/* ---------- header, matching the chat page's chrome ---------- */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid #232323",
          background: "rgba(20,20,20,.9)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={() => router.push("/")} style={backBtnStyle} aria-label="Back home">
            ←
          </button>
          <div style={{ fontFamily: "'Bebas Neue', 'Inter', sans-serif", color: RED, fontSize: 20, letterSpacing: 1.5 }}>
            DATAFLIX
          </div>
          <div style={{ fontSize: 12, color: "#8c8c8c", borderLeft: "1px solid #333", paddingLeft: 14 }}>
            System Architecture
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", maxWidth: "56vw" }}>
          {NODES.map((n) => (
            <button
              key={n.id}
              className="arch-jumpchip"
              onClick={() => jumpTo(n.id)}
              style={jumpChipStyle(activeId === n.id)}
            >
              {n.name}
            </button>
          ))}
        </div>
      </header>

      {/* ---------- hero ---------- */}
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "48px 24px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: RED, boxShadow: `0 0 12px 1px rgba(229,9,20,.7)` }} />
          <span style={{ fontFamily: "'Bebas Neue', 'Inter', sans-serif", fontSize: 13, letterSpacing: 2, color: "#8c8c8c", textTransform: "uppercase" }}>
            Databricks-native &middot; multi-agent &middot; free edition
          </span>
        </div>
        <h1
          style={{
            fontFamily: "'Bebas Neue', 'Inter', sans-serif",
            fontWeight: 400,
            fontSize: "clamp(34px,4.4vw,56px)",
            lineHeight: 1.08,
            letterSpacing: 0.5,
            margin: "0 0 18px",
            maxWidth: 900,
          }}
        >
          Every request, traced from the <span style={{ color: RED }}>browser</span> down to the{" "}
          <span style={{ color: RED }}>foundation model</span>.
        </h1>
        <p style={{ maxWidth: "62ch", color: "#a3a3a3", fontSize: 15.5, lineHeight: 1.6, margin: "0 0 22px" }}>
          Dataflix is a multi-agent assistant for streaming content strategy: four persona-tuned Genie spaces, a
          retrieval-augmented Document Agent, and three fully generative pipelines (casting, compliance memos,
          contract ingestion) &mdash; all sitting on one Unity Catalog and one shared SQL warehouse. This map traces
          the real system, not a simplified stand-in.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {HERO_STATS.map(([v, l]) => (
            <span key={l} style={statChipStyle}>
              <b style={{ color: "#fff" }}>{v}</b>&nbsp;{l}
            </span>
          ))}
        </div>
      </div>

      {/* ---------- high-level diagram ---------- */}
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 24px 56px" }}>
        <div style={eyebrowStyle}>01 &mdash; High-level architecture</div>
        <div style={sectionTitleStyle}>Click any component to open its detailed architecture</div>
        <p style={sectionSubStyle}>
          Layered top to bottom by request flow: the client, the orchestration layer, retrieval, then the shared
          data &amp; compute foundation underneath everything.
        </p>

        <div ref={stageRef} style={{ position: "relative" }}>
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", zIndex: 1 }}>
            <defs>
              <marker id="arch-arrow" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={RED} fillOpacity="0.6" />
              </marker>
            </defs>
            {paths.map((d, i) => (
              <path
                key={i}
                d={d}
                className="arch-flow"
                fill="none"
                stroke={RED}
                strokeOpacity="0.4"
                strokeWidth="1.4"
                strokeDasharray="5 5"
                markerEnd="url(#arch-arrow)"
              />
            ))}
          </svg>

          <div style={{ position: "relative", zIndex: 2, display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 14 }}>
            {NODES.map((n) => {
              const [c1, c2, r1, r2] = n.grid.split("/").map((s) => s.trim());
              return (
                <div
                  key={n.id}
                  ref={(el) => (nodeRefs.current[n.id] = el)}
                  className="arch-node"
                  onClick={() => jumpTo(n.id)}
                  style={{
                    gridColumn: `${c1} / ${c2}`,
                    gridRow: `${r1} / ${r2}`,
                    ...nodeCardStyle,
                  }}
                >
                  <div style={nodeIconTileStyle}>
                    <IconSvg id={n.icon} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={nodeEyebrowStyle}>{n.eyebrow}</div>
                    <div style={nodeNameStyle}>{n.name}</div>
                    <div style={nodeTaglineStyle}>{n.tagline}</div>
                    <div className="arch-cta" style={nodeCtaStyle}>&darr; view detailed architecture</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---------- detail sections ---------- */}
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 24px 40px" }}>
        <div style={eyebrowStyle}>02 &mdash; Detailed architecture</div>
        <div style={sectionTitleStyle}>Every component, in request-flow order</div>
        <p style={sectionSubStyle}>
          Scroll through directly, or jump here by clicking a node above &mdash; each section flashes red so you
          always know you landed in the right place.
        </p>

        {NODES.map((n) => {
          const d = DETAILS[n.id];
          const isPulsing = pulseKey && pulseKey.startsWith(`${n.id}-`);
          return (
            <section
              key={n.id}
              data-id={n.id}
              ref={(el) => (detailRefs.current[n.id] = el)}
              className={isPulsing ? "arch-pulse" : ""}
              onAnimationEnd={() => setPulseKey(null)}
              style={detailSectionStyle}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, marginBottom: 22 }}>
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <div style={detailIconTileStyle}>
                    <IconSvg id={n.icon} size={30} />
                  </div>
                  <div>
                    <div style={nodeEyebrowStyle}>{n.eyebrow}</div>
                    <h3 style={detailNameStyle}>{n.name}</h3>
                    <p style={{ color: "#a3a3a3", fontSize: 14, lineHeight: 1.6, maxWidth: "72ch", margin: 0 }}>
                      {d.subtitle}
                    </p>
                  </div>
                </div>
                <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} style={backToMapStyle}>
                  &uarr; back to top
                </button>
              </div>

              {d.facts?.length > 0 && (
                <div style={factsGridStyle}>
                  {d.facts.map(([label, value]) => (
                    <div key={label} style={factStyle}>
                      <div style={factLabelStyle}>{label}</div>
                      <div style={factValueStyle}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {d.items?.length > 0 && (
                <>
                  <div style={itemsLabelStyle}>Components</div>
                  <div style={itemsGridStyle}>
                    {d.items.map(([name, desc]) => (
                      <div key={name} style={itemCardStyle}>
                        <div style={itemNameStyle}>{name}</div>
                        <div style={itemDescStyle}>{desc}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {d.flow?.length > 0 && (
                <>
                  <div style={itemsLabelStyle}>Request flow</div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    {d.flow.map((step, i) => (
                      <span key={step} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={flowStepStyle}>{step}</span>
                        {i < d.flow.length - 1 && <span style={{ color: RED }}>&rarr;</span>}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>

      {/* ---------- minimap rail ---------- */}
      <div style={minimapStyle}>
        {NODES.map((n) => (
          <span
            key={n.id}
            onClick={() => jumpTo(n.id)}
            title={n.name}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              cursor: "pointer",
              background: activeId === n.id ? RED : "#3a3a3a",
              boxShadow: activeId === n.id ? "0 0 0 3px rgba(229,9,20,.2)" : "none",
              transition: "background .15s, box-shadow .15s",
            }}
          />
        ))}
      </div>

      <footer
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "24px 24px 60px",
          color: "#5b5b5b",
          fontSize: 12,
          borderTop: "1px solid #232323",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <span>Architecture icons courtesy of Databricks. Every table, function, and endpoint named here exists in the real build.</span>
        <button
          onClick={() => router.push("/")}
          style={{ background: "transparent", border: "1px solid #333", color: "#8c8c8c", fontSize: 12, padding: "7px 14px", borderRadius: 999, cursor: "pointer" }}
        >
          &larr; Back to Dataflix
        </button>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Style constants -- same conventions (dark cards, red accent, Bebas Neue */
/* eyebrows, Inter body) already used across chat/capabilities pages.     */
/* ---------------------------------------------------------------------- */

const backBtnStyle = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.25)",
  color: "#fff",
  width: 32,
  height: 32,
  borderRadius: "50%",
  cursor: "pointer",
  fontSize: 16,
};

const jumpChipStyle = (active) => ({
  flex: "none",
  fontFamily: "'Bebas Neue', 'Inter', sans-serif",
  fontSize: 12,
  letterSpacing: 0.5,
  color: active ? "#fff" : "#a3a3a3",
  background: active ? RED : "rgba(255,255,255,0.06)",
  border: `1px solid ${active ? RED : "#333"}`,
  padding: "7px 12px",
  borderRadius: 999,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "color .15s, border-color .15s, background .15s",
});

const statChipStyle = {
  fontSize: 12,
  color: "#a3a3a3",
  border: "1px solid #333",
  background: "#1a1a1a",
  padding: "7px 12px",
  borderRadius: 8,
};

const eyebrowStyle = {
  fontFamily: "'Bebas Neue', 'Inter', sans-serif",
  fontSize: 13,
  letterSpacing: 2,
  textTransform: "uppercase",
  color: "#5b5b5b",
  marginBottom: 6,
};

const sectionTitleStyle = {
  fontFamily: "'Bebas Neue', 'Inter', sans-serif",
  fontSize: 26,
  letterSpacing: 0.5,
  margin: "0 0 8px",
  color: "#fff",
};

const sectionSubStyle = { color: "#8c8c8c", fontSize: 14, margin: "0 0 26px", maxWidth: "68ch" };

const nodeCardStyle = {
  background: "#1a1a1a",
  border: "1px solid #2b2b2b",
  borderLeft: `3px solid #3a3a3a`,
  borderRadius: 10,
  padding: "16px 18px",
  cursor: "pointer",
  display: "flex",
  gap: 13,
  alignItems: "flex-start",
  transition: "transform .15s ease, border-color .15s ease",
};

const nodeIconTileStyle = {
  width: 44,
  height: 44,
  flexShrink: 0,
  borderRadius: 9,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.08)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const nodeEyebrowStyle = {
  fontFamily: "'Bebas Neue', 'Inter', sans-serif",
  fontSize: 11,
  letterSpacing: 1.4,
  textTransform: "uppercase",
  color: "#e5595f",
  marginBottom: 3,
};

const nodeNameStyle = { fontWeight: 700, fontSize: 14.5, marginBottom: 4, color: "#fff" };
const nodeTaglineStyle = { fontSize: 12.5, color: "#a3a3a3", lineHeight: 1.45 };
const nodeCtaStyle = {
  fontSize: 10.5,
  color: "#5b5b5b",
  marginTop: 8,
  opacity: 0,
  transform: "translateX(-4px)",
  transition: "opacity .15s, transform .15s",
};

const detailSectionStyle = {
  border: "1px solid #232323",
  borderTop: `2px solid ${RED}`,
  borderRadius: 14,
  background: "#181818",
  padding: "28px clamp(18px,3vw,34px)",
  marginBottom: 20,
};

const detailIconTileStyle = {
  width: 54,
  height: 54,
  flexShrink: 0,
  borderRadius: 12,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.08)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const detailNameStyle = {
  fontFamily: "'Bebas Neue', 'Inter', sans-serif",
  fontSize: 22,
  letterSpacing: 0.3,
  margin: "2px 0 8px",
  color: "#fff",
};

const backToMapStyle = {
  fontSize: 11,
  color: "#8c8c8c",
  background: "transparent",
  border: "1px solid #333",
  padding: "6px 12px",
  borderRadius: 999,
  cursor: "pointer",
  flexShrink: 0,
};

const factsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
  gap: 1,
  background: "#232323",
  border: "1px solid #232323",
  borderRadius: 10,
  overflow: "hidden",
  marginBottom: 22,
};

const factStyle = { background: "#1f1f1f", padding: "12px 15px" };
const factLabelStyle = { fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: "#6b6b6b", marginBottom: 5 };
const factValueStyle = { fontSize: 13, color: "#d2d2d2", lineHeight: 1.5 };

const itemsLabelStyle = { fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#6b6b6b", margin: "0 0 12px", fontWeight: 700 };
const itemsGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 10, marginBottom: 6 };
const itemCardStyle = { background: "#1f1f1f", border: "1px solid #2b2b2b", borderRadius: 8, padding: "12px 14px" };
const itemNameStyle = { fontWeight: 700, fontSize: 12.5, marginBottom: 4, color: "#fff" };
const itemDescStyle = { fontSize: 12.5, color: "#a3a3a3", lineHeight: 1.5 };

const flowStepStyle = {
  fontSize: 12,
  color: "#e5e5e5",
  background: "#1f1f1f",
  border: "1px solid #333",
  borderRadius: 999,
  padding: "8px 14px",
};

const minimapStyle = {
  position: "fixed",
  right: 16,
  top: "50%",
  transform: "translateY(-50%)",
  zIndex: 30,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "12px 8px",
  borderRadius: 999,
  background: "rgba(24,24,24,.8)",
  border: "1px solid #2b2b2b",
};
