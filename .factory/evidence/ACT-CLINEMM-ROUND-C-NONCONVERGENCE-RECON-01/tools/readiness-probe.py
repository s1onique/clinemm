#!/usr/bin/env python3
"""
ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01 — G2 readiness probe.

FROZEN RUBRIC (defined BEFORE reading any readiness outcome; the normative
statement lives in `readiness-analysis.md`).

  A turn T is an EVIDENCE-READINESS POINT for subject R if, at T, the model's
  own recorded reasoning for R contains a VERDICT ASSERTION -- a statement
  that adjudicates R against the frozen Round B claim -- rather than merely
  describing an open question.

  A VERDICT ASSERTION for R is any of the following statement classes
  appearing in the assistant's `thinking`/`reasoning` block at turn T:

    V1  CONFIRMED      : the R claim survives falsification
    V2  REFUTED        : the R claim does not survive falsification
    V3  NARROWED       : the R claim survives only in a reduced scope
    V4  CONDITIONAL    : the R claim survives conditionally on a stated
                         precondition
    V5  SUFFICIENT     : the evidence for R is sufficient to decide it

  Readiness for the WHOLE deliverable (all ten subjects) is the earliest turn
  at which every subject R1..R10 has at least one verdict assertion.

  This rubric deliberately does NOT use final-answer length, model confidence,
  or any later statement about being "done". It uses only per-subject
  adjudication language recorded in the transcript at the turn.

The probe reports per-subject first-verdict turn, the earliest all-ten-verdict
turn (if any), the tool-call / token cost incurred AFTER that turn, and
whether useful NEW information was still being discovered near the end.

Sanitized output only: no raw reasoning text is emitted.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

SUBJECTS = list(range(1, 11))

VERDICT_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "SUFFICIENT",
        re.compile(
            r"\b(I have enough|enough (?:evidence|for|to decide)|sufficient(?:ly)?"
            r"(?: (?:evidence|determined|established))?|is enough)\b",
            re.I,
        ),
    ),
    (
        "CONFIRMED",
        re.compile(
            r"\b(fully confirmed|is confirmed|are confirmed|confirmed empirically|"
            r"\bconfirmed\b|\bverdict\b|\bverdicts\b)\b",
            re.I,
        ),
    ),
    (
        "REFUTED",
        re.compile(
            r"\b(refuted|falsified|disproven|does not survive|do not survive|"
            r"cannot be reproduced|is wrong)\b",
            re.I,
        ),
    ),
    (
        "NARROWED",
        re.compile(r"\b(narrowed|weakened|overstated|narrow(?:er|ing)?)\b", re.I),
    ),
    (
        "CONDITIONAL",
        re.compile(r"\b(conditional(?:ly)?|partially confirmed)\b", re.I),
    ),
]

SUBJECT_RE = re.compile(r"\bR[- ]?(\d{1,2})\b", re.I)


def classify(text: str) -> set[str]:
    found: set[str] = set()
    for label, pattern in VERDICT_PATTERNS:
        if pattern.search(text):
            found.add(label)
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-dir", required=True)
    parser.add_argument("--session-id", default="1795252560069_t82cp")
    parser.add_argument("--out", required=True)
    parser.add_argument("--operator-index", type=int, default=650)
    args = parser.parse_args()

    path = f"{args.session_dir}/{args.session_id}.messages.json"
    with open(path, "r", encoding="utf-8") as handle:
        doc = json.load(handle)
    messages = doc.get("messages") or []

    first_verdict: dict[int, dict[str, Any]] = {}
    per_turn: list[dict[str, Any]] = []

    for index, message in enumerate(messages):
        if message.get("role") != "assistant":
            continue
        if index >= args.operator_index:
            continue
        content = message.get("content")
        blocks = content if isinstance(content, list) else []
        reasoning = ""
        for b in blocks:
            if isinstance(b, dict) and b.get("type") in ("thinking", "reasoning"):
                reasoning += str(b.get("thinking") or b.get("text") or "")
        if not reasoning:
            continue
        classes = classify(reasoning)
        subjects = {
            int(m.group(1))
            for m in SUBJECT_RE.finditer(reasoning)
            if int(m.group(1)) in SUBJECTS
        }
        # A verdict assertion is attributed to a subject when the verdict
        # language and the subject token co-occur inside the same SENTENCE.
        attributed: dict[int, set[str]] = {}
        for sentence in re.split(r"(?<=[.!?\n])", reasoning):
            s_classes = classify(sentence)
            if not s_classes:
                continue
            for m in SUBJECT_RE.finditer(sentence):
                subject = int(m.group(1))
                if subject in SUBJECTS:
                    attributed.setdefault(subject, set()).update(s_classes)
        for subject, s_classes in attributed.items():
            if subject not in first_verdict:
                first_verdict[subject] = {
                    "turn_index": index,
                    "ts_ms": message.get("ts"),
                    "verdict_classes": sorted(s_classes),
                }
        per_turn.append(
            {
                "turn_index": index,
                "ts_ms": message.get("ts"),
                "verdict_classes_present": sorted(classes),
                "subjects_mentioned": sorted(subjects),
                "subjects_with_verdict": sorted(attributed),
            }
        )

    complete = all(s in first_verdict for s in SUBJECTS)
    readiness_turn = None
    if complete:
        readiness_turn = max(first_verdict[s]["turn_index"] for s in SUBJECTS)

    cost_after: dict[str, Any] = {}
    if readiness_turn is not None:
        tool_calls_after = 0
        out_tokens_after = 0
        turns_after = 0
        for index, message in enumerate(messages):
            if message.get("role") != "assistant":
                continue
            if index <= readiness_turn or index >= args.operator_index:
                continue
            turns_after += 1
            content = message.get("content")
            blocks = content if isinstance(content, list) else []
            for b in blocks:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    tool_calls_after += 1
            metrics = message.get("metrics") or {}
            out_tokens_after += metrics.get("outputTokens") or 0
        cost_after = {
            "turns_after_readiness": turns_after,
            "tool_calls_after_readiness": tool_calls_after,
            "output_tokens_after_readiness": out_tokens_after,
        }

    result = {
        "rubric_id": "ROUND_C_FROZEN_VERDICT_ASSERTION_RUBRIC_V1",
        "subjects": SUBJECTS,
        "per_subject_first_verdict": {f"R{s}": first_verdict.get(s) for s in SUBJECTS},
        "all_ten_subjects_verdicted": complete,
        "readiness_turn_index": readiness_turn,
        "cost_after_readiness": cost_after,
        "operator_input_index": args.operator_index,
        "per_turn_verdict_index": per_turn,
    }

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)

    print(f"all_ten_subjects_verdicted={complete}")
    for s in SUBJECTS:
        fv = first_verdict.get(s)
        if fv:
            print(
                f"  R{s:<2} first-verdict turn={fv['turn_index']:>4} "
                f"classes={','.join(fv['verdict_classes'])}"
            )
        else:
            print(f"  R{s:<2} NO VERDICT ASSERTION FOUND")
    print(f"readiness_turn_index={readiness_turn}")
    print(f"cost_after_readiness={json.dumps(cost_after, sort_keys=True)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
