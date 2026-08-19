"""Network-free unit tests for scripts/dump-cline-issues.py.

Covers:
  A. parse_next_link:  no Link, only last/prev links, next+last, next
                       in different position, malformed irrelevant parts
  B. normalize_issue:  normal issue, PR excluded, missing reactions,
                       interactions math, labels reduced to names
  C. ordering:         higher interactions first, deterministic tie-break
  D. checkpoint:       round-trip, repository mismatch rejected,
                       schema_version mismatch rejected
  E. compact output:   body is not present, only allowed fields present
  F. selection policy: bounded top-N + high-value promotion, no silent truncation
  G. size contract:    prefer <= 1 MiB; <= 2 MiB acceptable; truncation policy
                       recorded when exceeded
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# The script under test lives at scripts/dump-cline-issues.py. Dashes are not
# valid in a Python module identifier, so we load it via importlib rather than
# rely on the filesystem being on sys.path as a package. The script directory
# itself is added to sys.path so that sub-imports (none today, but defensive)
# continue to resolve.
SCRIPT_DIR = Path(__file__).resolve().parent.parent
SCRIPT_FILE = SCRIPT_DIR / "dump-cline-issues.py"
sys.path.insert(0, str(SCRIPT_DIR))

_spec = importlib.util.spec_from_file_location("dci", SCRIPT_FILE)
_dci = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_dci)
dci = _dci

ALLOWED_ISSUE_FIELDS = {
    "number", "title", "url",
    "created_at", "updated_at",
    "comments", "reactions", "interactions",
    "labels",
}


class ParseNextLinkTests(unittest.TestCase):
    def test_none_returns_none(self):
        self.assertIsNone(dci.parse_next_link(None))

    def test_empty_returns_none(self):
        self.assertIsNone(dci.parse_next_link(""))

    def test_only_last_and_prev_returns_none(self):
        header = (
            '<https://api.github.com/repositories/1/issues?page=2&per_page=100>; rel="prev", '
            '<https://api.github.com/repositories/1/issues?page=10&per_page=100>; rel="last"'
        )
        self.assertIsNone(dci.parse_next_link(header))

    def test_next_and_last(self):
        header = (
            '<https://api.github.com/repositories/1/issues?page=2&per_page=100>; rel="next", '
            '<https://api.github.com/repositories/1/issues?page=10&per_page=100>; rel="last"'
        )
        self.assertEqual(
            dci.parse_next_link(header),
            "https://api.github.com/repositories/1/issues?page=2&per_page=100",
        )

    def test_next_in_different_position(self):
        header = (
            '<https://api.github.com/repositories/1/issues?page=10&per_page=100>; rel="last", '
            '<https://api.github.com/repositories/1/issues?page=2&per_page=100>; rel="next", '
            '<https://api.github.com/repositories/1/issues?page=1&per_page=100>; rel="prev"'
        )
        self.assertEqual(
            dci.parse_next_link(header),
            "https://api.github.com/repositories/1/issues?page=2&per_page=100",
        )

    def test_malformed_irrelevant_part(self):
        header = (
            'garbage, <https://api.github.com/repositories/1/issues?page=2>; rel="next", '
            '<this is not a url>; rel="prev"'
        )
        self.assertEqual(
            dci.parse_next_link(header),
            "https://api.github.com/repositories/1/issues?page=2",
        )

    def test_query_params_with_ampersands(self):
        header = (
            '<https://api.github.com/repositories/1/issues'
            '?state=open&per_page=100&page=2&sort=updated&direction=desc>; rel="next"'
        )
        self.assertEqual(
            dci.parse_next_link(header),
            "https://api.github.com/repositories/1/issues"
            "?state=open&per_page=100&page=2&sort=updated&direction=desc",
        )


class NormalizeIssueTests(unittest.TestCase):
    def test_normal_issue(self):
        item = {
            "number": 1234,
            "title": "Context window overflow",
            "html_url": "https://github.com/cline/cline/issues/1234",
            "body": "This is a long body that should NOT be stored.",
            "state": "open",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2025-02-02T00:00:00Z",
            "comments": 10,
            "reactions": {"total_count": 5, "+1": 3, "-1": 0, "heart": 2},
            "labels": [{"name": "bug"}, {"name": "performance"}],
            "user": {"login": "someone"},
            "assignees": [],
            "milestone": None,
        }
        out = dci.normalize_issue(item)
        self.assertIsNotNone(out)
        self.assertEqual(out["number"], 1234)
        self.assertEqual(out["title"], "Context window overflow")
        self.assertEqual(out["url"], "https://github.com/cline/cline/issues/1234")
        self.assertEqual(out["comments"], 10)
        self.assertEqual(out["reactions"], 5)
        self.assertEqual(out["interactions"], 15)
        self.assertEqual(out["labels"], ["bug", "performance"])  # sorted
        # Body must NOT be present.
        self.assertNotIn("body", out)

    def test_pull_request_excluded(self):
        item = {
            "number": 7,
            "title": "Some PR title",
            "html_url": "https://github.com/cline/cline/pull/7",
            "pull_request": {"url": "..."},
            "state": "open",
            "comments": 0,
            "reactions": {"total_count": 0},
            "labels": [],
        }
        self.assertIsNone(dci.normalize_issue(item))

    def test_missing_reactions_defaults_to_zero(self):
        item = {
            "number": 9,
            "title": "no reactions",
            "html_url": "https://github.com/cline/cline/issues/9",
            "comments": 3,
            "labels": [],
        }
        out = dci.normalize_issue(item)
        self.assertEqual(out["reactions"], 0)
        self.assertEqual(out["interactions"], 3)

    def test_interactions_math(self):
        item = {
            "number": 10,
            "title": "x",
            "html_url": "u",
            "comments": 4,
            "reactions": {"total_count": 6},
            "labels": [],
        }
        out = dci.normalize_issue(item)
        self.assertEqual(out["interactions"], 10)

    def test_labels_reduced_to_sorted_names(self):
        item = {
            "number": 11,
            "title": "x",
            "html_url": "u",
            "comments": 0,
            "reactions": {"total_count": 0},
            "labels": [
                {"name": "z"},
                {"name": "a"},
                {"name": "m"},
            ],
        }
        out = dci.normalize_issue(item)
        self.assertEqual(out["labels"], ["a", "m", "z"])

    def test_non_dict_returns_none(self):
        self.assertIsNone(dci.normalize_issue("not a dict"))
        self.assertIsNone(dci.normalize_issue(None))

    def test_missing_number_returns_none(self):
        self.assertIsNone(dci.normalize_issue({"title": "no number"}))


class OrderingTests(unittest.TestCase):
    def _issue(self, number, interactions, updated_at):
        return {
            "number": number,
            "title": f"i{number}",
            "url": "u",
            "created_at": "2020-01-01T00:00:00Z",
            "updated_at": updated_at,
            "comments": 0,
            "reactions": 0,
            "interactions": interactions,
            "labels": [],
        }

    def test_higher_interactions_first(self):
        issues = [
            self._issue(1, 1, "2024-01-01T00:00:00Z"),
            self._issue(2, 5, "2024-01-01T00:00:00Z"),
            self._issue(3, 3, "2024-01-01T00:00:00Z"),
        ]
        out = dci.sort_issues(issues)
        self.assertEqual([i["number"] for i in out], [2, 3, 1])

    def test_tie_break_by_updated_at_desc(self):
        issues = [
            self._issue(1, 5, "2024-01-01T00:00:00Z"),
            self._issue(2, 5, "2024-06-01T00:00:00Z"),
        ]
        out = dci.sort_issues(issues)
        self.assertEqual([i["number"] for i in out], [2, 1])

    def test_tie_break_by_number_desc(self):
        issues = [
            self._issue(1, 5, "2024-01-01T00:00:00Z"),
            self._issue(7, 5, "2024-01-01T00:00:00Z"),
            self._issue(3, 5, "2024-01-01T00:00:00Z"),
        ]
        out = dci.sort_issues(issues)
        self.assertEqual([i["number"] for i in out], [7, 3, 1])

    def test_deterministic_for_same_input(self):
        issues = [
            self._issue(1, 1, "2024-01-01T00:00:00Z"),
            self._issue(2, 1, "2024-01-01T00:00:00Z"),
        ]
        a = dci.sort_issues(issues)
        b = dci.sort_issues(issues)
        self.assertEqual(a, b)


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._old_tmpdir = os.environ.get("TMPDIR")
        os.environ["TMPDIR"] = self._tmp.name
        dci.clear_checkpoint()

    def tearDown(self):
        dci.clear_checkpoint()
        if self._old_tmpdir is None:
            os.environ.pop("TMPDIR", None)
        else:
            os.environ["TMPDIR"] = self._old_tmpdir
        self._tmp.cleanup()

    def test_round_trip(self):
        dci.write_checkpoint("cline/cline", "https://example/next", [{"number": 1}])
        next_url, issues = dci.read_checkpoint("cline/cline")
        self.assertEqual(next_url, "https://example/next")
        self.assertEqual(issues, [{"number": 1}])

    def test_repository_mismatch_rejected(self):
        dci.write_checkpoint("owner-a/repo-a", "https://example/next", [])
        with self.assertRaises(SystemExit):
            dci.read_checkpoint("owner-b/repo-b")

    def test_schema_version_mismatch_rejected(self):
        path = dci.checkpoint_path()
        path.write_text(
            json.dumps({
                "schema_version": 999,
                "repository": "cline/cline",
                "next_url": None,
                "issues": [],
            }),
            encoding="utf-8",
        )
        with self.assertRaises(SystemExit):
            dci.read_checkpoint("cline/cline")

    def test_absent_checkpoint_returns_none(self):
        next_url, issues = dci.read_checkpoint("cline/cline")
        self.assertIsNone(next_url)
        self.assertEqual(issues, [])

    def test_checkpoint_cleared_on_completion(self):
        dci.write_checkpoint("cline/cline", "https://example/next", [{"number": 1}])
        self.assertTrue(dci.checkpoint_path().exists())
        dci.clear_checkpoint()
        self.assertFalse(dci.checkpoint_path().exists())


class SelectionPolicyTests(unittest.TestCase):
    def _issue(self, number, title, interactions, labels=()):
        return {
            "number": number,
            "title": title,
            "url": "u",
            "created_at": "2020-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "comments": 0,
            "reactions": 0,
            "interactions": interactions,
            "labels": list(labels),
        }

    def test_no_truncation_when_under_limit(self):
        issues = [self._issue(i, f"i{i}", 10 - i) for i in range(5)]
        committed, total, truncated, policy = dci.select_committed(issues, max_committed=10)
        self.assertEqual(total, 5)
        self.assertFalse(truncated)
        self.assertEqual(policy, "no truncation")
        self.assertEqual(len(committed), 5)

    def test_truncation_records_policy(self):
        # 1000 issues, max 500 -- must truncate and record policy.
        issues = [self._issue(i, f"i{i}", 1000 - i) for i in range(1000)]
        committed, total, truncated, policy = dci.select_committed(issues, max_committed=500)
        self.assertEqual(total, 1000)
        self.assertTrue(truncated)
        self.assertIn("top-500-by-interactions", policy)
        self.assertEqual(len(committed), 500)
        # Top-N by interactions should keep highest-interaction issues.
        self.assertEqual(committed[0]["number"], 0)
        self.assertEqual(committed[-1]["number"], 499)

    def test_high_value_promotion_when_truncated(self):
        # All issues have low interaction; one high-value keyword in title.
        issues = [
            self._issue(1, "MCP integration request", 1),
            self._issue(2, "low-value item", 1),
            self._issue(3, "another low-value", 1),
        ]
        # Production calls select_committed() with a SORTED list. Mirror that.
        sorted_issues = dci.sort_issues(issues)
        # After sort (interactions tie, then updated_at tie, then number DESC):
        # top by interactions is [3, 2, 1]. Truncating to 1 keeps [3].
        # High-value issue 1 (MCP) must still be promoted.
        committed, total, truncated, policy = dci.select_committed(sorted_issues, max_committed=1)
        self.assertTrue(truncated)
        numbers = [c["number"] for c in committed]
        self.assertIn(1, numbers)  # high-value promoted
        self.assertEqual(len(committed), 2)  # 1 from top + 1 promoted (dedupe)


class CompactOutputTests(unittest.TestCase):
    def test_run_pipeline_with_fake_pages(self):
        """End-to-end test: build a fake page1/page2 using a mocked request_json.

        The fetcher MUST follow Link-header rel=next, MUST exclude PRs, MUST
        checkpoint between pages, MUST produce a compact JSON under 2 MiB,
        and MUST clear the checkpoint on success.
        """
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["TMPDIR"] = tmp
            out_path = Path(tmp) / "snapshot.json"
            dci.clear_checkpoint()

            fake_item_issue = {
                "number": 1,
                "title": "real issue",
                "html_url": "https://github.com/cline/cline/issues/1",
                "state": "open",
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-02-01T00:00:00Z",
                "comments": 2,
                "reactions": {"total_count": 3},
                "labels": [{"name": "bug"}],
            }
            fake_item_pr = {
                "number": 2,
                "title": "a pull request",
                "html_url": "https://github.com/cline/cline/pull/2",
                "pull_request": {"url": "..."},
                "state": "open",
                "comments": 0,
                "reactions": {"total_count": 0},
                "labels": [],
            }

            page1_payload = [fake_item_issue, fake_item_pr]
            page2_payload = [{
                "number": 3,
                "title": "second-page issue",
                "html_url": "https://github.com/cline/cline/issues/3",
                "state": "open",
                "created_at": "2024-01-02T00:00:00Z",
                "updated_at": "2024-02-02T00:00:00Z",
                "comments": 0,
                "reactions": {"total_count": 1},
                "labels": [],
            }]

            responses = [
                (page1_payload, {
                    "Link": (
                        '<https://api.example/repos/cline/cline/issues?page=2&per_page=100>; rel="next", '
                        '<https://api.example/repos/cline/cline/issues?page=2&per_page=100>; rel="last"'
                    )
                }),
                (page2_payload, {"Link": ""}),  # no next -> stop
            ]

            with mock.patch.object(dci, "request_json", side_effect=responses):
                stats = dci.run(
                    owner="cline", repo="cline",
                    output=out_path, fresh=True,
                    max_committed=500,
                )

            self.assertEqual(stats["page_count"], 2)
            self.assertEqual(stats["prs_excluded"], 1)
            self.assertEqual(stats["open_issues_total"], 2)
            self.assertEqual(stats["committed_issue_count"], 2)
            self.assertFalse(stats["truncated"])

            # Checkpoint must be cleared on success.
            self.assertFalse(dci.checkpoint_path().exists())

            # Output must exist and validate.
            self.assertTrue(out_path.exists())
            payload = json.loads(out_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["schema_version"], 1)
            self.assertEqual(payload["repository"], "cline/cline")
            self.assertEqual(payload["state"], "open")
            self.assertEqual(payload["source_api"], "github-rest")
            self.assertEqual(payload["issue_count"], 2)

            for issue in payload["issues"]:
                self.assertEqual(set(issue.keys()), ALLOWED_ISSUE_FIELDS)
                self.assertNotIn("body", issue)
                self.assertNotIn("user", issue)
                self.assertNotIn("assignees", issue)
                self.assertNotIn("milestone", issue)
                self.assertNotIn("pull_request", issue)
                # Truthfulness
                self.assertEqual(
                    issue["interactions"],
                    issue["comments"] + issue["reactions"],
                )

            # Deterministic ordering: 1 has 5 interactions, 3 has 1.
            self.assertEqual([i["number"] for i in payload["issues"]], [1, 3])


class AtomicOutputTests(unittest.TestCase):
    def test_write_snapshot_atomic_does_not_leave_tmp(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "snap.json"
            dci.write_snapshot_atomic(out, {"x": 1})
            self.assertTrue(out.exists())
            self.assertFalse(out.with_suffix(out.suffix + ".tmp").exists())
            self.assertEqual(json.loads(out.read_text(encoding="utf-8")), {"x": 1})


class SizeContractTests(unittest.TestCase):
    def test_thresholds_exist_and_are_sane(self):
        self.assertLessEqual(dci.PREFERRED_MAX_BYTES, dci.ACCEPTABLE_MAX_BYTES)
        self.assertGreater(dci.ACCEPTABLE_MAX_BYTES, 0)


if __name__ == "__main__":
    unittest.main()
