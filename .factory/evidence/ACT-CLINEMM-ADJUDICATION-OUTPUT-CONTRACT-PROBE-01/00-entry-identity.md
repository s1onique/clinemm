# 00 — Entry identity, continuity and preservation

```text
ACT_ID:               ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01
ACT_CLASS:            Contract feasibility / executable prototype
ENTRY_HEAD (expected): 97c2659c8552a9b78ed87c56d2bbe7d31dc74900
ENTRY_HEAD (actual):   97c2659c8552a9b78ed87c56d2bbe7d31dc74900   (== expected)
ENTRY_BRANCH:         main
ENTRY_WORKTREE:       /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
ENTRY_STATUS:         clean apart from two UNRELATED untracked evidence
                      directories (preserved, not touched):
                        .factory/evidence/ACT-CLINEMM-MCP-SUPERVISION-V2-LIVE-QUAL01/
                        .factory/evidence/ACT-CLINEMM-ROUND-C-ADJUDICATION-CONVERGENCE-RECON-01/
PROTECTED_STASHES:    none (`git stash list` is empty)
PRODUCTION_BASELINE_HEAD: a493eff078ec5c8f2b6c874ad8f4a85009d1b64f
RED_ARTIFACT_HEAD:        d69cfb9befe957ec87a034050bb7b4c72f1a0851
EVIDENCE_COMMIT_HEAD:     97c2659c8552a9b78ed87c56d2bbe7d31dc74900 (entry)
```

## Worktrees (all preserved, none modified)

```text
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm          97c2659c8 [main]
/private/tmp/clinemm-stash-recovery-20261117                      8b76c9e3e [recovery/protected-stash-20261117] prunable
/private/tmp/worktree-bun.7ddCHQ                                  bbdccf8a2 (detached HEAD) prunable
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-action-first  38e726c45 [experiment/m31-action-first]
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-bounded      0366ea506 (detached HEAD)
```

No worktree was checked out, reset, pruned or written to. The two `prunable`
worktrees are pre-existing and were deliberately left alone: pruning them is
not this ACT's business and would destroy unrelated evidence.

## Unexpected tracked dirt

```text
HALT_UNEXPECTED_TRACKED_DIRT:  NOT TRIGGERED
```

`git status --short` reported only untracked directories at entry, and the
ACT's own added files. No tracked file was modified, staged or reverted
outside this ACT's own additions.

## Packaging metadata correction (G0.3)

The predecessor's artifact identities are reconciled ONCE, and the three
identities are kept DISTINCT:

| Identity | SHA | What it identifies |
|---|---|---|
| `PRODUCTION_BASELINE_HEAD` | `a493eff078ec5c8f2b6c874ad8f4a85009d1b64f` | the production source baseline (the containment commit that introduced `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false` and `MAX_CARRIED_OUTCOMES = 12`) |
| `RED_ARTIFACT_HEAD` | `d69cfb9befe957ec87a034050bb7b4c72f1a0851` | the test-artifact identity of the RED witness (`compaction.adjudication-continuity.red01.test.ts` + its dedicated vitest config) |
| `EVIDENCE_COMMIT_HEAD` | `97c2659c8552a9b78ed87c56d2bbe7d31dc74900` | the evidence-commit identity of the predecessor's evidence package and G2 halt record |

The correction applied here is the one the predecessor flagged: an evidence
file that labels an artifact with a source HEAD **predating that artifact's
creation** must distinguish the three identities above. This package uses
three separate labels and never presents a source HEAD as an artifact's own
creation commit.

No historical observation was overwritten. **No self-referential SHA is
written into a file committed by that same commit**: the final evidence
commit's SHA is recorded in the ACT board entry and in the operator report,
not inside `artifact-hashes.json`.

## Preservation of the predecessor's disposition (G0.2)

The predecessor's closed findings are carried forward as facts, not
hypotheses, and were NOT reinvestigated:

- M1 drops all thinking blocks for `agentic_summary`.
- Historical R3, R7 and R8 adjudications appeared only in thinking.
- Neither assistant text nor tool results contained those historical
  qualified verdicts.
- Raw thinking forwarding was rejected.
- The predecessor RED remains intentionally failing and isolated.
- No safe deployed adjudication-continuity repair exists.

**No historical recovery was attempted in this ACT.** The new contract is
explicitly future-facing: it governs what a FUTURE model publication may
carry, and it makes no claim about R3/R7/R8.

## The predecessor RED is byte-identical and still isolated

```text
FILE: sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.red01.test.ts
STATE: excluded from the default suite (sdk/packages/core/vitest.config.ts)
RUNNABLE ON DEMAND: bun run test:red:adjudication-continuity-red01
MODIFIED BY THIS ACT: NO
```

Verified by the executable gates in `08-executable-gates.md`: the RED still
FAILS when run on demand, and the default suite still EXCLUDES it.

## Production delta

```text
PRODUCTION DELTA vs ENTRY_HEAD: ZERO
```

The only shipped-source file this ACT adds is a `*.test.ts` probe and a
`scripts/` probe harness. No `src/` production module was changed. The
`git diff --stat HEAD -- sdk/` output for production paths is empty.
