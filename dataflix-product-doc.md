# Dataflix
### A Multi-Agent Genie System for Streaming Content Strategy
*Every content decision, one query away.*

---

## Business Outcome

Streaming platforms lose time and money because content decisions require manually cross-referencing data that lives in disconnected systems. Dataflix's outcome for the business:

- **Faster renew/drop decisions** — a question that today takes pulling two dashboards and asking legal to check a contract gets answered in seconds, so decisions get made while they're still actionable instead of late or not at all.
- **Reduced compliance/legal risk** — ratings, regional compliance, and contract terms are checked automatically as part of every relevant answer, not skipped because reading a 40-page PDF is too slow.
- **One source of truth across roles** — Content Strategy, Compliance, Regional, Marketing, and Finance all query the same underlying data through the same interface, instead of five teams maintaining five different partial pictures.
- **Auditable, not a black box** — every answer traces back to the specific data/document sources that produced it, so a renewal or compliance call can be defended, not just asserted.

---

## Problem

Streaming platforms make content decisions — what to renew, what to promote, where to release, what's underperforming and why — using data that lives in three completely disconnected places:

- **Engagement data** (viewership, completion rates, retention) sits in analytics systems.
- **Licensing and rights data** (expiry dates, exclusivity terms, renewal costs) sits in separate ops systems.
- **The actual rules governing what you're allowed to do** — content ratings, regional compliance, contract clauses — sit buried in unstructured PDFs nobody wants to read.

Today, answering one real business question — *"should we renew this title, and are we even allowed to expand it to this region?"* — means pulling data from two dashboards and asking someone in legal to check a contract. That's slow, and it means good decisions get made late or not at all.

**Dataflix** is a single conversational interface where a content strategist asks one plain-language question and gets a synthesized answer that reasons across all three sources — automatically, in seconds.

---

## Personas & User Stories

The same underlying data serves several distinct roles inside a streaming company — each asks different questions, but all of them currently suffer the same problem: the answer they need is scattered across systems and PDFs nobody has time to cross-reference.

**Content Strategy / Acquisitions Analyst** — decides what to renew, drop, or expand. Needs engagement + licensing + compliance together to make a renewal call.
*Representative question:* "Should we renew Title X given its performance and renewal cost?"

**Compliance / Content Ops Reviewer** — checks whether a proposed action is actually allowed. Needs ratings and contract language fast, without reading a 40-page PDF.
*Representative question:* "Does this title's rating allow unedited release in this territory?"

**Regional / Market Lead** — owns a specific country or region's catalog performance and localization decisions. Needs engagement data filtered by region, cross-checked against what's licensed and compliant *there specifically*.
*Representative question:* "What's underperforming in my region, and is it a content issue or a licensing/compliance restriction I can actually fix?"

**Marketing / Promotions Lead** — decides what to push in a campaign and where. Needs to know a title is legally clear to promote (talent/contract restrictions) and which visual/content style tends to perform, not just raw viewership.
*Representative question:* "Which upcoming titles are safe to promote in this region, and what visual style has historically driven the best click-through here?"

**Finance / Content Investment Lead** — evaluates renewal spend and ROI across the catalog. Needs licensing cost data paired with performance to justify or challenge a budget line.
*Representative question:* "What's our total renewal cost exposure this quarter, and which of those renewals are actually justified by performance?"

**Casting Director** — decides who to cast in a new production, before it's made. Needs a data-driven read on which actors have historically performed well in a given genre, not just a gut call.
*Representative question:* "I've uploaded the script for our next project — based on its genre and tone, which actors have the strongest track record in similar titles?"

The first five personas are really asking a variant of the same underlying question — "what's happening, what am I allowed to do, and is it worth doing" — just filtered through a different lens. Casting Director is deliberately different: it's a pre-production decision, not a catalog-management one, and it proves the same underlying data (real cast/title data, paired with performance) supports a genuinely different job, not just a rephrased version of the other five.

---

## Core Product Features

**The conversational core.** There is no separate BI dashboard to click through — every insight, chart, and recommendation the user sees is generated in direct response to a natural-language question. If the conversational layer were removed, there is no product left, just disconnected data tables and a folder of PDFs.

**The anchor experience** — the single question that proves the product works, and that every persona's question is a variant of:

> *"Title X is performing well in [region] — is its license expiring soon, does renewal make financial sense given its performance, does its rating allow wider regional release, and could its visual style or pacing be a factor in how it's landing there?"*

This forces engagement, licensing, compliance, and content-signal data to combine into one synthesized, source-traced answer — not just retrieval, genuine cross-domain reasoning.

**Feature set beyond core Q&A:**

- **Sources Used panel** — every answer shows which data source(s) contributed, making the answer auditable rather than a black box.
- **Casting Recommendation** — a casting director uploads a script; its genre and tone are extracted automatically, then actors are ranked by how well their past titles performed in that same genre/region — turning "who should we cast" from a gut call into a data-backed shortlist. (Uses synthetic performance data, same caveat as the rest of the catalog — see the plan's risk notes.)

**Cut from scope** (product decision, 2026-08-23) — kept here so a future re-read doesn't resurrect them:
- ~~Proactive Risk Digest~~ and ~~Renewal ROI Calculator~~ — both converged on the same "should we renew this title" question the chat's anchor-question synthesis already answers qualitatively; having three surfaces compute that independently risked showing conflicting verdicts for the same title. The chat answer is now the single source of truth for renewal guidance.
- ~~Persona Switcher~~ — added no new capability (it only reframed the same Tier 0/1 Q&A per role); cut to keep scope tight rather than build a UI layer with no underlying new function.
