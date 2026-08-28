"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PERSONAS } from "../../lib/personas";

// A standalone, detailed reference page -- not part of the intro story, not
// a gate before chat. Every persona (see lib/personas.js `detail`) is
// reachable directly from here, and from the chat page's capabilities
// navbar at any time, since persona is a UI framing layer, not a hard scope.
// Same cinematic slide chrome as the landing-page intro, but manual-nav only
// (no autoplay) -- this is a reference someone browses at their own pace,
// not a passive story.
const SLIDES = PERSONAS.map((p) => ({
  id: p.id,
  icon: p.icon,
  kicker: p.name,
  title: p.story ? p.story.title : "Not Sure\nWhere To Start?",
  solves: p.detail?.solves,
  impact: p.detail?.impact,
  questions: p.questions?.slice(0, 3) || [],
  isCasting: p.isCasting,
  backdrop: p.backdrop,
}));

export default function CapabilitiesPage() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];

  function goTo(i) {
    setIndex(Math.max(0, Math.min(SLIDES.length - 1, i)));
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden", background: "#000" }}>
      {SLIDES.map((s, i) => (
        <div
          key={s.id}
          aria-hidden={i !== index}
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `linear-gradient(to top, #000 5%, rgba(0,0,0,0.6) 45%, rgba(0,0,0,0.9) 100%), linear-gradient(to right, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 55%, rgba(0,0,0,0.8) 100%), url(${s.backdrop})`,
            backgroundSize: "cover",
            backgroundPosition: "center 20%",
            opacity: i === index ? 1 : 0,
            transition: "opacity 500ms ease",
          }}
        />
      ))}

      <div
        style={{
          position: "relative",
          zIndex: 2,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          padding: "28px 6vw",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => router.push("/")} style={topLinkStyle}>
            ← Home
          </button>
          <div style={{ fontFamily: "'Bebas Neue', 'Inter', sans-serif", letterSpacing: 2, fontSize: 22, color: "#E50914", fontWeight: 700 }}>
            DATAFLIX CAPABILITIES
          </div>
          <div style={{ fontSize: 13, color: "#8c8c8c" }}>
            {index + 1} / {SLIDES.length}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 24 }}>
          <button onClick={() => goTo(index - 1)} disabled={index === 0} style={arrowBtnStyle(index === 0)} aria-label="Previous">
            ‹
          </button>

          <div style={{ flex: 1, maxWidth: 680 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>{slide.icon}</div>
            <div style={{ color: "#E50914", fontWeight: 700, letterSpacing: 3, fontSize: 13, marginBottom: 14, textTransform: "uppercase" }}>
              {slide.kicker}
            </div>
            <h1
              style={{
                fontFamily: "'Bebas Neue', 'Inter', sans-serif",
                fontSize: "clamp(34px, 5.5vw, 60px)",
                lineHeight: 1.05,
                margin: "0 0 20px",
                whiteSpace: "pre-line",
                color: "#fff",
              }}
            >
              {slide.title}
            </h1>

            {slide.solves && (
              <div style={{ marginBottom: 14 }}>
                <div style={labelStyle}>What it solves</div>
                <p style={bodyTextStyle}>{slide.solves}</p>
              </div>
            )}
            {slide.impact && (
              <div style={{ marginBottom: 20 }}>
                <div style={labelStyle}>How it helps media companies</div>
                <p style={bodyTextStyle}>{slide.impact}</p>
              </div>
            )}

            {slide.questions.length > 0 && (
              <div style={{ marginBottom: 26 }}>
                <div style={labelStyle}>{slide.isCasting ? "Try a brief like" : "Ask things like"}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {slide.questions.map((q) => (
                    <span key={q} style={exampleChipStyle}>
                      {q}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button onClick={() => router.push(`/chat/${slide.id}`)} style={ctaBtnStyle}>
                Open this assistant →
              </button>
              {index < SLIDES.length - 1 && (
                <button onClick={() => goTo(index + 1)} style={nextBtnStyle}>
                  Next role →
                </button>
              )}
            </div>
          </div>

          <button onClick={() => goTo(index + 1)} disabled={index === SLIDES.length - 1} style={arrowBtnStyle(index === SLIDES.length - 1)} aria-label="Next">
            ›
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, paddingBottom: 20, justifyContent: "center" }}>
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => goTo(i)}
              aria-label={`Go to ${s.kicker}`}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                border: "none",
                cursor: "pointer",
                padding: 0,
                background: i === index ? "#E50914" : "rgba(255,255,255,0.25)",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const topLinkStyle = {
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.4)",
  color: "#fff",
  padding: "8px 16px",
  borderRadius: 4,
  fontSize: 13,
  cursor: "pointer",
};

const arrowBtnStyle = (disabled) => ({
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.25)",
  color: "#fff",
  width: 44,
  height: 44,
  borderRadius: "50%",
  fontSize: 22,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.25 : 1,
  flexShrink: 0,
});

const labelStyle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  color: "#E50914",
  textTransform: "uppercase",
  marginBottom: 4,
};

const bodyTextStyle = {
  fontSize: 15,
  color: "#d2d2d2",
  lineHeight: 1.55,
  margin: 0,
};

const exampleChipStyle = {
  fontSize: 12,
  color: "#e5e5e5",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.3)",
  borderRadius: 999,
  padding: "6px 12px",
};

const ctaBtnStyle = {
  background: "#E50914",
  border: "none",
  color: "#fff",
  padding: "12px 24px",
  borderRadius: 4,
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
};

const nextBtnStyle = {
  background: "rgba(255,255,255,0.12)",
  border: "1px solid rgba(255,255,255,0.35)",
  color: "#fff",
  padding: "12px 24px",
  borderRadius: 4,
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
