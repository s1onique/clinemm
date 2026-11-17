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
