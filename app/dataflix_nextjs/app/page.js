"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PERSONAS } from "../lib/personas";

// The intro is one continuous story, not a feature list: a cold open, the
// problem, a turn into "six points of view" that cuts through each real
// persona's business case (pulled straight from lib/personas.js so this
// can't drift out of sync with the actual roles), then proof, then the CTA.
const SLIDES = [
  {
    kicker: "10:47 PM",
    title: "A License Is About\nTo Expire. Nobody\nNotices.",
    body: "Somewhere in your catalog, a renewal deadline is closing in — and the answer is scattered across five dashboards nobody's watching.",
    backdrop: "/thumbnails/movie_1291608_dramatic_regrade.jpg",
  },
  {
    kicker: "THE PROBLEM",
    title: "One Question.\nFive Places\nTo Look.",
    body: "Engagement here. Licensing there. Compliance in a PDF nobody's opened since last year. By the time you've found the answer, it isn't urgent anymore — it's too late.",
    backdrop: "/thumbnails/movie_969681_dramatic_regrade.jpg",
  },
  {
    kicker: "THE TURN",
    title: "One Platform.\nSix Points\nOf View.",
    body: "Same data. Six different people, six different questions, every single day.",
    list: PERSONAS.filter((p) => p.story).map((p) => `${p.icon} ${p.story.title.replace(/\n/g, " ")}`),
    backdrop: "/thumbnails/movie_1083381_dramatic_regrade.jpg",
  },
  {
    kicker: "THE PROOF",
    title: "No Placeholder\nData. No Guessing.",
    body: "Real titles. Real actors. Real regulatory filings from six countries. This isn't a demo built on fake numbers.",
    backdrop: "/thumbnails/movie_454639_dramatic_regrade.jpg",
  },
  {
    kicker: "YOUR STORY STARTS NOW",
    title: "Roll Credits.\nAsk Anything.",
    body: "No role to pick, no gate to get through — jump straight in, and switch lenses any time from the navbar.",
    backdrop: "/thumbnails/movie_1275779_dramatic_regrade.jpg",
    isFinal: true,
  },
];

const AUTOPLAY_MS = 7000;

function IntroSlider({ onFinish }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const timerRef = useRef(null);

  function resetTimer() {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIndex((i) => (i + 1 < SLIDES.length ? i + 1 : i));
    }, AUTOPLAY_MS);
  }

  useEffect(() => {
    resetTimer();
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function goTo(i) {
    setIndex(Math.max(0, Math.min(SLIDES.length - 1, i)));
  }

  const slide = SLIDES[index];

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden", background: "#000" }}>
      {SLIDES.map((s, i) => (
        <div
          key={s.title}
          aria-hidden={i !== index}
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `linear-gradient(to top, #000 5%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.85) 100%), linear-gradient(to right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.75) 100%), url(${s.backdrop})`,
            backgroundSize: "cover",
            backgroundPosition: "center 20%",
            opacity: i === index ? 1 : 0,
            transition: "opacity 900ms ease",
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
          <div
            style={{
              fontFamily: "'Bebas Neue', 'Inter', sans-serif",
              letterSpacing: 2,
              fontSize: 28,
              color: "#E50914",
              fontWeight: 700,
            }}
          >
            DATAFLIX
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => router.push("/capabilities")} style={skipBtnStyle}>
              What Can It Do?
            </button>
            <button onClick={onFinish} style={skipBtnStyle}>
              Skip Intro
            </button>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 640 }}>
          <div
            style={{
              color: "#E50914",
              fontWeight: 700,
              letterSpacing: 3,
              fontSize: 13,
              marginBottom: 14,
              textTransform: "uppercase",
            }}
          >
            {slide.kicker}
          </div>
          <h1
            style={{
              fontFamily: "'Bebas Neue', 'Inter', sans-serif",
              fontSize: "clamp(40px, 7vw, 76px)",
              lineHeight: 1.02,
              margin: "0 0 20px",
              whiteSpace: "pre-line",
              color: "#fff",
            }}
          >
            {slide.title}
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: "#d2d2d2", maxWidth: 560, margin: slide.list ? "0 0 18px" : "0 0 28px" }}>
            {slide.body}
          </p>

          {slide.list && (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "flex", flexDirection: "column", gap: 8, maxWidth: 560 }}>
              {slide.list.map((line) => (
                <li key={line} style={{ fontSize: 15, color: "#fff", fontWeight: 600 }}>
                  {line}
                </li>
              ))}
            </ul>
          )}

          {slide.isFinal ? (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button onClick={onFinish} style={ctaBtnStyle}>
                Start Exploring →
              </button>
              <button onClick={() => router.push("/capabilities")} style={nextBtnStyle}>
                See What Each Role Does
              </button>
            </div>
          ) : (
            <button onClick={() => goTo(index + 1)} style={nextBtnStyle}>
              Next →
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, paddingBottom: 20 }}>
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              style={{
                flex: 1,
                maxWidth: 64,
                height: 4,
                borderRadius: 2,
                border: "none",
                cursor: "pointer",
                padding: 0,
                background: i === index ? "#E50914" : "rgba(255,255,255,0.25)",
                transition: "background 300ms ease",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const skipBtnStyle = {
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.4)",
  color: "#fff",
  padding: "8px 16px",
  borderRadius: 4,
  fontSize: 13,
  cursor: "pointer",
  letterSpacing: 0.5,
};

const ctaBtnStyle = {
  alignSelf: "flex-start",
  background: "#E50914",
  border: "none",
  color: "#fff",
  padding: "14px 30px",
  borderRadius: 4,
  fontSize: 17,
  fontWeight: 700,
  cursor: "pointer",
};

const nextBtnStyle = {
  alignSelf: "flex-start",
  background: "rgba(255,255,255,0.12)",
  border: "1px solid rgba(255,255,255,0.35)",
  color: "#fff",
  padding: "12px 26px",
  borderRadius: 4,
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
};

export default function Home() {
  const router = useRouter();
  // No forced role selection -- lands in the General assistant, and every
  // persona (including General) stays reachable any time via the chat
  // page's capabilities navbar.
  return <IntroSlider onFinish={() => router.push("/chat/general")} />;
}
