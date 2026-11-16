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

# ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-2).
#
# Helm designates a hook with the DISTINCT `helm.sh/hook` annotation. The
# `helm.sh/hook-weight` annotation only ORDERS hooks that already exist; it
# never makes a resource a hook. The two must therefore never be counted with
# the same pattern.
#
# `HOOK_ANNOTATION_RE` matches the `helm.sh/hook` KEY only: the key may be
# quoted (Helm renders annotations as `"helm.sh/hook": <value>`), it must be
# followed by a value separator, and it must NOT be followed by a `-` (which
# would make it `helm.sh/hook-weight`).
HOOK_ANNOTATION_RE = re.compile(r"""["']?helm\.sh/hook(?![\w-])["']?\s*:""")
HOOK_WEIGHT_RE = re.compile(r"""["']?helm\.sh/hook-weight(?![\w-])["']?\s*:""")

# An all-zero digest is the PLACEHOLDER digest used by the offline render.
# It proves the chart's digest-pinning FORM, never the serving image.
PLACEHOLDER_DIGEST_RE = re.compile(r"sha256:0{64}(?![0-9a-f])")

# The chart's profiler-watcher resources are named `keycloak-profiler-watcher`
# (and its lease/evidence siblings). Their presence in a render is what
# evidences the watcher's rendered semantics.
WATCHER_RESOURCE_RE = re.compile(r"^\s*name:\s*\S*profiler-watcher\S*\s*$", re.MULTILINE)



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

    This is the transcript's tool INVOCATIONS **CORRELATED WITH THEIR
    RESULTS** — the commands the model actually issued AND what those
    commands actually returned.

    ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-1). The previous
    implementation read ONLY the `tool_use` INPUTS. A command that merely
    MENTIONED a risk keyword — `timeout`, `mvn`, `password` — was counted as
    evidence even when it FAILED, returned nothing relevant, or was never
    executed at all. That made the crosswalk a keyword classifier, not an
    evidence qualifier.

    A tool invocation is evidence only when ALL of the following hold:

      1. it has a matching `tool_result` (the call was actually executed),
      2. that result did NOT fail (`is_error` is not set), and
      3. the result's OBSERVED OUTPUT carries the subject's evidence.

    The final model prose is never treated as a substitute for this.
    """
    messages = load_json(os.path.join(session_dir, session_id + ".messages.json"))
    if messages is None:
        return None
    if isinstance(messages, dict):
        messages = messages.get("messages", [])
    invocations = []
    results_by_call_id = {}
    for index, message in enumerate(messages):
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "tool_use":
                invocations.append(
                    {
                        "messageIndex": index,
                        "tool": part.get("name"),
                        "input": part.get("input"),
                        "callId": part.get("id"),
                    }
                )
            elif part.get("type") == "tool_result":
                call_id = part.get("tool_use_id")
                if call_id:
                    results_by_call_id[call_id] = {
                        "isError": bool(part.get("is_error")),
                        "output": flatten_tool_result_output(part.get("content")),
                    }
    # Correlate each invocation with its OWN result.
    for invocation in invocations:
        result = results_by_call_id.get(invocation.get("callId"))
        invocation["result"] = result
        invocation["executed"] = result is not None
        invocation["failed"] = bool(result.get("isError")) if result else True
        invocation["output"] = result.get("output", "") if result else ""
    return invocations


def flatten_tool_result_output(content) -> str:
    """The OBSERVED text of a tool_result, whatever shape it carries.

    The transcript stores a tool_result's content either as a plain string or
    as a list of `{query, result}` blocks. Both shapes are flattened to the
    observed text so the evidence check sees what the command actually
    produced.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                for key in ("result", "output", "text", "content"):
                    value = block.get(key)
                    if isinstance(value, str):
                        parts.append(value)
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts)
    return str(content)


def final_report_text(messages) -> str:
    """The run's FINAL assistant report text.

    The final report is the finding the run PUBLISHED. For the R5
    reconciliation it must be compared against the source-backed
    identifiers — a command that mentions an identifier proves the run
    LOOKED at it, not that the report states it.

    ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-1).
    """
    if not isinstance(messages, list):
        return ""
    latest = ""
    for message in messages:
        if message.get("role") != "assistant":
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    latest = text
    return latest


def load_messages(session_dir: str, session_id: str):
    """The raw transcript messages, or None when they cannot be read."""
    messages = load_json(os.path.join(session_dir, session_id + ".messages.json"))
    if messages is None:
        return None
    if isinstance(messages, dict):
        messages = messages.get("messages", [])
    return messages



def evidence_for(invocations, patterns):
    """The invocations whose OBSERVED RESULT carries the subject's evidence.

    ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-1). The previous
    implementation matched the subject's patterns against the invocation's
    INPUT alone. That classified a FAILED command, an irrelevant command and
    a never-executed command as evidence.

    An invocation is evidence only when:

      - it was actually EXECUTED (a `tool_result` exists for it),
      - that result did not FAIL, and
      - the OBSERVED OUTPUT matches one of the subject's patterns.

    The output is what the investigation actually observed. The input is only
    the question that was asked.
    """
    compiled = [re.compile(pattern, re.IGNORECASE) for pattern in patterns]
    matched = []
    for invocation in invocations:
        if not invocation.get("executed"):
            continue
        if invocation.get("failed"):
            continue
        output = invocation.get("output") or ""
        if not output.strip():
            continue
        if any(pattern.search(output) for pattern in compiled):
            matched.append(invocation)
    return matched


def identifier_counts(invocations, identifier: str) -> int:
    """The number of EXECUTED, SUCCESSFUL invocations whose OUTPUT carried the
    identifier.

    ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-1). The count used to
    be taken from the invocation INPUT, which proves only that the model
    TYPED the identifier.
    """
    count = 0
    for invocation in invocations:
        if not invocation.get("executed") or invocation.get("failed"):
            continue
        if identifier in (invocation.get("output") or ""):
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


def count_helm_hooks(text: str) -> int:
    """The number of REAL Helm hooks in a rendered manifest.

    ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-2). The previous
    implementation counted `re.findall(r"helm\\.sh/hook", text)`, which also
    matches `helm.sh/hook-weight`. Helm designates a hook with the DISTINCT
    `helm.sh/hook` annotation; `helm.sh/hook-weight` only orders hooks that
    already exist and never makes a resource a hook.

    The minimal counterexample: a ConfigMap whose ONLY annotation is
    `helm.sh/hook-weight: "5"` has ZERO hooks, not one.
    """
    return len(HOOK_ANNOTATION_RE.findall(text))


def count_hook_weights(text: str) -> int:
    """The number of `helm.sh/hook-weight` annotations.

    Reported SEPARATELY from the hook count so the two are never conflated.
    """
    return len(HOOK_WEIGHT_RE.findall(text))


def render_receipt_from_text(text: str, values_files=None, production_values_applied=False):
    """The offline Helm render receipt, computed from the render TEXT.

    ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-2). The receipt now
    distinguishes the real hook count from the hook-weight count, records the
    production-values provenance, and flags a placeholder digest so the
    placeholder render can never be mistaken for the no-image-override render.
    """
    images = sorted(set(re.findall(r"image:\s*\"?([^\s\"']+)", text)))
    kinds = collections.Counter(re.findall(r"^kind:\s*(\S+)", text, re.MULTILINE))
    # The chart's profiler-watcher resources are named with a `watcher`
    # marker. Their presence in the render is what evidences the watcher's
    # rendered semantics; a render without them establishes nothing about
    # the watcher.
    watcher_rendered = bool(WATCHER_RESOURCE_RE.search(text))
    return {
        "renderBytes": len(text.encode("utf-8")),
        "images": images,
        "kinds": dict(sorted(kinds.items())),
        "podDisruptionBudgetCount": kinds.get("PodDisruptionBudget", 0),
        "networkPolicyCount": kinds.get("NetworkPolicy", 0),
        # The REAL hook count — `helm.sh/hook`, never `helm.sh/hook-weight`.
        "hookCount": count_helm_hooks(text),
        # The hook-WEIGHT count, reported separately and never added in.
        "hookWeightCount": count_hook_weights(text),
        "securityContextCount": len(re.findall(r"securityContext", text)),
        # Whether the chart's profiler-watcher resources were rendered.
        "watcherRendered": watcher_rendered,
        # The provenance of the render.
        "valuesFiles": list(values_files or []),
        "productionValuesApplied": bool(production_values_applied),
        # Whether the render pinned an all-zero PLACEHOLDER digest. A
        # placeholder render proves the chart's digest-pinning FORM, never
        # the serving image, and it is NOT the no-image-override render.
        "placeholderDigest": any(PLACEHOLDER_DIGEST_RE.search(image) for image in images),
        # Whether the render applied the CI image overrides at all. The
        # no-image-override render resolves the chart's DEFAULT image and is
        # the R1 manual-upgrade failure mechanism.
        "imageOverridesApplied": any(
            PLACEHOLDER_DIGEST_RE.search(image) or not image.startswith("quay.io/")
            for image in images
        ),
    }


def render_receipt(render_path: str, values_files=None, production_values_applied=False):
    """The offline Helm render receipt."""
    if not render_path or not os.path.exists(render_path):
        return None
    try:
        with open(render_path, "r", encoding="utf-8") as handle:
            text = handle.read()
    except OSError:
        return None
    receipt = render_receipt_from_text(
        text,
        values_files=values_files,
        production_values_applied=production_values_applied,
    )
    receipt["renderSha256"] = sha256_file(render_path)
    receipt["renderPath"] = render_path
    return receipt



def render_semantics(subject: str, receipt: dict, args) -> dict:
    """Whether the render satisfies the subject's EXACT semantic requirement.

    ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-1, P0-2).

    The previous implementation awarded STRONGER whenever a render file
    existed. This function requires the render to carry the specific
    SEMANTIC evidence the subject demands:

      R1  — a resolved image reference, the PRODUCTION values applied, and
            the NO-IMAGE-OVERRIDE render captured (the manual-upgrade
            failure mechanism). A placeholder-digest render alone proves
            the chart's digest-pinning FORM and is NOT sufficient.
      R9  — the effective security defaults observed AND the
            NetworkPolicy/PDB coverage counted.
      R10 — the REAL hook count observed. The hook-WEIGHT count is never a
            substitute: `helm.sh/hook-weight` does not designate a hook.
    """
    satisfied = False
    caveat = ""
    if subject == "R1":
        has_image = bool(receipt.get("images"))
        production_values = bool(receipt.get("productionValuesApplied"))
        no_override = bool(args.no_image_override_render_path)
        satisfied = has_image and production_values and no_override
        caveat = (
            "none: the render resolved the image, applied the PRODUCTION values "
            "and captured the no-image-override render (the manual-upgrade "
            "failure mechanism)"
            if satisfied
            else "the render is missing exact semantic evidence: "
            + ", ".join(
                part
                for part, ok in (
                    ("a resolved image reference", has_image),
                    ("the production values applied", production_values),
                    ("the no-image-override render", no_override),
                )
                if not ok
            )
        )
    elif subject == "R9":
        has_defaults = receipt.get("securityContextCount", 0) > 0
        coverage_counted = (
            "podDisruptionBudgetCount" in receipt and "networkPolicyCount" in receipt
        )
        satisfied = has_defaults and coverage_counted
        caveat = (
            "none: the effective chart security defaults and the "
            "NetworkPolicy/PDB coverage were both observed"
            if satisfied
            else "the render is missing exact semantic evidence: "
            + ", ".join(
                part
                for part, ok in (
                    ("the effective security defaults", has_defaults),
                    ("the NetworkPolicy/PDB coverage", coverage_counted),
                )
                if not ok
            )
        )
    elif subject == "R10":
        # The REAL hook count must be OBSERVED. A render that merely exists
        # proves nothing about hooks: the chart may carry only
        # `helm.sh/hook-weight`, which designates NO hook at all.
        #
        # The watcher/rollback semantics additionally require the watcher
        # resources to have actually been rendered. The chart renders the
        # watcher ONLY in the `dev` environment (a load-bearing security
        # boundary), so the prod render legitimately contains no watcher
        # and cannot establish these semantics on its own.
        hooks_observed = "hookCount" in receipt
        real_hooks = receipt.get("hookCount", 0)
        hook_weights = receipt.get("hookWeightCount", 0)
        # The watcher semantics are evidenced by the chart's watcher
        # resources having been rendered. The watcher is rendered ONLY in
        # the `dev` environment, so the watcher render is a DISTINCT
        # artifact and is consulted here.
        watcher_receipt = (
            render_receipt(args.watcher_render_path)
            if getattr(args, "watcher_render_path", "")
            else None
        )
        watcher_rendered = bool(
            (watcher_receipt or {}).get("watcherRendered")
            or receipt.get("watcherRendered")
        )
        satisfied = hooks_observed and watcher_rendered
        caveat = (
            "none: the REAL hook count was observed (helm.sh/hook, never "
            "helm.sh/hook-weight) and the watcher resources were rendered; the "
            "observed hook count is "
            + str(real_hooks)
            + " and the hook-weight count is "
            + str(hook_weights)
            if satisfied
            else "the render is missing exact semantic evidence: "
            + ", ".join(
                part
                for part, ok in (
                    ("the real hook count", hooks_observed),
                    ("the rendered watcher resources", watcher_rendered),
                )
                if not ok
            )
            + (
                "; the chart renders the profiler watcher ONLY in the `dev` "
                "environment, so a prod render cannot establish the watcher "
                "semantics and the dev watcher render must be supplied"
                if hooks_observed and not watcher_rendered
                else ""
            )
        )
    return {"satisfied": satisfied, "caveat": caveat}


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
            # ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-1). The R5
            # discriminator must reconcile the FINAL REPORTS of both runs
            # against the source-backed identifiers. The previous
            # implementation only counted the identifiers in the command
            # INPUTS, which proves the model TYPED the name, not that the
            # report states it.
            original_report = final_report_text(
                load_messages(args.original_session_dir, ORIGINAL_SESSION_ID)
            )
            new_report = final_report_text(
                load_messages(args.new_session_dir, NEW_SESSION_ID)
            )
            row["finalReport"] = {
                "originalReportSha256": hashlib.sha256(
                    original_report.encode("utf-8")
                ).hexdigest(),
                "originalReportChars": len(original_report),
                "newReportSha256": hashlib.sha256(new_report.encode("utf-8")).hexdigest(),
                "newReportChars": len(new_report),
                "originalReportRecovered": bool(original_report.strip()),
                "newReportRecovered": bool(new_report.strip()),
            }
            row["reconciledIdentifiers"] = []
            for identifier in R5_INDEX_IDENTIFIERS:
                original_count = identifier_counts(original_invocations, identifier)
                new_count = identifier_counts(new_invocations, identifier)
                source_hits = (
                    tracked_source_hits(args.keycloak_repo, identifier) if args.keycloak_repo else []
                )
                in_original_report = identifier in original_report
                in_new_report = identifier in new_report
                row["reconciledIdentifiers"].append(
                    {
                        "identifier": identifier,
                        "originalRunObservedOccurrences": original_count,
                        "newRunObservedOccurrences": new_count,
                        "originalFinalReportStatesIdentifier": in_original_report,
                        "newFinalReportStatesIdentifier": in_new_report,
                        "trackedSourceArtifacts": source_hits,
                        "reconciled": bool(
                            original_count > 0
                            and new_count > 0
                            and source_hits
                            and in_original_report
                            and in_new_report
                        ),
                    }
                )
            all_reconciled = all(item["reconciled"] for item in row["reconciledIdentifiers"])
            unreconciled = [
                item["identifier"]
                for item in row["reconciledIdentifiers"]
                if not item["reconciled"]
            ]
            row["equivalentVerificationOccurred"] = "EQUIVALENT" if all_reconciled else "WEAKER"
            row["findingFaithfullyRepresentsEvidence"] = (
                "EQUIVALENT" if all_reconciled else "WEAKER"
            )
            row["missingOrWeakerVerification"] = (
                "none: every one of the six identifiers was OBSERVED in a successful "
                "tool result in BOTH runs, is stated in BOTH runs' final reports, and "
                "reconciles against a tracked source artifact"
                if all_reconciled
                else "these identifiers did not reconcile against both runs' observed "
                "tool results, both runs' final reports and a tracked source artifact: "
                + ", ".join(unreconciled)
            )
            row["comparabilityJudgment"] = "EQUIVALENT" if all_reconciled else "WEAKER"
            row["status"] = "EQUIVALENT" if all_reconciled else "WEAKER"
            rows.append(row)
            continue

        if subject in ("R1", "R9", "R10"):
            # ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-1, P0-2).
            #
            # The previous implementation awarded STRONGER to every render
            # row the moment a render FILE existed. That established
            # reproducibility of the algorithm, not equivalence of the
            # investigation.
            #
            # A render row is now awarded STRONGER only when the render
            # satisfies the subject's EXACT semantic requirements:
            #
            #   R1  — a resolved image reference, the production values
            #         applied, AND the no-image-override render captured
            #         (the manual-upgrade failure mechanism);
            #   R9  — the effective security defaults observed AND the
            #         NetworkPolicy/PDB coverage counted;
            #   R10 — the REAL hook count observed (never the hook-weight
            #         count) AND the watcher/rollback semantics observed.
            #
            # Anything less is WEAKER or UNVERIFIED, never STRONGER.
            receipt = render_receipt(
                args.render_path,
                values_files=args.values_files,
                production_values_applied=args.production_values_applied,
            )
            if receipt is None:
                row["missingOrWeakerVerification"] = (
                    "the offline Helm render receipt is absent, so the EFFECTIVE chart "
                    "behaviour is unverified"
                )
                row["status"] = "UNVERIFIED"
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
                "hookWeightCount": receipt["hookWeightCount"],
                "valuesFiles": receipt["valuesFiles"],
                "productionValuesApplied": receipt["productionValuesApplied"],
                "placeholderDigest": receipt["placeholderDigest"],
                "imageOverridesApplied": receipt["imageOverridesApplied"],
            }

            semantic = render_semantics(subject, receipt, args)
            row["exactSemanticEvidence"] = semantic
            if semantic["satisfied"]:
                row["equivalentVerificationOccurred"] = "STRONGER"
                row["findingFaithfullyRepresentsEvidence"] = "STRONGER"
                row["missingOrWeakerVerification"] = semantic["caveat"]
                row["comparabilityJudgment"] = "STRONGER"
                row["status"] = "STRONGER"
            else:
                row["equivalentVerificationOccurred"] = "WEAKER"
                row["findingFaithfullyRepresentsEvidence"] = "UNVERIFIED"
                row["missingOrWeakerVerification"] = semantic["caveat"]
                row["comparabilityJudgment"] = "WEAKER"
                row["status"] = "WEAKER"
            rows.append(row)
            continue

        original_covers = len(original_matches) > 0
        new_covers = len(new_matches) > 0
        row["equivalentVerificationOccurred"] = "EQUIVALENT" if original_covers and new_covers else "WEAKER"
        row["findingFaithfullyRepresentsEvidence"] = (
            "EQUIVALENT" if original_covers and new_covers else "UNVERIFIED"
        )
        row["missingOrWeakerVerification"] = (
            "none at the tool-evidence level: both runs' SUCCESSFUL tool results "
            "carried this subject's evidence"
            if original_covers and new_covers
            else "one run did not produce a successful tool result carrying this "
            "subject's evidence"
        )
        row["comparabilityJudgment"] = "EQUIVALENT" if original_covers and new_covers else "WEAKER"
        row["status"] = "EQUIVALENT" if original_covers and new_covers else "WEAKER"
        rows.append(row)

    return {
        "schema": "cline.roundc-trace-qual01-evidence-crosswalk.v2",
        "generatedBy": "scripts/roundc-trace-qual01-evidence-crosswalk.py",
        "purpose": (
            "Evidence-equivalence qualification for the Keycloak Round C comparison. "
            "This is a qualification manifest, not a security auditor and not a "
            "finding-scoring framework."
        ),
        "evidenceSemantics": {
            "toolEvidence": (
                "a tool invocation is evidence only when it was EXECUTED, its result "
                "did not FAIL, and its OBSERVED OUTPUT carries the subject's evidence; "
                "the invocation's INPUT alone is never evidence"
            ),
            "r5Discriminator": (
                "each of the six identifiers must be OBSERVED in a successful tool "
                "result in BOTH runs, be STATED in BOTH runs' final reports, and "
                "reconcile against a tracked source artifact"
            ),
            "renderRows": (
                "STRONGER is awarded only when the render carries the subject's EXACT "
                "semantic evidence; the mere existence of a render file is never "
                "sufficient"
            ),
            "helmHooks": (
                "the hook count counts the DISTINCT helm.sh/hook annotation only; "
                "helm.sh/hook-weight orders hooks and never designates one, and the "
                "two counts are reported separately"
            ),
        },
        "renders": {
            "placeholderDigestRender": (
                render_receipt(
                    args.render_path,
                    values_files=args.values_files,
                    production_values_applied=args.production_values_applied,
                )
                if getattr(args, "render_path", "")
                else None
            ),
            "noImageOverrideRender": (
                render_receipt(
                    args.no_image_override_render_path,
                    values_files=args.values_files,
                    production_values_applied=args.production_values_applied,
                )
                if getattr(args, "no_image_override_render_path", "")
                else None
            ),
            "watcherRender": (
                render_receipt(args.watcher_render_path)
                if getattr(args, "watcher_render_path", "")
                else None
            ),
        },
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
    parser.add_argument(
        "--no-image-override-render-path",
        default="",
        help=(
            "The render produced WITHOUT the CI image overrides. It resolves the "
            "chart's DEFAULT image and is the R1 manual-upgrade failure mechanism. "
            "It is a DISTINCT artifact from the placeholder-digest render."
        ),
    )
    parser.add_argument(
        "--watcher-render-path",
        default="",
        help=(
            "The render that INCLUDES the chart's profiler-watcher resources. "
            "The watcher is rendered ONLY in the `dev` environment, so this is a "
            "DISTINCT artifact from the production render."
        ),
    )
    parser.add_argument(
        "--values-file",
        action="append",
        default=[],
        help="A values file applied to the render. Repeatable.",
    )
    parser.add_argument(
        "--production-values-applied",
        action="store_true",
        help="The render applied the PRODUCTION values file (e.g. values-prod.yaml).",
    )
    parser.add_argument("--chart-version", default="")
    parser.add_argument("--chart-source-sha", default="")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    args.values_files = list(args.values_file)
    args.production_values_applied = bool(args.production_values_applied)
    args.no_image_override_render_path = args.no_image_override_render_path or ""
    args.watcher_render_path = args.watcher_render_path or ""

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
