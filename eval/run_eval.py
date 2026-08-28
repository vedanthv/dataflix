"""
Tier 0 eval run — Section 6 of PLAN.md, scoped to Genie A (engagement) +
Genie B (licensing) via the Supervisor (Document Agent / C/E/F/G aren't
built yet). Logs to the `dataflix_eval` MLflow experiment on Databricks.

Usage:
  .venv/bin/python eval/run_eval.py
"""

import configparser
import json
import sys
from pathlib import Path

import mlflow
import requests
from mlflow.genai.scorers import Correctness, ExpectationsGuidelines, Safety

sys.path.insert(0, str(Path(__file__).resolve().parent))
from golden_questions import GOLDEN_QUESTIONS
from scorers import tool_fanout_correctness

PROFILE = "DEFAULT"
ENDPOINT_NAME = "mas-de7a56a6-endpoint"
EXPERIMENT_PATH = "/Users/vedanthbaliga21@gmail.com/dataflix_eval"


def _load_profile():
    cfg = configparser.ConfigParser()
    cfg.read(str(Path.home() / ".databrickscfg"))
    section = cfg[PROFILE]
    return section["host"], section["token"]


HOST, TOKEN = _load_profile()

mlflow.set_tracking_uri("databricks")
mlflow.set_experiment(EXPERIMENT_PATH)


def predict_fn(question: str) -> dict:
    resp = requests.post(
        f"{HOST}/serving-endpoints/{ENDPOINT_NAME}/invocations",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        json={"input": [{"role": "user", "content": question}]},
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()

    tool_calls = [
        item["name"] for item in data.get("output", []) if item.get("type") == "function_call"
    ]

    texts = []
    for item in data.get("output", []):
        if item.get("type") != "message" or item.get("role") != "assistant":
            continue
        for c in item.get("content", []):
            if c.get("type") == "output_text":
                texts.append(c["text"])
    final_candidates = [t for t in texts if not t.strip().startswith("<name>")]
    answer = final_candidates[-1] if final_candidates else (texts[-1] if texts else "")

    return {"response": answer, "tool_calls": tool_calls}


def main():
    print(f"Running {len(GOLDEN_QUESTIONS)} golden questions against {ENDPOINT_NAME}...")
    results = mlflow.genai.evaluate(
        data=GOLDEN_QUESTIONS,
        predict_fn=predict_fn,
        scorers=[
            Correctness(),
            Safety(),
            ExpectationsGuidelines(),
            tool_fanout_correctness,
        ],
    )
    print(f"\nRun ID: {results.run_id}")
    print(f"Metrics:\n{json.dumps(results.metrics, indent=2, default=str)}")


if __name__ == "__main__":
    main()
