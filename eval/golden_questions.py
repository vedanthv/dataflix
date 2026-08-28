"""
Golden eval dataset (Section 6 of PLAN.md). Originally scoped to Genie Space
A (engagement) + Genie Space B (licensing) at Tier 0; extended at Tier 1
(2026-08-23) with two 'content_signals' (Genie C, poster tagging) questions
now that it's wired into the Supervisor -- one full compound anchor-question
variant (engagement+licensing+content_signals) and one single-source
isolation question -- see PLAN.md's Tier 1 note. The Document Agent
('documents' tool) is live but still not covered by a dedicated golden
question -- a good next extension, not yet done.

Each record's `expectations` carries three custom keys beyond MLflow's
built-in ones (`expected_facts`, `guidelines`): `expected_tools_called` (for
the tool_fanout_correctness scorer) and `persona`/`notes` (informational,
read by the analysis step, ignored by built-in scorers).
"""

GOLDEN_QUESTIONS = [
    {
        "inputs": {
            "question": (
                "Spider-Man: Brand New Day is performing well in the US — is its "
                "license expiring soon, and does renewal make financial sense given "
                "its performance?"
            )
        },
        "expectations": {
            "expected_tools_called": ["engagement", "licensing"],
            "expected_facts": [
                "Spider-Man: Brand New Day has a strong completion rate around 78% in the US",
                "Its US license expires within 45 days, around October 5, 2026",
                "The estimated renewal cost is roughly $28,944",
                "Renewal looks favorable given the strong performance and modest cost",
            ],
            "persona": "strategy",
            "notes": "Hero title 1 (Hollywood) — anchor question, engagement+licensing compound",
        },
    },
    {
        "inputs": {
            "question": (
                "Dhurandhar is performing well in India — is its license expiring "
                "soon, and does renewal make financial sense given its performance?"
            )
        },
        "expectations": {
            "expected_tools_called": ["engagement", "licensing"],
            "expected_facts": [
                "Dhurandhar has a strong completion rate around 78% in India",
                "Its India license expires within 45 days, around October 3, 2026",
                "The estimated renewal cost is roughly $27,957",
                "Renewal looks favorable given the strong performance and modest cost",
            ],
            "persona": "strategy",
            "notes": "Hero title 2 (Bollywood) — anchor question, engagement+licensing compound",
        },
    },
    {
        "inputs": {
            "question": (
                "As a regional content lead for India, is Dhurandhar worth renewing "
                "in our India catalog?"
            )
        },
        "expectations": {
            "expected_tools_called": ["engagement", "licensing"],
            "expected_facts": [
                "Dhurandhar performs strongly in India",
                "Its India license renewal looks financially favorable",
            ],
            "persona": "regional",
            "notes": "Persona-framed variant of the Dhurandhar anchor question",
        },
    },
    {
        "inputs": {
            "question": (
                "From a financial standpoint, does renewing Spider-Man: Brand New "
                "Day's US license make sense given its viewership?"
            )
        },
        "expectations": {
            "expected_tools_called": ["engagement", "licensing"],
            "expected_facts": [
                "Spider-Man: Brand New Day has strong viewership/completion in the US",
                "The renewal cost is reasonable relative to that performance",
            ],
            "persona": "finance",
            "notes": "Persona-framed variant of the Spider-Man anchor question",
        },
    },
    {
        "inputs": {
            "question": (
                "Spider-Man: Brand New Day is performing well in the US — is its "
                "license expiring soon, does renewal make financial sense, and "
                "could its visual style be a factor in how it's landing there?"
            )
        },
        "expectations": {
            "expected_tools_called": ["engagement", "licensing", "content_signals"],
            "expected_facts": [
                "Spider-Man: Brand New Day has a strong completion rate around 78% in the US",
                "Its US license expires within 45 days, around October 5, 2026",
                "Renewal looks favorable given the strong performance and modest cost",
                "The poster has a warm dominant color tone and a dramatic emotional tone",
            ],
            "persona": "strategy",
            "notes": (
                "Full literal anchor question (Tier 1) — engagement + licensing + "
                "content_signals compound. Added 2026-08-23 once Genie C was wired "
                "into the Supervisor; this is Tier 1's own regression-gate question."
            ),
        },
    },
    {
        "inputs": {"question": "What is the dominant color tone and emotional tone of Dhurandhar's poster?"},
        "expectations": {
            "expected_tools_called": ["content_signals"],
            "expected_facts": [
                "Dhurandhar's poster has a dark dominant color tone",
                "Dhurandhar's poster has a tense emotional tone",
            ],
            "persona": "marketing",
            "notes": "Single-source content_signals question — isolates Genie C correctness",
        },
    },
    {
        "inputs": {"question": "Which genres have the highest average watch hours by region?"},
        "expectations": {
            "expected_tools_called": ["engagement"],
            "expected_facts": [],
            "persona": "strategy",
            "notes": "Single-source engagement question — isolates Genie A correctness",
        },
    },
    {
        "inputs": {"question": "Which titles star Tom Holland?"},
        "expectations": {
            "expected_tools_called": ["engagement"],
            "expected_facts": [
                "Tom Holland stars in Spider-Man: Brand New Day",
                "Tom Holland also appears in The Odyssey",
            ],
            "persona": "casting",
            "notes": "Single-source engagement/cast question — isolates Genie A correctness",
        },
    },
    {
        "inputs": {"question": "Which titles have licenses expiring in the next 30 days?"},
        "expectations": {
            "expected_tools_called": ["licensing"],
            "expected_facts": [],
            "persona": "strategy",
            "notes": "Single-source licensing question — isolates Genie B correctness",
        },
    },
    {
        "inputs": {
            "question": "What is the rights holder and renewal cost for Dhurandhar's license in India?"
        },
        "expectations": {
            "expected_tools_called": ["licensing"],
            "expected_facts": [
                "Dhurandhar's India renewal cost is roughly $27,957",
            ],
            "persona": "strategy",
            "notes": (
                "Single-source licensing question — isolates Genie B correctness; "
                "rights_holder is a fictional entity, don't check its exact name"
            ),
        },
    },
    {
        "inputs": {
            "question": "Chum is performing really well in Brazil — does it make sense to renew?"
        },
        "expectations": {
            "expected_tools_called": ["engagement", "licensing"],
            "guidelines": [
                "The response must explicitly name the tension between Chum's strong "
                "completion rate (~92%) in Brazil and its poor cost-efficiency: a "
                "high renewal cost (~$241,909) relative to a modest audience size, "
                "however the response chooses to express that (e.g. cost per "
                "watch-hour, or noting the audience is small/niche). It must not "
                "present a single clean 'renew' or 'drop' narrative without "
                "acknowledging this conflicting signal."
            ],
            "persona": "strategy",
            "notes": (
                "Adversarial/conflicting-signal case — real data, not hand-tuned: "
                "great quality signal (completion rate) vs. poor economics (cost per "
                "modest audience size). Tests the 'surface tension' instruction."
            ),
        },
    },
    {
        "inputs": {
            "question": (
                "Is 'The Quantum Detective Chronicles' performing well, and is its "
                "license expiring soon?"
            )
        },
        "expectations": {
            "expected_tools_called": ["engagement", "licensing"],
            "guidelines": [
                "The response must not fabricate performance or licensing data for "
                "this title. Since it doesn't exist in the catalog, the response "
                "should say so (or state no data was found) rather than inventing "
                "numbers."
            ],
            "persona": "strategy",
            "notes": "Nonexistent-title graceful-failure check — tests hallucination resistance",
        },
    },
]
