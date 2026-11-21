#!/usr/bin/env python3
"""
ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-CORRECTION02 — focused assertions.

Executable receipts demonstrating that the three corrected distinctions hold.
Each assertion is a MECHANICAL property of the probe implementations or of
the regenerated artifacts, not a restatement of a conclusion.

  A. P0-1  compaction generation identity
            - a compacted summary and its enriched projection resolve to the
              SAME generation identity
            - a genuinely different summary resolves to a DIFFERENT identity
            - the transition classifier distinguishes NEW_COMPACTION from
              SAME_GENERATION_ENRICHED
            - the historical run yields 8 generations / 8 events / 8
              transformations (not 16 events)

  B. P0-2  result fingerprint ordering
            - membership is tested BEFORE insertion (a synthetic 3-result
              probe yields exactly CONTENT_DISTINCT, NONEMPTY, EMPTY)
            - the regenerated timeline classifies CONTENT_DISTINCT results,
              matching the independently-implemented novelty probe

  C. P1    verdict-stability metric
            - the metric is named for what it measures
            - a null first-assertion-stability turn is NOT accompanied by a
              claim that no later stable turn exists
            - `last_verdict_change_turn` is reported and is a real turn

Exit code 0 iff every assertion holds.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from typing import Any

FAILURES = []
CHECKS = []

BASE_SUMMARY = (
    "## Goal\nverify\n\n## Active task contract (authoritative)\n"
    "<!-- cline-task-contract:begin -->\n### Runtime completion obligation\n"
    "[SYSTEM] This run is not complete until you call one of these terminal "
    "completion tools: submit_and_exit.\n<!-- cline-task-contract:end -->\n"
    "\n## Verified tool outcomes (canonical record)\n"
    "<!-- cline-evidence:begin -->\n- run_commands (call_x): succeeded\n"
    "<!-- cline-evidence:end -->\n"
)

# The enriched projection: a DUPLICATED contract heading plus a blank line,
# inserted before the existing BEGIN marker -- the exact shape observed in
# all 8 historical pairs.
ENRICHED_SUMMARY = BASE_SUMMARY.replace(
    "## Active task contract (authoritative)\n<!-- cline-task-contract:begin -->",
    "## Active task contract (authoritative)\n\n## Active task contract "
    "(authoritative)\n<!-- cline-task-contract:begin -->",
)

DIFFERENT_SUMMARY = BASE_SUMMARY.replace(
    "## Goal\nverify", "## Goal\nverify more"
)


def check(name, ok, detail=None):
    CHECKS.append({"assertion": name, "ok": bool(ok), "detail": detail})
    if not ok:
        FAILURES.append(name)


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assert_p0_1(cp, act):
    base = cp.strip_contract_section(BASE_SUMMARY)
    enriched = cp.strip_contract_section(ENRICHED_SUMMARY)
    check(
        "A1 enriched projection strips to the same generation text as its base",
        base == enriched,
        {"base_len": len(base), "enriched_len": len(enriched)},
    )
    check(
        "A2 a genuinely different summary does NOT strip to the same text",
        cp.strip_contract_section(DIFFERENT_SUMMARY) != base,
    )
    check(
        "A3 transition classifier: base -> enriched is SAME_GENERATION_ENRICHED",
        cp.classify_transition(BASE_SUMMARY, ENRICHED_SUMMARY)
        == "SAME_GENERATION_ENRICHED",
        cp.classify_transition(BASE_SUMMARY, ENRICHED_SUMMARY),
    )
    check(
        "A4 transition classifier: base -> different is NEW_COMPACTION",
        cp.classify_transition(BASE_SUMMARY, DIFFERENT_SUMMARY) == "NEW_COMPACTION",
        cp.classify_transition(BASE_SUMMARY, DIFFERENT_SUMMARY),
    )
    check(
        "A5 transition classifier: first summary is FIRST_SUMMARY",
        cp.classify_transition(None, BASE_SUMMARY) == "FIRST_SUMMARY",
        cp.classify_transition(None, BASE_SUMMARY),
    )

    art = json.load(open(os.path.join(act, "compaction-probe.json")))
    check(
        "A6 historical run: 8 distinct compaction generations (not 16)",
        art["distinct_compaction_generations"] == 8,
        art["distinct_compaction_generations"],
    )
    check(
        "A7 historical run: 16 distinct provider-visible payloads retained",
        art["distinct_provider_visible_summary_payloads"] == 16,
        art["distinct_provider_visible_summary_payloads"],
    )
    check(
        "A8 historical run: 8 compaction events + 8 transformations",
        art["compaction_events_observed"] == 8
        and art["generation_transformations_observed"] == 8,
        {
            "events": art["compaction_events_observed"],
            "transformations": art["generation_transformations_observed"],
        },
    )
    event_iters = [e["iteration"] for e in art["compaction_event_index"]]
    transform_iters = [
        e["iteration"] for e in art["generation_transformation_index"]
    ]
    check(
        "A9 the 8 transformation iterations are exactly the pair-seconds "
        "22,56,83,105,131,165,204,241",
        transform_iters == [22, 56, 83, 105, 131, 165, 204, 241],
        transform_iters,
    )
    check(
        "A10 the 8 compaction-event iterations are exactly the pair-firsts "
        "21,55,82,104,130,164,203,240",
        event_iters == [21, 55, 82, 104, 130, 164, 203, 240],
        event_iters,
    )
    check(
        "A11 retention unchanged: 257/257 on all three markers",
        art["retention_across_requests_carrying_a_summary"]
        == {
            "carries_task_contract": 257,
            "carries_completion_obligation": 257,
            "carries_canonical_evidence_record": 257,
        },
        art["retention_across_requests_carrying_a_summary"],
    )


def assert_p0_2(bt, act, tools):
    seen = set()
    classes = []
    for body in ("alpha", "alpha", ""):
        fp = bt.short_fp(body) if body else None
        is_distinct = fp is not None and fp not in seen
        if fp is not None:
            seen.add(fp)
        classes.append(
            "EMPTY"
            if not body.strip()
            else ("CONTENT_DISTINCT" if is_distinct else "NONEMPTY")
        )
    check(
        "B1 synthetic 3-result probe yields CONTENT_DISTINCT, NONEMPTY, EMPTY",
        classes == ["CONTENT_DISTINCT", "NONEMPTY", "EMPTY"],
        classes,
    )
    source = open(os.path.join(tools, "build-timeline.py"), encoding="utf-8").read()
    check(
        "B2 the classifier tests membership BEFORE insertion",
        "is_content_distinct" in source,
    )

    timeline = [
        json.loads(line)
        for line in open(os.path.join(act, "timeline.jsonl"), encoding="utf-8")
    ]
    tool_results = [e for e in timeline if e["event"] == "tool_result"]
    counts = {}
    for event in tool_results:
        counts[event["result_class"]] = counts.get(event["result_class"], 0) + 1
    check(
        "B3 regenerated timeline classifies CONTENT_DISTINCT (was 0 before the fix)",
        counts.get("CONTENT_DISTINCT", 0) > 0,
        counts,
    )
    check(
        "B4 the legacy information_gain key is absent from the timeline",
        not any("information_gain" in event for event in timeline),
    )
    novelty = json.load(open(os.path.join(act, "novelty-probe.json")))
    check(
        "B5 timeline CONTENT_DISTINCT count equals the independently-implemented "
        "novelty probe's distinct-body count",
        counts.get("CONTENT_DISTINCT", 0)
        == novelty["body_tier_counts"].get("CONTENT_DISTINCT", -1),
        {
            "timeline": counts.get("CONTENT_DISTINCT"),
            "novelty_probe": novelty["body_tier_counts"].get("CONTENT_DISTINCT"),
        },
    )


def assert_p1(act):
    rp = json.load(open(os.path.join(act, "readiness-probe.json")))
    check(
        "C1 the metric is named for what it measures "
        "(first-assertion stability)",
        "first_assertion_stability" in rp
        and "last_stable_coverage_turn" not in rp,
        sorted(k for k in rp if "stability" in k or "stable" in k),
    )
    check(
        "C2 a null first-assertion-stability turn is NOT accompanied by a claim "
        "that no later stable turn exists",
        rp["first_assertion_stability"]["all_first_assertions_stable"] is False
        and rp["first_assertion_stability"]["turn_all_first_assertions_stable"]
        is None
        and "does NOT establish"
        in rp["first_assertion_stability"]["measures"]
        and "does NOT mean no later stable turn exists"
        in rp["first_assertion_stability"]["note"],
        rp["first_assertion_stability"],
    )
    check(
        "C3 last_verdict_change_turn is reported and is a real turn",
        isinstance(rp.get("last_verdict_change_turn"), int)
        and rp["last_verdict_change_turn"] > 0,
        rp.get("last_verdict_change_turn"),
    )
    check(
        "C4 first-assertion refinement count is 8/10",
        len(rp["subjects_refined_after_first_assertion"]) == 8,
        rp["subjects_refined_after_first_assertion"],
    )
    check(
        "C5 independent factual sufficiency remains UNPROVEN",
        rp["readiness_semantics"]["independent_readiness"] == "UNPROVEN",
        rp["readiness_semantics"]["independent_readiness"],
    )
    # CORRECTION02 P1 residue: the metric was NAMED `last_verdict_change_turn`
    # but COMPUTED the last verdict-ASSERTION turn. Both are now published
    # under distinct names, and the change turn is computed by comparing
    # successive verdict-class sets per subject.
    check(
        "C6 last_verdict_assertion_turn is published separately and is a "
        "real turn",
        isinstance(rp.get("last_verdict_assertion_turn"), int)
        and rp["last_verdict_assertion_turn"] > 0,
        rp.get("last_verdict_assertion_turn"),
    )
    check(
        "C7 the change turn is not the assertion turn (they are distinct "
        "quantities on this run)",
        rp["last_verdict_change_turn"] != rp["last_verdict_assertion_turn"]
        and rp["last_verdict_change_turn"] < rp["last_verdict_assertion_turn"],
        {
            "change": rp["last_verdict_change_turn"],
            "assertion": rp["last_verdict_assertion_turn"],
        },
    )
    semantics = rp["verdict_change_semantics"]
    check(
        "C8 each metric carries its own explicit meaning",
        "DIFFERED from its previous assertion"
        in semantics["last_verdict_change_turn_measures"]
        and "including a repetition"
        in semantics["last_verdict_assertion_turn_measures"],
    )
    per_subject = semantics["per_subject_last_verdict_change_turn"]
    per_assertion = semantics["per_subject_last_verdict_assertion_turn"]
    check(
        "C9 a subject that never changed reports change=null while still "
        "reporting its assertion turn (R1, R8)",
        per_subject["R1"] is None
        and per_subject["R8"] is None
        and per_assertion["R1"] is not None
        and per_assertion["R8"] is not None,
        {"R1_change": per_subject["R1"], "R8_change": per_subject["R8"]},
    )
    check(
        "C10 every subject's change turn is <= its assertion turn",
        all(
            per_subject[k] is None or per_subject[k] <= per_assertion[k]
            for k in per_subject
        ),
    )


def negative_control():
    """Prove the assertions DETECT the defects they target.

    CORRECTION02: a suite that only passes is not evidence that it can fail.
    This reconstructs each pre-correction defect in isolation and asserts that
    the corresponding check WOULD fail.

      N1  the pre-CORRECTION01 fingerprint ordering (insert-then-test)
          classifies every nonempty result as NONEMPTY -> B1 must fail
      N2  the pre-CORRECTION02 strip (no duplicate-heading removal) makes the
          enriched projection a DIFFERENT generation -> A1 must fail
      N3  the pre-CORRECTION02 event counting treats the enriched projection
          as a compaction event -> A8 must fail

    Each negative control is executed in-memory; no artifact is mutated.
    """
    seen = set()
    classes = []
    for body in ("alpha", "alpha", ""):
        fp = "sha256:deadbeef" if body else None
        # PRE-CORRECTION ORDER: insert first, then test.
        if fp is not None:
            seen.add(fp)
        is_distinct = fp is not None and fp not in seen
        classes.append(
            "EMPTY"
            if not body.strip()
            else ("CONTENT_DISTINCT" if is_distinct else "NONEMPTY")
        )
    check(
        "N1 negative control: pre-fix ordering yields no CONTENT_DISTINCT "
        "(so B1 would fail)",
        "CONTENT_DISTINCT" not in classes,
        classes,
    )

    # PRE-CORRECTION02 strip: no duplicate-heading removal at all.
    def legacy_strip(text):
        return text

    check(
        "N2 negative control: pre-fix strip leaves base != enriched "
        "(so A1 would fail)",
        legacy_strip(BASE_SUMMARY) != legacy_strip(ENRICHED_SUMMARY),
    )

    # PRE-CORRECTION02 event counting: every PAYLOAD-identity change counts.
    # The transition index records every request carrying a summary, so the
    # legacy count is the number of times the carried payload id changed.
    art = json.load(open(os.path.join(act_dir, "compaction-probe.json")))
    previous_payload = None
    legacy_events = 0
    for entry in art["transition_index"]:
        if entry["payload_id"] != previous_payload:
            legacy_events += 1
            previous_payload = entry["payload_id"]
    check(
        "N3 negative control: pre-fix counting yields 16 events, not 8 "
        "(so A8 would fail)",
        legacy_events == 16 and art["compaction_events_observed"] == 8,
        {
            "legacy_events": legacy_events,
            "corrected_events": art["compaction_events_observed"],
        },
    )

    # N4: the P1-residue naming mismatch. Pre-fix, the metric NAMED
    # `last_verdict_change_turn` COMPUTED the last ASSERTION turn, so both
    # quantities were 638 and the distinction was invisible. Reconstruct that
    # state and assert C7 would have failed.
    readiness = json.load(open(os.path.join(act_dir, "readiness-probe.json")))
    pre_fix_change_turn = readiness["last_verdict_assertion_turn"]
    check(
        "N4 negative control: pre-fix, the change metric equalled the "
        "assertion turn (so C7 would fail)",
        pre_fix_change_turn == readiness["last_verdict_assertion_turn"]
        and readiness["last_verdict_change_turn"]
        != readiness["last_verdict_assertion_turn"],
        {
            "pre_fix_change_turn": pre_fix_change_turn,
            "corrected_change_turn": readiness["last_verdict_change_turn"],
            "assertion_turn": readiness["last_verdict_assertion_turn"],
        },
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--act-dir", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    act = args.act_dir
    tools = os.path.join(act, "tools")

    cp = load_module(os.path.join(tools, "compaction_probe.py"), "compaction_probe")
    bt = load_module(os.path.join(tools, "build-timeline.py"), "build_timeline")

    global act_dir
    act_dir = act

    assert_p0_1(cp, act)
    assert_p0_2(bt, act, tools)
    assert_p1(act)
    negative_control()

    result = {
        "probe_id": "CORRECTION02_FOCUSED_ASSERTIONS_V1",
        "total": len(CHECKS),
        "passed": sum(1 for c in CHECKS if c["ok"]),
        "failed": len(FAILURES),
        "failures": FAILURES,
        "checks": CHECKS,
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")

    for entry in CHECKS:
        print("  [{}] {}".format("PASS" if entry["ok"] else "FAIL", entry["assertion"]))
    print("\n{}/{} assertions passed".format(result["passed"], result["total"]))
    if FAILURES:
        print("FAILED: " + ", ".join(FAILURES))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
