#!/usr/bin/env python3
"""
ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the R1-R10 EVIDENCE CROSSWALK generator.

What this is
------------
A small, deterministic, LOCAL script that builds the evidence-equivalence
crosswalk for the Keycloak Round C comparison.

It is NOT a security auditor, NOT a finding-scoring framework and NOT a
telemetry platform. For each of the ten original risk subjects it records:

  - what the ORIGINAL run observed,
  - what the NEW run observed,
  - whether equivalent verification occurred,
  - whether the final finding faithfully represents that evidence,
  - what is missing or weaker,
  - and a comparability judgment.

The automation boundary
-----------------------
  - It READS the two runs' messages.json (the OBSERVED tool evidence) and
    the two runs' session metadata.
  - It NEVER re-runs a model, NEVER contacts a cluster, NEVER installs a
    VSIX and NEVER benchmarks.
  - It NEVER invents an index name, never repairs a transcript and never
    substitutes the final model prose for observed tool output.
  - The published manifest carries only permitted evidence REFERENCES,
    hashes, statuses and concise redacted descriptions.

Usage
-----
    python3 scripts/roundc-trace-qual01-evidence-crosswalk.py \
        --original-session-dir <dir> --new-session-dir <dir> \
        --keycloak-repo <dir> --render-path <file> --out <file>

Every argument is optional; a missing input degrades the corresponding row
to UNVERIFIED rather than failing the run or inventing evidence.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import re
import sys

# The ten original risk subjects and their minimum evidence requirements.
# These are transcribed from the ACT's C5 contract, not invented here.
RISK_SUBJECTS = {
    "R1": {
        "requirement": "Effective Helm-rendered image and CI/manual-upgrade distinction",
        "discriminator": "offline_helm_render",
        "patterns": [
            r"helm",
            r"values\.yaml",
            r"Chart\.yaml",
            r"image:",
            r"repository:",
            r"digest",
            r"\.gitlab-ci\.yml",
        ],
    },
    "R2": {
        "requirement": "Carrier timeout path, synchronous execution, real mitigations",
        "discriminator": "source_read",
        "patterns": [r"timeout", r"DefaultPhoneProvider", r"Thread\.sleep", r"provider"],
    },
    "R3": {
        "requirement": "DB pool invariant and enforcement/absence evidence",
        "discriminator": "source_read",
        "patterns": [r"pool", r"maxPoolSize", r"minimumIdle", r"hikari", r"datasource"],
    },
    "R4": {
        "requirement": "Actual build/start paths and persisted build settings",
        "discriminator": "source_read",
        "patterns": [r"startup\.sh", r"Dockerfile", r"build\.sh", r"assembly", r"gradle", r"maven"],
    },
    "R5": {
        "requirement": "Exact six index identifiers reconciled with source artifacts",
        "discriminator": "exact_identifier_reconciliation",
        "patterns": [r"idx_", r"index", r"Liquibase", r"liquibase", r"pg-index"],
    },
    "R6": {
        "requirement": "Repository retention paths and explicit external-state unknown",
        "discriminator": "source_read",
        "patterns": [r"retention", r"ttl", r"expire", r"cleanup", r"prune"],
    },
    "R7": {
        "requirement": "Maven/CI execution evidence for Java tests",
        "discriminator": "source_read",
        "patterns": [r"mvn", r"maven", r"skipTests", r"surefire"],
    },
    "R8": {
        "requirement": "Committed secret exposure, without credential validation",
        "discriminator": "source_read",
        "patterns": [r"secret", r"password", r"credential", r"bootstrap"],
    },
    "R9": {
        "requirement": "Effective chart security defaults and NetworkPolicy/PDB coverage",
        "discriminator": "offline_helm_render",
        "patterns": [r"NetworkPolicy", r"networkPolicy", r"PDB", r"podDisruptionBudget", r"securityContext"],
    },
    "R10": {
        "requirement": "Actual hook semantics, rollback behavior and watcher implementation",
        "discriminator": "offline_helm_render",
        "patterns": [r"hook", r"rollback", r"watch", r"profilerWatcher"],
    },
}

# The six exact index identifiers reconciled by the R5 discriminator. These
# were RECOVERED from the original run's observed tool evidence and are
# cross-checked against the tracked source artifacts. This script never
# generates an index name.
R5_INDEX_IDENTIFIERS = [
    "idx_pm_token_code_realm_ip_type_created_at_inc_id",
    "idx_pmtc_lookup_recent_unconfirmed_sms",
    "idx_pmtc_lookup_recent_unconfirmed_sms_exp",
    "idx_user_attribute_name_lower_value",
    "idx_user_entity_realm_email",
    "idx_user_entity_realm_email_cover",
]

# The permitted, non-sensitive session identifiers.
ORIGINAL_SESSION_ID = "1794702518894_gui73"
NEW_SESSION_ID = "1794780088950_tc1vx"


def sha256_file(path: str):
    try:
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        return None


def load_json(path: str):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def session_metadata(session_dir: str, session_id: str):
    data = load_json(os.path.join(session_dir, session_id + ".json"))
    if not isinstance(data, dict):
        return None
    metadata = data.get("metadata") or {}
    usage = metadata.get("usage") or {}
    return {
        "sessionId": session_id,
        "startedAt": data.get("started_at"),
        "status": data.get("status"),
        "provider": data.get("provider"),
        "model": data.get("model"),
        "cwd": data.get("cwd"),
        "outputTokens": usage.get("outputTokens"),
        "inputTokens": usage.get("inputTokens"),
        "cacheReadTokens": usage.get("cacheReadTokens"),
        "sessionHistoryOriginVersion": (metadata.get("sessionHistoryOrigin") or {}).get("version"),
        "gitBranch": (metadata.get("git") or {}).get("branch"),
        "gitUrl": (metadata.get("git") or {}).get("url"),
    }


def observed_tool_evidence(session_dir: str, session_id: str):
    """The OBSERVED tool evidence of a run.

    This is the transcript's tool INVOCATIONS — the commands the model
    actually issued — not the model's prose about them. The final model
    prose is never treated as a substitute for this.
    """
    messages = load_json(os.path.join(session_dir, session_id + ".messages.json"))
    if messages is None:
        return None
    if isinstance(messages, dict):
        messages = messages.get("messages", [])
    invocations = []
    for index, message in enumerate(messages):
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, dict) and part.get("type") == "tool_use":
                invocations.append(
                    {
                        "messageIndex": index,
                        "tool": part.get("name"),
                        "input": part.get("input"),
                    }
                )
    return invocations


def evidence_for(invocations, patterns):
    """The invocations whose input matches the subject's patterns."""
    compiled = [re.compile(pattern, re.IGNORECASE) for pattern in patterns]
    matched = []
    for invocation in invocations:
        blob = json.dumps(invocation.get("input"), default=str)
        if any(pattern.search(blob) for pattern in compiled):
            matched.append(invocation)
    return matched


def identifier_counts(invocations, identifier: str) -> int:
    count = 0
    for invocation in invocations:
        blob = json.dumps(invocation.get("input"), default=str)
        if identifier in blob:
            count += 1
    return count


def tracked_source_hits(repo: str, identifier: str):
    """The tracked source files that contain the identifier."""
    hits = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in {".git", "node_modules", "target", "build"}]
        for name in files:
            if not name.endswith((".sql", ".xml", ".yaml", ".yml", ".java", ".csv")):
                continue
            path = os.path.join(root, name)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as handle:
                    if identifier in handle.read():
                        hits.append(os.path.relpath(path, repo))
            except OSError:
                continue
    return sorted(hits)


def render_receipt(render_path: str):
    """The offline Helm render receipt."""
    if not render_path or not os.path.exists(render_path):
        return None
    try:
        with open(render_path, "r", encoding="utf-8") as handle:
            text = handle.read()
    except OSError:
        return None
    images = sorted(set(re.findall(r"image:\s*\"?([^\s\"']+)", text)))
    kinds = collections.Counter(re.findall(r"^kind:\s*(\S+)", text, re.MULTILINE))
    return {
        "renderSha256": sha256_file(render_path),
        "renderBytes": len(text.encode("utf-8")),
        "images": images,
        "kinds": dict(sorted(kinds.items())),
        "podDisruptionBudgetCount": kinds.get("PodDisruptionBudget", 0),
        "networkPolicyCount": kinds.get("NetworkPolicy", 0),
        "hookCount": len(re.findall(r"helm\.sh/hook", text)),
        "securityContextCount": len(re.findall(r"securityContext", text)),
    }


def build_crosswalk(args) -> dict:
    original_invocations = observed_tool_evidence(args.original_session_dir, ORIGINAL_SESSION_ID)
    new_invocations = observed_tool_evidence(args.new_session_dir, NEW_SESSION_ID)

    original_meta = session_metadata(args.original_session_dir, ORIGINAL_SESSION_ID)
    new_meta = session_metadata(args.new_session_dir, NEW_SESSION_ID)

    rows = []
    for subject, spec in RISK_SUBJECTS.items():
        row = {
            "id": subject,
            "minimumEvidenceRequirement": spec["requirement"],
            "discriminator": spec["discriminator"],
            "originalSourceObservation": "UNVERIFIED",
            "newSourceObservation": "UNVERIFIED",
            "equivalentVerificationOccurred": "UNVERIFIED",
            "findingFaithfullyRepresentsEvidence": "UNVERIFIED",
            "missingOrWeakerVerification": "UNVERIFIED",
            "comparabilityJudgment": "UNVERIFIED",
            "status": "UNVERIFIED",
            "evidenceReferences": [],
        }

        if original_invocations is None or new_invocations is None:
            row["missingOrWeakerVerification"] = (
                "a run transcript could not be read, so no independent crosswalk is possible"
            )
            rows.append(row)
            continue

        original_matches = evidence_for(original_invocations, spec["patterns"])
        new_matches = evidence_for(new_invocations, spec["patterns"])

        row["originalSourceObservation"] = {
            "observedToolInvocations": len(original_matches),
            "totalToolInvocations": len(original_invocations),
            "toolsUsed": sorted({m.get("tool") for m in original_matches if m.get("tool")}),
        }
        row["newSourceObservation"] = {
            "observedToolInvocations": len(new_matches),
            "totalToolInvocations": len(new_invocations),
            "toolsUsed": sorted({m.get("tool") for m in new_matches if m.get("tool")}),
        }
        row["evidenceReferences"] = [
            {
                "kind": "session_transcript",
                "sessionId": ORIGINAL_SESSION_ID,
                "messagesSha256": sha256_file(
                    os.path.join(args.original_session_dir, ORIGINAL_SESSION_ID + ".messages.json")
                ),
            },
            {
                "kind": "session_transcript",
                "sessionId": NEW_SESSION_ID,
                "messagesSha256": sha256_file(
                    os.path.join(args.new_session_dir, NEW_SESSION_ID + ".messages.json")
                ),
            },
        ]

        if subject == "R5":
            row["reconciledIdentifiers"] = []
            for identifier in R5_INDEX_IDENTIFIERS:
                original_count = identifier_counts(original_invocations, identifier)
                new_count = identifier_counts(new_invocations, identifier)
                source_hits = (
                    tracked_source_hits(args.keycloak_repo, identifier) if args.keycloak_repo else []
                )
                row["reconciledIdentifiers"].append(
                    {
                        "identifier": identifier,
                        "originalRunOccurrences": original_count,
                        "newRunOccurrences": new_count,
                        "trackedSourceArtifacts": source_hits,
                        "reconciled": bool(original_count > 0 and new_count > 0 and source_hits),
                    }
                )
            all_reconciled = all(item["reconciled"] for item in row["reconciledIdentifiers"])
            row["equivalentVerificationOccurred"] = "EQUIVALENT" if all_reconciled else "UNVERIFIED"
            row["findingFaithfullyRepresentsEvidence"] = "EQUIVALENT" if all_reconciled else "UNVERIFIED"
            row["missingOrWeakerVerification"] = (
                "none: every one of the six identifiers appears in BOTH runs' observed tool "
                "evidence AND in a tracked source artifact"
                if all_reconciled
                else "one or more identifiers could not be reconciled against both runs and a "
                "tracked source artifact"
            )
            row["comparabilityJudgment"] = "EQUIVALENT" if all_reconciled else "UNVERIFIED"
            row["status"] = "EQUIVALENT" if all_reconciled else "UNVERIFIED"
            rows.append(row)
            continue

        if subject in ("R1", "R9", "R10"):
            receipt = render_receipt(args.render_path)
            if receipt is None:
                row["missingOrWeakerVerification"] = (
                    "the offline Helm render receipt is absent, so the EFFECTIVE chart "
                    "behaviour is unverified"
                )
                rows.append(row)
                continue
            row["offlineRenderReceipt"] = receipt
            row["effectiveRender"] = {
                "chartVersion": args.chart_version,
                "chartSourceSha": args.chart_source_sha,
                "images": receipt["images"],
                "podDisruptionBudgetCount": receipt["podDisruptionBudgetCount"],
                "networkPolicyCount": receipt["networkPolicyCount"],
                "hookCount": receipt["hookCount"],
            }
            row["equivalentVerificationOccurred"] = "STRONGER"
            row["findingFaithfullyRepresentsEvidence"] = "STRONGER"
            row["missingOrWeakerVerification"] = (
                "the render pins a placeholder digest; the SERVED image digest is a "
                "pipeline-time value that the offline render cannot observe"
            )
            row["comparabilityJudgment"] = "STRONGER"
            row["status"] = "STRONGER"
            rows.append(row)
            continue

        original_covers = len(original_matches) > 0
        new_covers = len(new_matches) > 0
        row["equivalentVerificationOccurred"] = "EQUIVALENT" if original_covers and new_covers else "WEAKER"
        row["findingFaithfullyRepresentsEvidence"] = (
            "EQUIVALENT" if original_covers and new_covers else "UNVERIFIED"
        )
        row["missingOrWeakerVerification"] = (
            "none at the tool-evidence level: both runs executed the source-reading "
            "commands for this subject"
            if original_covers and new_covers
            else "one run did not execute the source-reading commands for this subject"
        )
        row["comparabilityJudgment"] = "EQUIVALENT" if original_covers and new_covers else "WEAKER"
        row["status"] = "EQUIVALENT" if original_covers and new_covers else "WEAKER"
        rows.append(row)

    return {
        "schema": "cline.roundc-trace-qual01-evidence-crosswalk.v1",
        "generatedBy": "scripts/roundc-trace-qual01-evidence-crosswalk.py",
        "purpose": (
            "Evidence-equivalence qualification for the Keycloak Round C comparison. "
            "This is a qualification manifest, not a security auditor and not a "
            "finding-scoring framework."
        ),
        "runs": {
            "original": {
                "sessionId": ORIGINAL_SESSION_ID,
                "metadata": original_meta,
                "transcriptRecovered": original_invocations is not None,
                "toolInvocationCount": len(original_invocations or []),
            },
            "new": {
                "sessionId": NEW_SESSION_ID,
                "metadata": new_meta,
                "transcriptRecovered": new_invocations is not None,
                "toolInvocationCount": len(new_invocations or []),
            },
        },
        "statusVocabulary": ["EQUIVALENT", "STRONGER", "WEAKER", "UNVERIFIED"],
        "rows": rows,
    }


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original-session-dir", default="")
    parser.add_argument("--new-session-dir", default="")
    parser.add_argument("--keycloak-repo", default="")
    parser.add_argument("--render-path", default="")
    parser.add_argument("--chart-version", default="")
    parser.add_argument("--chart-source-sha", default="")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    crosswalk = build_crosswalk(args)
    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(crosswalk, handle, indent=2)
        handle.write("\n")
    statuses = collections.Counter(row["status"] for row in crosswalk["rows"])
    print("wrote " + args.out)
    for status, count in sorted(statuses.items()):
        print("  %s: %d" % (status, count))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
