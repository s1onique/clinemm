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
    # CORRECTION01 F3: the FULL assertion history per subject, so that
    # stability (was the first assertion later refined?) can be assessed.
    subject_assertions: dict[int, list[tuple[int, tuple[str, ...]]]] = {}

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
            subject_assertions.setdefault(subject, []).append(
                (index, tuple(sorted(s_classes)))
            )
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

    # CORRECTION01 F3: verdict STABILITY. A subject whose verdict class set
    # changed after its first assertion was REFINEd: its first assertion was
    # not final, so the first-assertion turn is not a defensible synthesis
    # point for that subject.
    verdict_stability: dict[str, Any] = {}
    refined_subjects: set[int] = set()
    stable_coverage_turns: list[int] = []
    for s in SUBJECTS:
        assertions = subject_assertions.get(s, [])
        if not assertions:
            verdict_stability[f"R{s}"] = {"status": "NO_ASSERTION"}
            continue
        first_classes = set(assertions[0][1])
        later = [a for a in assertions[1:] if set(a[1]) != first_classes]
        if later:
            refined_subjects.add(s)
            verdict_stability[f"R{s}"] = {
                "status": "REFINED",
                "first_assertion_turn": assertions[0][0],
                "first_classes": sorted(first_classes),
                "later_assertion_turns": [a[0] for a in assertions[1:]],
                "refined_at_turns": [a[0] for a in later],
                "all_classes": sorted({c for _, cs in assertions for c in cs}),
            }
        else:
            verdict_stability[f"R{s}"] = {
                "status": "STABLE",
                "first_assertion_turn": assertions[0][0],
                "first_classes": sorted(first_classes),
                "later_assertion_turns": [a[0] for a in assertions[1:]],
                "all_classes": sorted({c for _, cs in assertions for c in cs}),
            }
            stable_coverage_turns.append(assertions[0][0])

    # CORRECTION02 P1: this metric measured FIRST-ASSERTION stability only.
    # It did NOT establish that no LATER turn had stable verdict coverage --
    # a subject whose first assertion was later refined may still have had a
    # stable verdict from some later point onward. The metric is therefore
    # renamed to describe exactly what it measures, and the unsupported
    # "no later stable turn exists" conclusion is removed.
    #
    # What it DOES establish: the set of subjects whose FIRST assertion was
    # never subsequently revised. `all_first_assertions_stable` is True only
    # when every subject's first assertion was final.
    all_first_assertions_stable = len(stable_coverage_turns) == len(SUBJECTS)
    first_assertion_stable_turn = (
        max(stable_coverage_turns) if all_first_assertions_stable else None
    )
    # A genuinely different question, which IS answerable from the trace:
    # the earliest turn after which NO subject produced a NEW verdict
    # assertion (i.e. the verdict set stopped changing).
    last_verdict_change_turn = None
    for subject in SUBJECTS:
        assertions = subject_assertions.get(subject, [])
        if assertions:
            last_verdict_change_turn = max(
                last_verdict_change_turn or 0,
                max(index for index, _ in assertions),
            )

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
        # CORRECTION01 F3: the rubric measures the model's OWN recorded
        # adjudication language. It therefore establishes FIRST RECORDED
        # VERDICT COVERAGE, NOT independent factual sufficiency.
        # `readiness_semantics` states exactly what the number means.
        "readiness_semantics": {
            "measures": "first recorded verdict-assertion coverage over R1..R10",
            "does_not_measure": "independent factual sufficiency of the evidence",
            "independent_readiness": "UNPROVEN",
            "refinement_correction": (
                "A subject whose verdict was later REFINEd means its first "
                "assertion was not final; the first-assertion turn therefore "
                "cannot be treated as a defensible synthesis point for that "
                "subject."
            ),
        },
        # CORRECTION01 F3: per-subject verdict stability.
        "verdict_stability": verdict_stability,
        "subjects_refined_after_first_assertion": sorted(refined_subjects),
        "first_assertion_stability": {
            "measures": (
                "whether each subject's FIRST verdict assertion was ever "
                "subsequently revised. It does NOT establish that no later "
                "turn had stable verdict coverage."
            ),
            "all_first_assertions_stable": all_first_assertions_stable,
            "turn_all_first_assertions_stable": first_assertion_stable_turn,
            "note": (
                "A null value means at least one first assertion was later "
                "revised; it does NOT mean no later stable turn exists."
            ),
        },
        "last_verdict_change_turn": last_verdict_change_turn,
    }

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)

    print(f"all_ten_subjects_verdicted={complete}")
    for s in SUBJECTS:
        fv = first_verdict.get(s)
        if fv:
            stab = verdict_stability[f"R{s}"]
            print(
                f"  R{s:<2} first-verdict turn={fv['turn_index']:>4} "
                f"classes={','.join(fv['verdict_classes']):<38} "
                f"stability={stab['status']}"
            )
        else:
            print(f"  R{s:<2} NO VERDICT ASSERTION FOUND")
    print(f"readiness_turn_index={readiness_turn}")
    print(f"cost_after_readiness={json.dumps(cost_after, sort_keys=True)}")
    # CORRECTION01 F3: the corrected, bounded readiness statements.
    print(
        "readiness_semantics: first_recorded_verdict_coverage="
        f"{readiness_turn}; independent_factual_sufficiency=UNPROVEN"
    )
    print(
        "subjects_refined_after_first_assertion="
        f"{sorted(refined_subjects)} ({len(refined_subjects)}/{len(SUBJECTS)})"
    )
    print(
        "all_first_assertions_stable="
        f"{all_first_assertions_stable} "
        f"(turn_all_first_assertions_stable={first_assertion_stable_turn})"
    )
    print(
        "last_verdict_change_turn="
        f"{last_verdict_change_turn} "
        "(the last turn at which any subject produced a verdict assertion)"
    )
    print(
        "NOTE: a null first-assertion-stability turn does NOT establish that "
        "no later stable turn exists."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
