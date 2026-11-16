"""
RED -> GREEN unit tests for
scripts/roundc-trace-qual01-evidence-crosswalk.py

ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01.

The QUAL01 review returned HALT_EVIDENCE_EQUIVALENCE_UNSOUND with three P0
defects. Each one gets a SMALL RED counterexample here that the previous
implementation FAILED, followed by the GREEN assertion of the corrected
behaviour.

  A. EVIDENCE CROSSWALK (P0-1)
     A1. a tool_use whose INPUT mentions a risk keyword but whose
         tool_result FAILED is NOT evidence;
     A2. a tool_use whose input matches but whose tool_result is
         irrelevant (the keyword does not appear in the output) is NOT
         evidence;
     A3. a tool_use whose input matches AND whose tool_result SUCCEEDS
         with the keyword IS evidence;
     A4. a tool_use with NO tool_result at all is NOT evidence;
     A5. R5 compares the FINAL REPORTS of both runs against the
         source-backed identifiers, not just the command inputs;
     A6. R5 reconciles only when the identifier is in the report too;
     A7. R1/R9/R10 do NOT get STRONGER merely because a render file
         exists.

  B. HELM EVIDENCE (P0-2)
     B1. `helm.sh/hook-weight` alone is NOT a Helm hook;
     B2. the distinct `helm.sh/hook` annotation IS a Helm hook;
     B3. the hook count is exact (one hook-weight + one hook => 1);
     B4. the render receipt records the production-values provenance;
     B5. the placeholder-digest render is distinguished from the
         no-image-override render.

  C. TIMING CLASSIFICATION (P0-3) lives in the production observer and is
     exercised by the TypeScript suite in sdk/packages/agents.

The tests are deterministic and offline: they build synthetic session
directories and synthetic render files, and never contact a network, a
cluster or a model.

Uses stdlib unittest, matching the project's testing conventions
(see scripts/tests/test_check_code_coverage_ratchet.py and
scripts/tests/test_dump_cline_issues.py).
"""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent
SCRIPT_FILE = SCRIPT_DIR / "roundc-trace-qual01-evidence-crosswalk.py"
sys.path.insert(0, str(SCRIPT_DIR))

_spec = importlib.util.spec_from_file_location("crosswalk", SCRIPT_FILE)
_crosswalk = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_crosswalk)
crosswalk = _crosswalk


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def tool_use(call_id: str, name: str, payload: dict) -> dict:
    return {"type": "tool_use", "id": call_id, "name": name, "input": payload}


def tool_result(call_id: str, name: str, text: str, is_error: bool = False) -> dict:
    part = {
        "type": "tool_result",
        "tool_use_id": call_id,
        "name": name,
        "content": [{"query": "q", "result": text}],
    }
    if is_error:
        part["is_error"] = True
    return part


def assistant(parts: list) -> dict:
    return {"role": "assistant", "content": parts}


def user(parts: list) -> dict:
    return {"role": "user", "content": parts}


def write_session(
    directory: Path, session_id: str, messages: list, status: str = "completed"
) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / (session_id + ".messages.json")).write_text(
        json.dumps({"messages": messages}), encoding="utf-8"
    )
    (directory / (session_id + ".json")).write_text(
        json.dumps(
            {
                "session_id": session_id,
                "started_at": "2026-11-15T00:00:00.000Z",
                "status": status,
                "provider": "openai-compatible",
                "model": "some-model",
                "cwd": "/tmp/repo",
                "metadata": {"usage": {"outputTokens": 1, "inputTokens": 2}},
            }
        ),
        encoding="utf-8",
    )


def build_crosswalk(
    tmp: Path,
    original_messages: list,
    new_messages: list,
    render_text: str | None,
    keycloak_repo: Path | None = None,
):
    """Build a crosswalk over two synthetic sessions and an optional render."""
    original_dir = tmp / "original"
    new_dir = tmp / "new"
    write_session(original_dir, crosswalk.ORIGINAL_SESSION_ID, original_messages)
    write_session(new_dir, crosswalk.NEW_SESSION_ID, new_messages)

    render_path = ""
    if render_text is not None:
        render_file = tmp / "rendered.yaml"
        render_file.write_text(render_text, encoding="utf-8")
        render_path = str(render_file)

    class Args:
        pass

    args = Args()
    args.original_session_dir = str(original_dir)
    args.new_session_dir = str(new_dir)
    args.keycloak_repo = str(keycloak_repo) if keycloak_repo else ""
    args.render_path = render_path
    args.chart_version = "chart 1.0.0"
    args.chart_source_sha = "deadbeef"
    args.out = str(tmp / "out.json")
    args.values_files = []
    args.production_values_applied = False
    args.no_image_override_render_path = ""
    return crosswalk.build_crosswalk(args)


def row_for(cw: dict, subject: str) -> dict:
    for row in cw["rows"]:
        if row["id"] == subject:
            return row
    raise AssertionError("no row for " + subject)


# ---------------------------------------------------------------------------
# A. EVIDENCE CROSSWALK (P0-1)
# ---------------------------------------------------------------------------


class ToolResultCorrelationTests(unittest.TestCase):
    """A1-A4: evidence requires a SUCCESSFUL, ON-TOPIC tool_result."""

    def test_A1_failed_tool_result_is_not_evidence(self):
        """A1: a FAILED command that merely MENTIONS the keyword is not evidence."""
        messages = [
            assistant([tool_use("c1", "run_commands", {"command": "grep timeout src"})]),
            user([tool_result("c1", "run_commands", "ERROR: command failed", is_error=True)]),
        ]
        with tempfile.TemporaryDirectory() as td:
            cw = build_crosswalk(Path(td), messages, messages, None)
            row = row_for(cw, "R2")
            self.assertNotEqual(
                row["status"],
                "EQUIVALENT",
                "a failed tool_result must not certify the R2 evidence as EQUIVALENT",
            )

    def test_A2_irrelevant_tool_result_is_not_evidence(self):
        """A2: a SUCCESSFUL command whose OUTPUT is irrelevant is not evidence."""
        messages = [
            assistant([tool_use("c1", "run_commands", {"command": "grep timeout src"})]),
            user([tool_result("c1", "run_commands", "no matches found")]),
        ]
        with tempfile.TemporaryDirectory() as td:
            cw = build_crosswalk(Path(td), messages, messages, None)
            row = row_for(cw, "R2")
            self.assertNotEqual(
                row["status"],
                "EQUIVALENT",
                "a tool_result that does not carry the subject's evidence is not evidence",
            )

    def test_A3_successful_on_topic_tool_result_is_evidence(self):
        """A3: a SUCCESSFUL command whose OUTPUT carries the evidence IS evidence."""
        messages = [
            assistant([tool_use("c1", "run_commands", {"command": "grep timeout src"})]),
            user(
                [
                    tool_result(
                        "c1",
                        "run_commands",
                        "src/Carrier.java: timeout is configured at 30s",
                    )
                ]
            ),
        ]
        with tempfile.TemporaryDirectory() as td:
            cw = build_crosswalk(Path(td), messages, messages, None)
            row = row_for(cw, "R2")
            self.assertEqual(
                row["status"],
                "EQUIVALENT",
                "a successful, on-topic tool_result IS evidence for R2",
            )

    def test_A4_tool_use_without_tool_result_is_not_evidence(self):
        """A4: a tool_use with NO tool_result at all is not evidence."""
        messages = [
            assistant([tool_use("c1", "run_commands", {"command": "grep timeout src"})]),
        ]
        with tempfile.TemporaryDirectory() as td:
            cw = build_crosswalk(Path(td), messages, messages, None)
            row = row_for(cw, "R2")
            self.assertNotEqual(
                row["status"],
                "EQUIVALENT",
                "a tool_use without any tool_result is not evidence",
            )


class R5FinalReportTests(unittest.TestCase):
    """A5-A6: R5 compares the FINAL REPORTS against source-backed identifiers."""

    IDENTIFIER = crosswalk.R5_INDEX_IDENTIFIERS[0]

    def _messages(self, *, in_command: bool, in_report: bool) -> list:
        messages: list = []
        if in_command:
            messages.append(
                assistant(
                    [tool_use("c1", "run_commands", {"command": "grep " + self.IDENTIFIER})]
                )
            )
            messages.append(
                user(
                    [
                        tool_result(
                            "c1", "run_commands", "src/db.sql: " + self.IDENTIFIER
                        )
                    ]
                )
            )
        report = (
            "final report mentioning " + self.IDENTIFIER
            if in_report
            else "final report"
        )
        messages.append(assistant([{"type": "text", "text": report}]))
        return messages

    def _repo_with(self, tmp: Path) -> Path:
        """A tracked source artifact carrying the identifier."""
        repo = tmp / "repo"
        repo.mkdir(parents=True, exist_ok=True)
        (repo / "db.sql").write_text(
            "CREATE INDEX " + self.IDENTIFIER + " ON tokens (id);\n", encoding="utf-8"
        )
        return repo

    def test_A5_report_must_carry_the_identifier(self):
        """A5: the identifier in the command but NOT in the report is not reconciled."""
        messages = self._messages(in_command=True, in_report=False)
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            cw = build_crosswalk(tmp, messages, messages, None, self._repo_with(tmp))
            row = row_for(cw, "R5")
            reconciled = {item["identifier"]: item for item in row["reconciledIdentifiers"]}
            self.assertFalse(
                reconciled[self.IDENTIFIER]["reconciled"],
                "an identifier absent from the final report must not reconcile",
            )

    def test_A6_report_carrying_the_identifier_reconciles(self):
        """A6: the identifier in BOTH the command and the report reconciles."""
        messages = self._messages(in_command=True, in_report=True)
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            cw = build_crosswalk(tmp, messages, messages, None, self._repo_with(tmp))
            row = row_for(cw, "R5")
            reconciled = {item["identifier"]: item for item in row["reconciledIdentifiers"]}
            self.assertTrue(
                reconciled[self.IDENTIFIER]["reconciled"],
                "an identifier present in the command, the tool_result and the "
                "final report must reconcile",
            )

    def test_A5b_final_report_is_actually_read(self):
        """A5b: the crosswalk records the final report it reconciled against."""
        messages = self._messages(in_command=True, in_report=True)
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            cw = build_crosswalk(tmp, messages, messages, None, self._repo_with(tmp))
            row = row_for(cw, "R5")
            self.assertIn(
                "finalReport",
                row,
                "R5 must record which final report it reconciled the identifiers against",
            )


class RenderAutoStrongerTests(unittest.TestCase):
    """A7: a render file alone must not award STRONGER."""

    RENDER = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n"

    def test_A7_render_alone_does_not_award_stronger(self):
        """A7: an EMPTY render must not certify R1/R9/R10 as STRONGER."""
        messages = [
            assistant([tool_use("c1", "run_commands", {"command": "helm template"})]),
            user([tool_result("c1", "run_commands", "rendered")]),
        ]
        with tempfile.TemporaryDirectory() as td:
            cw = build_crosswalk(Path(td), messages, messages, self.RENDER)
            for subject in ("R1", "R9", "R10"):
                row = row_for(cw, subject)
                self.assertNotEqual(
                    row["status"],
                    "STRONGER",
                    subject + " must not be STRONGER on the mere existence of a render",
                )


# ---------------------------------------------------------------------------
# B. HELM EVIDENCE (P0-2)
# ---------------------------------------------------------------------------


class HelmHookCountingTests(unittest.TestCase):
    """B1-B3: the hook count distinguishes `helm.sh/hook` from `hook-weight`."""

    def test_B1_hook_weight_is_not_a_hook(self):
        """B1: a manifest with ONLY helm.sh/hook-weight has ZERO hooks."""
        manifest = (
            "apiVersion: v1\n"
            "kind: ConfigMap\n"
            "metadata:\n"
            "  name: demo\n"
            "  annotations:\n"
            '    "helm.sh/hook-weight": "5"\n'
        )
        receipt = crosswalk.render_receipt_from_text(manifest)
        self.assertEqual(
            receipt["hookCount"],
            0,
            "helm.sh/hook-weight must NOT be counted as a Helm hook",
        )
        self.assertEqual(receipt["hookWeightCount"], 1)

    def test_B2_hook_annotation_is_a_hook(self):
        """B2: the distinct helm.sh/hook annotation IS a hook."""
        manifest = (
            "apiVersion: v1\n"
            "kind: ConfigMap\n"
            "metadata:\n"
            "  name: demo\n"
            "  annotations:\n"
            '    "helm.sh/hook": pre-install\n'
            '    "helm.sh/hook-weight": "5"\n'
        )
        receipt = crosswalk.render_receipt_from_text(manifest)
        self.assertEqual(receipt["hookCount"], 1)
        self.assertEqual(receipt["hookWeightCount"], 1)

    def test_B3_hook_count_is_exact(self):
        """B3: one hook-weight plus one hook counts exactly ONE hook."""
        manifest = (
            "apiVersion: v1\n"
            "kind: ConfigMap\n"
            "metadata:\n"
            "  name: a\n"
            "  annotations:\n"
            '    "helm.sh/hook-weight": "10"\n'
            "---\n"
            "apiVersion: v1\n"
            "kind: ConfigMap\n"
            "metadata:\n"
            "  name: b\n"
            "  annotations:\n"
            '    "helm.sh/hook": post-install\n'
        )
        receipt = crosswalk.render_receipt_from_text(manifest)
        self.assertEqual(receipt["hookCount"], 1)

    def test_B3b_hook_weight_only_matches_do_not_leak_into_hook_count(self):
        """B3b: the naive substring regex must not be the hook counter."""
        manifest = '  "helm.sh/hook-weight": "-10"\n'
        receipt = crosswalk.render_receipt_from_text(manifest)
        self.assertEqual(receipt["hookCount"], 0)


class RenderProvenanceTests(unittest.TestCase):
    """B4-B5: the receipt records the production-values provenance."""

    RENDER = (
        "apiVersion: v1\n"
        "kind: StatefulSet\n"
        "metadata:\n"
        "  name: x\n"
        "spec:\n"
        "  template:\n"
        "    spec:\n"
        "      nodeSelector:\n"
        "        dedicated: keycloak\n"
        "      containers:\n"
        "      - image: \"quay.io/keycloak/keycloak:26.0.7\"\n"
    )

    def test_B4_production_values_provenance_is_recorded(self):
        """B4: the receipt states WHICH values files produced the render."""
        receipt = crosswalk.render_receipt_from_text(self.RENDER)
        self.assertIn("valuesFiles", receipt)
        self.assertIn("productionValuesApplied", receipt)

    def test_B5_placeholder_and_no_override_renders_are_distinguished(self):
        """B5: a placeholder-digest render is not the no-image-override render."""
        placeholder = (
            "apiVersion: v1\n"
            "kind: StatefulSet\n"
            "spec:\n"
            "  template:\n"
            "    spec:\n"
            "      containers:\n"
            '      - image: "repo/img@sha256:' + ("0" * 64) + '"\n'
        )
        placeholder_receipt = crosswalk.render_receipt_from_text(placeholder)
        override_receipt = crosswalk.render_receipt_from_text(self.RENDER)
        self.assertTrue(placeholder_receipt["placeholderDigest"])
        self.assertFalse(override_receipt["placeholderDigest"])
        self.assertNotEqual(
            placeholder_receipt["images"],
            override_receipt["images"],
            "the placeholder render and the no-image-override render resolve "
            "different images and must be distinguishable",
        )


if __name__ == "__main__":
    unittest.main()
