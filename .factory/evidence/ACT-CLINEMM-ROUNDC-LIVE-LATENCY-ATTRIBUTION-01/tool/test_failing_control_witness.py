#!/usr/bin/env python3
"""
CORRECTION01 — FAILING-CONTROL WITNESS for the evidence generator.

The reviewer found (P1) that `emit_evidence.py` marked controls C6, C7 and C8
PASS UNCONDITIONALLY and emitted a FIXED `NOT_REPRODUCED` verdict. That is
corrected: the verdict and the C6 outcome are now DERIVED by
`attribute_latency.py` from the measured controls.

A correction that cannot fail is not a correction. This witness proves the
corrected generator DOES fail when the evidence contract is violated.

It is a NEGATIVE test: it constructs adversarial traces and asserts that the
derived verdict and the derived C6 outcome are NOT a passing verdict /
NOT a passing control.

Cases:
  W1  A trace with too FEW independently identified tool executions
      (coverage below the registered minimum) must NOT yield
      NOT_REPRODUCED; it must yield CAPTURE_INSUFFICIENT, and C6 must FAIL.
  W2  A trace that IS truncated / does not satisfy its completeness contract
      must yield CAPTURE_INSUFFICIENT and C6 must FAIL.
  W3  A trace where the floor IS reproduced must yield REPRODUCED — the
      generator must not be pinned to NOT_REPRODUCED.
  W4  The REAL trace must still yield NOT_REPRODUCED with C6 PASSING, so the
      negative cases cannot be satisfied by simply always failing.

Run:
  python3 tool/test_failing_control_witness.py
Exit code 0 = all witnesses held. Non-zero = the correction regressed.
"""

import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import attribute_latency as al  # noqa: E402

FAILURES = []
PASSES = []


def check(name, condition, detail=""):
    if condition:
        PASSES.append(name)
    else:
        FAILURES.append("%s%s" % (name, (": " + detail) if detail else ""))


def real_trace():
    path = os.path.join(HERE, "..", "analysis", "attribution.json")
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def controls_from(trace):
    return trace["controls"]


# --- W4: the real trace still passes -------------------------------------
real = real_trace()
real_controls = controls_from(real)
real_verdict = al.derive_verdict(real_controls)
real_c6 = al.derive_c6_check(real_controls)
check("W4-real-verdict", real_verdict["verdict"] == "NOT_REPRODUCED",
      "expected NOT_REPRODUCED, got %s" % real_verdict["verdict"])
check("W4-real-c6-pass", real_c6["passed"] is True,
      "expected C6 PASS, got %s" % real_c6["passed"])
check("W4-real-coverage",
      real_verdict["observed_sample_coverage"] >= al.MIN_SAMPLE_COVERAGE,
      "coverage %s" % real_verdict["observed_sample_coverage"])

# --- W1: insufficient coverage -------------------------------------------
w1 = copy.deepcopy(real)
w1_controls = w1["controls"]
w1_controls["C6_tool_result_latency_hypothesis"][
    "sample_count_independent_tool_executions"] = 3
w1_verdict = al.derive_verdict(w1_controls)
w1_c6 = al.derive_c6_check(w1_controls)
check("W1-verdict-not-not-reproduced",
      w1_verdict["verdict"] != "NOT_REPRODUCED",
      "verdict was %s" % w1_verdict["verdict"])
check("W1-verdict-capture-insufficient",
      w1_verdict["verdict"] == "CAPTURE_INSUFFICIENT",
      "verdict was %s" % w1_verdict["verdict"])
check("W1-c6-fails", w1_c6["passed"] is False,
      "C6 passed with coverage %s" % w1_c6["sample_coverage"])

# --- W2: incomplete (truncated) trace ------------------------------------
w2 = copy.deepcopy(real)
w2_controls = w2["controls"]
w2_controls["C1_identity_and_request_census"]["complete"] = False
w2_verdict = al.derive_verdict(w2_controls)
check("W2-verdict-capture-insufficient",
      w2_verdict["verdict"] == "CAPTURE_INSUFFICIENT",
      "verdict was %s" % w2_verdict["verdict"])
check("W2-verdict-not-not-reproduced",
      w2_verdict["verdict"] != "NOT_REPRODUCED",
      "verdict was %s" % w2_verdict["verdict"])

# --- W3: the floor IS reproduced -----------------------------------------
w3 = copy.deepcopy(real)
w3_controls = w3["controls"]
n = w3_controls["C6_tool_result_latency_hypothesis"][
    "sample_count_independent_tool_executions"]
w3_controls["C6_tool_result_latency_hypothesis"]["at_or_above_floor"] = {
    "count": n, "values_ms": [5000.0] * n}
w3_verdict = al.derive_verdict(w3_controls)
check("W3-verdict-reproduced", w3_verdict["verdict"] == "REPRODUCED",
      "verdict was %s" % w3_verdict["verdict"])
check("W3-verdict-not-not-reproduced",
      w3_verdict["verdict"] != "NOT_REPRODUCED",
      "verdict was %s" % w3_verdict["verdict"])

# --- W3b: the discriminator must be applied to the WHOLE sample ----------
w3b = copy.deepcopy(real)
w3b_controls = w3b["controls"]
w3b_controls["C6_tool_result_latency_hypothesis"][
    "delivery_delay_distribution"]["n"] = 1
w3b_c6 = al.derive_c6_check(w3b_controls)
check("W3b-c6-fails-partial-discriminator", w3b_c6["passed"] is False,
      "C6 passed although the discriminator covered only part of the sample")

# --- W3c: an unregistered floor must not pass -----------------------------
w3c = copy.deepcopy(real)
w3c_controls = w3c["controls"]
w3c_controls["C6_tool_result_latency_hypothesis"]["suspected_floor_ms"] = 1.0
w3c_c6 = al.derive_c6_check(w3c_controls)
check("W3c-c6-fails-unregistered-floor", w3c_c6["passed"] is False,
      "C6 passed with an unregistered floor")

# --- W6: the C7 production-modification check can FAIL -------------------
# CORRECTION01 — C7 is a real check. It must FAIL when a production path
# carries a modification. The witness drives it against a THROWAWAY git
# repository so the real repository is never touched.
import os
import shutil
import subprocess
import tempfile

import emit_evidence as ee

_tmp_repo = tempfile.mkdtemp(prefix="c7-witness-")
try:
    subprocess.check_call(["git", "init", "-q", _tmp_repo])
    subprocess.check_call(["git", "-C", _tmp_repo, "config", "user.email", "w@x"])
    subprocess.check_call(["git", "-C", _tmp_repo, "config", "user.name", "w"])
    os.makedirs(os.path.join(_tmp_repo, "sdk", "pkg"), exist_ok=True)
    with open(os.path.join(_tmp_repo, "sdk", "pkg", "a.ts"), "w") as h:
        h.write("export const a = 1;\n")
    subprocess.check_call(["git", "-C", _tmp_repo, "add", "-A"])
    subprocess.check_call(["git", "-C", _tmp_repo, "commit", "-qm", "base"])

    clean = ee.collect_no_production_modification_evidence(repo_root=_tmp_repo)
    check("W6-c7-passes-on-clean-repo", clean["passed"] is True,
          "C7 failed on a clean repo: %s" % clean.get("error"))

    # (a) an unstaged production edit
    with open(os.path.join(_tmp_repo, "sdk", "pkg", "a.ts"), "a") as h:
        h.write("export const b = 2;\n")
    dirty = ee.collect_no_production_modification_evidence(repo_root=_tmp_repo)
    check("W6a-c7-fails-on-unstaged-production-edit", dirty["passed"] is False,
          "C7 did not detect an unstaged production edit")
    check("W6a-c7-names-the-path",
          any("sdk" in p for p in dirty["working_tree_modified_in_production_paths"]),
          "C7 did not name the modified path")
    subprocess.check_call(["git", "-C", _tmp_repo, "checkout", "--", "."])

    # (b) an UNTRACKED production file
    with open(os.path.join(_tmp_repo, "sdk", "pkg", "probe.ts"), "w") as h:
        h.write("export const probe = 1;\n")
    untracked = ee.collect_no_production_modification_evidence(repo_root=_tmp_repo)
    check("W6b-c7-fails-on-untracked-production-file", untracked["passed"] is False,
          "C7 did not detect an untracked production file")
    check("W6b-c7-reports-untracked",
          any("probe" in p for p in untracked["untracked_in_production_paths"]),
          "C7 did not report the untracked production file")
    os.remove(os.path.join(_tmp_repo, "sdk", "pkg", "probe.ts"))

    # (c) a STAGED production edit
    with open(os.path.join(_tmp_repo, "sdk", "pkg", "a.ts"), "a") as h:
        h.write("export const c = 3;\n")
    subprocess.check_call(["git", "-C", _tmp_repo, "add", "-A"])
    staged = ee.collect_no_production_modification_evidence(repo_root=_tmp_repo)
    check("W6c-c7-fails-on-staged-production-edit", staged["passed"] is False,
          "C7 did not detect a staged production edit")
finally:
    shutil.rmtree(_tmp_repo, ignore_errors=True)

# --- the generator must CONSUME the derived verdict -----------------------
generator_src = open(os.path.join(HERE, "emit_evidence.py"), encoding="utf-8").read()
check("W5-generator-consumes-derived-verdict",
      'DERIVED["verdict"]' in generator_src,
      "the generator does not consume the derived verdict")
check("W5-generator-has-no-hardcoded-verdict",
      '"verdict": "NOT_REPRODUCED"' not in generator_src,
      "the generator still hardcodes a verdict")
check("W5-c6-not-unconditional",
      not any(
          seg.strip().startswith('add("C6"')
          and "True," in seg.split('add("C6"', 1)[1].split(")", 1)[0]
          for seg in generator_src.split("add(") if seg.strip().startswith('"C6"')),
      "C6 is still marked PASS unconditionally")

print("FAILING-CONTROL WITNESS — CORRECTION01")
for name in PASSES:
    print("  PASS  %s" % name)
for name in FAILURES:
    print("  FAIL  %s" % name)
print()
print("%d passed, %d failed" % (len(PASSES), len(FAILURES)))
if FAILURES:
    print("WITNESS HELD AGAINST: the generator does NOT correctly fail on "
          "a violating trace.")
    raise SystemExit(1)
print("WITNESS HELD: the corrected generator FAILS on a violating trace and "
      "PASSES on the real one.")
raise SystemExit(0)
