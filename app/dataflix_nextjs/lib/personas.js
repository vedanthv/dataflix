// Persona metadata for the chat UI: sample-question pools (see the product
// doc's persona/user-story list, PLAN.md Section "Per-persona ideas") and a
// backdrop image drawn from the real thumbnail-variant assets already in
// public/thumbnails/ (see PLAN.md Section 4 -- these are real generated
// marketing creative for the two hero titles, Dhurandhar and Spider-Man:
// Brand New Day, plus other catalog titles).
//
// Persona choice does NOT change what gets sent to the Supervisor -- the
// backend is one agent across engagement/licensing/documents/content_signals
// /marketing, already tuned end-to-end (see PLAN.md Section 5-6). Persona is
// purely a UI framing: which sample/follow-up questions to suggest, and how
// turns get tagged in Lakebase session history. There is no forced "choose
// your role" gate -- every persona (including "general", the default landing
// point) is reachable any time via the chat page's capabilities navbar, and
// `detail` (below) backs the standalone /capabilities page describing what
// each one solves. `story` is only used by the intro slider's business-case
// montage and is intentionally omitted on "general", which isn't a business
// case of its own.

export const PERSONAS = [
  {
    id: "general",
    icon: "\u{1F9ED}",
    name: "General Assistant",
    tagline: "Not sure where to start? Ask anything across the whole platform.",
    backdrop: "/thumbnails/movie_1291608_dramatic_regrade.jpg",
    detail: {
      solves:
        "One place to ask anything across engagement, licensing, compliance, marketing, or casting — no need to know which team “owns” the answer.",
      impact:
        "A single entry point for anyone at a media company to get a grounded answer fast, then switch to a role-specific lens if they want more depth.",
    },
    questions: [
      "Give me a snapshot of how Dhurandhar is performing overall.",
      "What should I know about Spider-Man: Brand New Day right now?",
      "Where are the biggest risks in our catalog right now?",
      "What's trending well and what needs attention?",
      "Which titles need my attention this week?",
      "Summarize what Dataflix can help me with.",
    ],
  },
  {
    id: "content-strategy",
    icon: "\u{1F3AF}",
    name: "Content Strategy & Acquisitions",
    tagline: "Which titles are winning, and where should we invest next?",
    backdrop: "/thumbnails/movie_1291608_dramatic_regrade.jpg",
    story: {
      kicker: "THE ACQUISITIONS ANALYST",
      title: "Renew It —\nOr Let It Go?",
      body: "Dhurandhar is surging in India. The license is closing in on expiry. Is the renewal worth it, or is the engagement about to fade?",
    },
    detail: {
      solves:
        "Decides which titles to renew, promote, or retire by cutting across engagement, licensing, and content-signal data in one place instead of static reports.",
      impact:
        "Acquisitions and content teams spend less time reconciling numbers across departments and more time making the call — backed by real performance data tied to actual titles, not guesswork.",
    },
    questions: [
      "Is Dhurandhar performing well in India, and is its license expiring soon?",
      "How is Spider-Man: Brand New Day trending in the US?",
      "Which titles have the strongest completion rate right now?",
      "What's the emotional tone of Dhurandhar's poster, and could that affect engagement?",
      "Compare Dhurandhar's watch hours across all six regions.",
      "Which actors show up most often in our best-performing titles?",
      "Is our catalog too concentrated in one genre?",
      "What should we acquire more of based on current engagement trends?",
    ],
  },
  {
    id: "regional",
    icon: "\u{1F30D}",
    name: "Regional / Market Lead",
    tagline: "Where are we winning by region, and why?",
    backdrop: "/thumbnails/movie_969681_dramatic_regrade.jpg",
    story: {
      kicker: "THE MARKET LEAD",
      title: "Winning Here.\nInvisible There.",
      body: "Spider-Man: Brand New Day owns the US. In Germany, it's a ghost. Is that a content problem, or a licensing wall nobody flagged?",
    },
    detail: {
      solves:
        "Diagnoses why a title wins in one market and stalls in another — separating a genuine content/audience problem from a licensing or compliance restriction.",
      impact:
        "Global streamers can localize strategy market-by-market instead of one blanket playbook, catching underperformance before it becomes a renewal write-off.",
    },
    questions: [
      "What's underperforming in Germany, and is it a content or licensing problem?",
      "How does Dhurandhar's engagement in India compare to Brazil?",
      "Which regions have the strongest day-1 retention for Spider-Man: Brand New Day?",
      "Is our catalog skewed toward any one region?",
      "Which titles are licensed exclusively in the UK?",
      "Where should we prioritize a marketing push based on regional engagement gaps?",
      "How does license exclusivity differ between India and Japan?",
      "Which region has the best cost-to-performance ratio on renewals?",
    ],
  },
  {
    id: "marketing",
    icon: "\u{1F4E3}",
    name: "Marketing & Promotions Lead",
    tagline: "Which creative converts, and where can we run it?",
    backdrop: "/thumbnails/movie_1291608_text_overlay.jpg",
    story: {
      kicker: "THE PROMOTIONS LEAD",
      title: "One Poster.\nSix Markets.",
      body: "A thumbnail that converts in Mumbai might break an advertising rule in Berlin. Which creative actually travels, and where?",
    },
    detail: {
      solves:
        "Identifies which creative (thumbnails, title cards) actually converts, and whether it can be reused across regions or needs a market-specific variant due to differing ad/compliance rules.",
      impact:
        "Marketing teams stop guessing at creative and stop accidentally running a non-compliant ad in a stricter market — protecting both conversion and legal exposure.",
    },
    questions: [
      "Which thumbnail variant gets the best CTR for Dhurandhar?",
      "Which titles are cleared to promote in India right now?",
      "Can we reuse Dhurandhar's thumbnail across regions, or do the rules differ?",
      "What's the conversion rate on our last campaign for Spider-Man: Brand New Day?",
      "Show me the poster and title-card variants side by side for Dhurandhar.",
      "Why did the dramatic regrade variant outperform the original poster?",
      "Which campaigns had the best spend-to-conversion ratio?",
      "What creative style tends to perform best for action titles?",
    ],
  },
  {
    id: "finance",
    icon: "\u{1F4B0}",
    name: "Finance / Content Investment Lead",
    tagline: "Where is renewal spend going, and is it worth it?",
    backdrop: "/thumbnails/movie_454639_dramatic_regrade.jpg",
    story: {
      kicker: "THE INVESTMENT LEAD",
      title: "The Renewal\nBill Is Due.",
      body: "Ninety days out, exposure is stacking up across regions and license types. Nobody has added it all up. What's the real number?",
    },
    detail: {
      solves:
        "Surfaces total renewal cost exposure across time windows, regions, and license types, and flags whether a renewal is actually worth its cost given real performance.",
      impact:
        "Finance and content-investment leaders get a defensible, data-backed number for budget conversations instead of a spreadsheet stitched together once a quarter.",
    },
    questions: [
      "What's our total renewal cost exposure in the next 30 days?",
      "Which licenses are expiring soon, and what's the renewal cost estimate?",
      "Is Dhurandhar's renewal cost efficient given its performance in India?",
      "Compare renewal cost exposure across all license types for the next 90 days.",
      "Which titles have the highest renewal cost relative to their watch hours?",
      "What's the exclusivity flag breakdown across our licensing portfolio?",
      "Which region carries the most renewal risk this quarter?",
      "Are we overpaying for any underperforming titles?",
    ],
  },
  {
    id: "compliance",
    icon: "⚖️",
    name: "Compliance / Content Ops Reviewer",
    tagline: "Are we cleared, and can you show your work?",
    backdrop: "/thumbnails/movie_1083381_dramatic_regrade.jpg",
    story: {
      kicker: "THE COMPLIANCE REVIEWER",
      title: "Cleared To Air —\nOr Not?",
      body: "Six countries. Six rulebooks. One wrong assumption about a rating or a region turns into a takedown notice.",
    },
    detail: {
      solves:
        "Answers whether a title is cleared to air or advertise in a given region under that region's actual regulatory rules, and can draft a citable compliance memo on demand.",
      impact:
        "Reduces the risk of a takedown notice or regulatory penalty by grounding every compliance answer in the real regulatory text for that market, not a general assumption.",
    },
    questions: [
      "Is Dhurandhar cleared for advertising in India under current CBFC guidelines?",
      "Draft a compliance memo for Dhurandhar's upcoming license renewal.",
      "What are the takedown obligations for content in the EU under AVMSD?",
      "Is Spider-Man: Brand New Day's certification appropriate for a general audience in the UK?",
      "What's the grievance/SLA requirement for streaming platforms in India?",
      "Compare prohibited-content rules across the US, India, and the EU.",
      "What rating would this title need to stream in Japan?",
      "Which regions have the strictest advertising compliance rules?",
    ],
  },
  {
    id: "casting",
    icon: "\u{1F3AC}",
    name: "Casting Director",
    tagline: "Upload a script, get a data-backed shortlist.",
    backdrop: "/thumbnails/movie_1275779_dramatic_regrade.jpg",
    isCasting: true,
    story: {
      kicker: "THE CASTING DIRECTOR",
      title: "The Right Face\nFor The Role.",
      body: "A new script just landed. Somewhere in a catalog of real actors is the one who actually fits it — and the data to prove it.",
    },
    detail: {
      solves:
        "Turns a new script into a data-backed shortlist of actors, matched by real profile/review signal plus actual career-genre performance — not just casting-director intuition.",
      impact:
        "Gives production teams a quantified starting point for casting conversations, reducing reliance on guesswork or outdated familiarity with talent.",
    },
    questions: [
      "Looking for actors who can carry an emotional thriller.",
      "We need proven action-genre box office draw.",
      "Prefer Bollywood talent with strong drama credits.",
      "Who has the best track record in this genre on our own catalog?",
      "Suggest a lead who tests well with younger audiences.",
      "We want someone with award-caliber dramatic range.",
    ],
  },
];

export function getPersona(id) {
  return PERSONAS.find((p) => p.id === id) || null;
}
