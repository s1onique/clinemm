# 02 — Activation state and the integration RED (G1.3, G5)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
**Classification:** STRUCTURAL (source-level and executable-test evidence)

## G1.3 — The measured activation state at ENTRY_HEAD

Search of the production VS Code source tree (the installed extension's own
tree) at ENTRY_HEAD `7490a12a58fbec73800f97c4b2346bde6b394725`:

```
$ grep -rn 'adjudication' apps/vscode/src --include='*.ts'
apps/vscode/src/sdk/__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts:45
apps/vscode/src/sdk/__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts:407
```

Both hits are the unrelated English word "adjudication" in a comment that
belongs to a DIFFERENT ACT. `apps/vscode/proto` has zero hits.

| Field | State |
|---|---|
| `adjudication.enabled` | **NOT_SUPPLIED** |
| `adjudication.vocabulary` | **NOT_SUPPLIED** |
| `adjudication.revisionResolver` | **NOT_SUPPLIED** |
| `adjudication.secretProvider` | **NOT_SUPPLIED** |

The SDK side was ALREADY fully wired (`CoreSessionConfig.adjudication` existed;
the registry, the compaction seam, the publication instruction and the
acquisition hook were all installed by `LocalRuntimeHost.startResolvedSession`).
The MISSING link was exclusively on the VS Code PRODUCER side.

## G5 — The integration RED

**Test file:** `apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.test.ts`
(5 witnesses, base vitest config)

**Runtime-chain file:** `apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.runtime-chain.c24-c-bridge.test.ts`
(13 witnesses, dedicated `vitest.config.adjudication-activation01.ts` config)

### RED acceptance — the missing-wiring defect WAS reproduced

The RED was reproduced by ABLATION: the producer changes were stashed, leaving
the ENTRY_HEAD producer in place, and the positive activation witness was
re-run against it.

Command:

```bash
cd apps/vscode
bunx vitest run --config vitest.config.ts \
  src/sdk/__tests__/adjudication-vscode-activation01.test.ts
```

Observed result (exit code 1), captured verbatim in
`verification/red-ablation-entry-head.txt`:

```
 ❯ src/sdk/__tests__/adjudication-vscode-activation01.test.ts (5 tests | 2 failed)
   ✓ does NOT supply an adjudication contract for an ordinary task
   ✓ does not change the provider-visible system prompt for an ordinary task
   × carries the authorized contract into the produced CoreSessionConfig
   × supplies a revision resolver that fails closed outside the workspace
   ✓ binds the contract to exactly ONE session and leaves an unrelated task off

 FAIL  ... > RED-2 ... > carries the authorized contract into the produced CoreSessionConfig
AssertionError: expected undefined to be defined
 ❯ src/sdk/__tests__/adjudication-vscode-activation01.test.ts:227:32
    227|     expect(config.adjudication).toBeDefined()

 FAIL  ... > RED-2 ... > supplies a revision resolver that fails closed outside the workspace
AssertionError: expected undefined to be defined
 ❯ src/sdk/__tests__/adjudication-vscode-activation01.test.ts:240:21
    240|     expect(resolver).toBeDefined()

 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

**This is the decisive RED observation.** Two facts are established at once:

1. **The positive activation path FAILS against the existing production
   configuration producer** — `config.adjudication` is `undefined` even when a
   contract has been explicitly authorized. `HALT_RED_NOT_REPRODUCED` does
   **NOT** apply; the anticipated missing-wiring defect is real and exactly
   located.

2. **The default-off conservation control ALREADY PASSED against the
   ENTRY_HEAD producer** — the two RED-1 witnesses passed with the producer
   changes stashed. The default-off behaviour was therefore already correct
   and did NOT need to be introduced; it only needed to be PRESERVED. This is
   exactly the conservation control G5/RED-1 asks for.

`PRODUCTION_SEAM`: `apps/vscode/src/sdk/cline-session-factory.ts :: buildSessionConfig()`
`FAILING_ASSERTION`: `expect(config.adjudication).toBeDefined()` (RED-2)

### Necessity / ablation (G7)

| Step | State | Observation |
|---|---|---|
| A — existing VS Code producer (ENTRY_HEAD) | RED | RED-2 fails: `expected undefined to be defined` |
| B — bounded activation adapter | GREEN | RED-2 passes: `config.adjudication.enabled === true` |
| C — remove only the activation adapter | RED | RED-2 fails again (the ablation run above IS step C) |

The ablation in step C is the stashed-producer run: only
`cline-session-factory.ts` and `sdk-task-start-coordinator.ts` were reverted;
the new adapter modules remained present but UNREFERENCED. RED-2 failed, so
the adapter is NECESSARY and not decorative.

### The GREEN witness counts

```
apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.test.ts
  (base vitest config)                                  5 tests
apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.runtime-chain.c24-c-bridge.test.ts
  (vitest.config.adjudication-activation01.ts)         13 tests
                                                     --------------------
  TOTAL ACT-owned witnesses                            18 tests
```
