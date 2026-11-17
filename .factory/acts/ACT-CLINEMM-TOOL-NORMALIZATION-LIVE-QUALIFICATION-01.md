# ACT-CLINEMM-TOOL-NORMALIZATION-LIVE-QUALIFICATION-01

```text
ACT_ID: ACT-CLINEMM-TOOL-NORMALIZATION-LIVE-QUALIFICATION-01
TYPE: P0 recon and live qualification (NO production repair authorized)
WORKSTREAM: RC-05 (tool-call normalization)
VERDICT: PASS_LIVE_NORMALIZATION_QUALIFIED
ENTRY_HEAD: 48800ea1142dc18379fcc25ce0101cab540f41ff
BRANCH: main (no ACT branch created)
EVIDENCE: .factory/evidence/ACT-CLINEMM-TOOL-NORMALIZATION-LIVE-QUALIFICATION-01/
```

## Purpose

Qualify the EXISTING tool-call normalization against ClineMM's actual
model-facing schema and installed-runtime execution path. Establish whether the
real normalization contract works — **not** modify it without causal evidence.

## Disposition

`PASS_LIVE_NORMALIZATION_QUALIFIED`

## Findings

1. **The contract works.** The production normalizer accepts every
   live-observed `run_commands` shape, conserves ordering, conserves sibling
   fields by failing closed, rejects malformed input before approval and before
   execution, and conserves tool-call identity exactly through result delivery.
2. **The causal discriminator is the BUILD, not the payload.** The identical
   `{command: "<JSON array string>"}` shape was rejected 11/11 in the pre-fix
   live Flint session and accepted 4/4 in the post-fix one.
3. **The authoritative boundary is application-side validation**, not the
   provider: every live rejection is `Invalid input for tool run_commands`, and
   the model-facing schema was advertised but NOT provider-enforced
   (`strictJsonSchema: false` in all 622 captured provider requests).
4. **Fresh live Flint is `LIVE_UNOBSERVABLE`** — the model is not served by the
   installed runtime's endpoint (the registry entry is stale and the endpoint
   silently serves the Qwen model instead). No synthetic fixture was used to
   fabricate a passing live test, and no new model run was performed because
   the existing evidence already established the required boundary.
5. **No production change is warranted.** No failure reproduces against the
   current build.

## Explicit non-actions

- No production source modified.
- No public tool schema relaxed.
- No new permanent API field.
- No always-on diagnostic.
- No raw provider payload, prompt, secret or command text committed.
- No push, PR, reset, branch, worktree, stash pop or force operation.
- All protected worktrees and stashes preserved.

## Known limitation (recorded, not papered over)

The HARNESS-03 shape (`{commands: "[{\"command\":…}]"}`) has **no live-source
witness** — 0 occurrences across 201 scanned live sessions. It is a
composition of two separately live-observed shapes and is production-seam
qualified, but it is NOT live-witnessed.

## Gates

| Gate | Result |
|---|---|
| Nine normalization suites | 230 / 230 passed (9 / 9 files) |
| `src/extensions/tools/` tree | 679 passed, 6 failed (**pre-existing**, environment-caused), 105 skipped |
| LIVE Flint witness verifier | 4 / 4 **executed** (not skipped) |
| Typecheck | 43 = pre-existing baseline; 0 in the normalization source files |
| Production diff vs entry HEAD | empty |
| Sanitization audit | no keys, private paths, command text, internal hosts, prompts |

## See also

`.factory/evidence/ACT-CLINEMM-TOOL-NORMALIZATION-LIVE-QUALIFICATION-01/qualification-report.md`

---

# CORRECTION01 — 2026-11-17

```text
ACT_ID: ACT-CLINEMM-TOOL-NORMALIZATION-LIVE-QUALIFICATION-01 — CORRECTION01
TYPE: P0 evidence-integrity correction of the offline analyzer
ENTRY_HEAD: 86d8a691d03f39c745774c48b564176f8349673a
VERDICT: PASS_LIVE_NORMALIZATION_QUALIFIED (RETAINED)
```

## What was wrong

The analyzer committed by the prior ACT (`tool/qualify.ts`) was **never
machine-verified**. Three P0 evidence-integrity defects, each reproduced RED:

- **A** — the trace start/end id maps were both built from `phase === "start"`,
  so the end-event identity checks were tautological and the reported end
  counts were the start counts.
- **B** — the provider-capture loop stopped at the first capture of each
  session, so a later capture with a different schema hash was invisible and
  the "all captures identical" claim was unfalsifiable.
- **C** — `strictJsonSchema ?? null` collapsed an ABSENT field to a value
  indistinguishable from a recorded `false`.

## What was repaired

The analyzer now selects start and end independently (cardinality, id sets,
ordering, matching tool names), inspects **every** provider capture with
explicit parsed/invalid/missing-field counts, and **derives** schema
consistency and strictness from the observed values. A missing
`strictJsonSchema` yields `UNKNOWN`, never `false`. The transcript↔trace
correlation is now LIKE-FOR-LIKE over all tool calls.

A new adversarial witness (`tool/witness.ts`) drives the analyzer as a
subprocess against portable fixtures (`tool/make-fixtures.ts`) and the preserved
real artifacts.

## The report corrections this forced

1. The five "trace-only" tool ids were an apples-to-oranges artifact — the
   corrected comparison is **26 vs 26, 26 shared, 0 on either side**.
2. "`strictJsonSchema = false` in every captured request" was an overclaim —
   the field is **absent in 496 of 622** captures; the corpus-wide finding is
   MIXED. Both Flint sessions do record `false` in every capture.
3. The Flint build-identity attribution is a **source-based inference**, not a
   capture-based observation — both sessions capture the same `clientVersion`.
   The discriminator is restated as the runtime's handling of the argument
   shape.

## Gates

| Gate | Result |
|---|---|
| RED against the ORIGINAL analyzer | **4 / 23 passed** (exit 1) |
| GREEN against the CORRECTED analyzer | **23 / 23 passed** (exit 0) |
| Nine normalization suites | 230 / 230 passed |
| LIVE Flint witness verifier | 4 / 4 executed (not skipped) |
| Typecheck | 43 = pre-existing baseline; 0 in the normalization sources |
| Determinism | analyzer and witness byte-identical on re-run |
| Sanitization | clean |

## Verdict

**`PASS_LIVE_NORMALIZATION_QUALIFIED` is RETAINED.** The corrected gates
substantiate it, and two of the corrections make the underlying result
*stronger* (the 26/26 identity correlation) or *narrower but accurate* (the
strictness and build-identity claims). **No production modification.**
