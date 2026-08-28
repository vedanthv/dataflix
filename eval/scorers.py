"""
Custom @scorer for Section 6's tool-fanout check. Operationalizes the
Supervisor's "single-source vs. compound fan-out" routing instructions
(PLAN.md Section 5) as a measured property instead of an unverified prompt
hope.

Reads tool calls directly off the predict_fn's `outputs["tool_calls"]`
(populated from the Responses-API `function_call` items in the raw endpoint
response) rather than parsing an MLflow trace's spans -- Agent Bricks'
auto-trace propagation into the local eval run's trace is unverified on
Free Edition (PLAN.md Section 5 flagged this), while the response payload
itself reliably carries the tool-call sequence (confirmed empirically),
so this is the more robust source for this specific check.
"""

from mlflow.entities import Feedback
from mlflow.genai.scorers import scorer


@scorer
def tool_fanout_correctness(outputs: dict, expectations: dict) -> Feedback:
    expected = set(expectations.get("expected_tools_called", []))
    actual = set(outputs.get("tool_calls", []))

    if not expected:
        return Feedback(value="yes", rationale="No expected tools specified for this question.")

    if actual == expected:
        return Feedback(
            value="yes", rationale=f"Called exactly the expected tools: {sorted(actual)}"
        )

    missing = expected - actual
    extra = actual - expected
    parts = []
    if missing:
        parts.append(f"missing {sorted(missing)}")
    if extra:
        parts.append(f"unexpected {sorted(extra)}")
    return Feedback(
        value="no",
        rationale=f"Tool call mismatch: {', '.join(parts)}. Called: {sorted(actual)}",
    )
