# 14 — CORRECTION02: the host-private adjudication records vs. the webview boundary

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION02
**Review verdict closed:** `HALT_ADJUDICATION_SECRET_WEBVIEW_EXPOSURE`
**Classification:** STRUCTURAL

## VERDICT

```
PASS_SECURITY_BOUNDARY_STRUCTURAL
```

The reviewer's P0 is **confirmed by independent inspection**, reproduced with
an executable RED against the REAL production paths, and closed.

## The P0 — host-private adjudication secrets reach the webview state

### The production path (independently verified)

The reviewer's chain was re-derived from the source, not assumed:

```text
SECRETS_KEYS                                  apps/vscode/src/shared/storage/state-keys.ts:403
  -> SecretKeys = Array.from(SECRETS_KEYS)    apps/vscode/src/shared/storage/state-keys.ts:527
  -> StateManager.constructApiConfigurationFromCache()
       Object.fromEntries(SecretKeys.map((key) => [key, this.getSecret(key)]))
                                              apps/vscode/src/core/storage/StateManager.ts:874
  -> getApiConfiguration()                    apps/vscode/src/core/storage/StateManager.ts:490
  -> getStateToPostToWebview()
       const apiConfiguration = stateManager.getApiConfiguration()
       ... apiConfiguration,
                                              apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:101,268
  -> ExtensionState.apiConfiguration           apps/vscode/src/shared/ExtensionMessage.ts:108
  -> getLatestState()  JSON.stringify(state)  apps/vscode/src/core/controller/state/getLatestState.ts:16
```

The two committed keys are:

- `adjudicationSessionSecrets` — the per-session evidence-handle **secret**,
  whose own documentation states it is "never written to ... a prompt" and
  never leaves the trusted store;
- `adjudicationSessionVocabularies` — the per-session **authorized**
  vocabulary, a host-authority authorization record.

Both are in `SECRETS_KEYS`, and `SECRETS_KEYS` is ALSO the enumeration used to
build the webview-facing API configuration. So a key added to the trusted
store for a host-private purpose silently becomes webview-visible.

This is a **structural production-path finding**, not evidence of an actual
credential exfiltration: the webview is a separate execution context, and a
value that crosses into it is no longer host-private regardless of what the
UI renders.

### A SECOND, deeper exposure the review surfaced

While closing the read boundary, a **write** boundary was found that the
review did not list:

```text
webview  --(UpdateSettingsRequest.apiConfiguration)-->  updateSettings()
                                                            -> stateManager.setApiConfiguration(...)
```

## The executable RED

`apps/vscode/src/core/storage/__tests__/adjudication-secret-webview-exposure.correction02.test.ts`

It drives the **REAL** `StateManager.getApiConfiguration()` and the REAL
state projection, with synthetic, recognizable values, so a leak is
detectable by CONTENT and not only by key name.

The RED payload, captured verbatim:

```json
{"apiKey":"SYNTHETIC-PROVIDER-KEY-MUST-STILL-WORK",
 "adjudicationSessionSecrets":"SYNTHETIC-CORRECTION02-SECRET-DO-NOT-LEAK",
 "adjudicationSessionVocabularies":"SYNTHETIC-CORRECTION02-VOCAB-DO-NOT-LEAK",
 "sapAiCoreUseOrchestrationMode":true,"ocaMode":"internal",
 "planModeApiProvider":"openrouter","actModeApiProvider":"openrouter"}
```

Both host-private records are present, verbatim, in the object that is
published to the webview.

### RED reproducibility (executed)

Both boundaries were reverted to their pre-correction form and the suite
re-run:

```text
REVERTED constructApiConfigurationFromCache to SecretKeys
REVERTED setApiConfiguration to the unbounded isSecretKey branch
Tests  4 failed | 5 passed (9)
```

The 4 failures were exactly the boundary witnesses:

- GATE 1 — the adjudication evidence secret is absent from the API
  configuration
- GATE 1 — the adjudication vocabulary is absent from the API configuration
- GATE 3 — the serialized payload contains no adjudication key at all
- GATE 4 — a webview-supplied write to the adjudication records is REFUSED

The 5 that passed were the **controls**, which must pass in both states:
the provider credential is still exported, the trusted host can still read
the records, the trusted host can still write the records, the provider
credential is still writable, and the GATE 3 aggregate content assertion.

The correction was then restored and the suite returned to **9/9 PASS**.

## The correction

### A CLOSED export list, not a per-key filter

`apps/vscode/src/shared/storage/state-keys.ts` gains a second, explicit
classification:

```ts
const HOST_PRIVATE_SECRET_KEYS = [
    "adjudicationSessionSecrets",
    "adjudicationSessionVocabularies",
] as const satisfies readonly (typeof SECRETS_KEYS)[number][]

export const isHostPrivateSecretKey = (key: string): key is HostPrivateSecretKey =>
    HostPrivateSecretKeySet.has(key)

export const ExportedSecretKeys = SecretKeys.filter((key) => !HostPrivateSecretKeySet.has(key))
```

`ExportedSecretKeys` is the **closed export list**. Export boundaries
enumerate THIS list rather than `SecretKeys`, so a future host-private key
cannot leak merely by being added to `SECRETS_KEYS` — the failure mode is
now opt-in and explicit.

The `satisfies` clause makes the compiler reject a host-private entry that
is not actually a member of `SECRETS_KEYS`, so the two lists cannot drift.

### The READ boundary

```ts
// StateManager.constructApiConfigurationFromCache()
const secrets = Object.fromEntries(ExportedSecretKeys.map((key) => [key, this.getSecret(key)])) as Secrets
```

### The WRITE boundary

```ts
// StateManager.setApiConfiguration()
if (isSecretKey(key)) {
    if (isHostPrivateSecretKey(key)) {
        return acc   // host-private records are NEVER writable from the webview
    }
    acc.secretsUpdates[key as keyof Secrets] = value as any
}
```


### The records remain FULLY functional in the trusted store

Exclusion is at the export boundary ONLY. The records keep every trusted
capability:

| Capability | Status |
|---|---|
| `StateManager.getSecretKey()` read | PRESERVED |
| `StateManager.setSecret()` write | PRESERVED |
| persisted to `secrets.json` (mode 0o600) | PRESERVED |
| read by the VS Code legacy migration | PRESERVED |
| reset by `resetGlobalState()` | PRESERVED |
| session restoration / one-shot authorization | PRESERVED (CORRECTION01 suite 20/20) |
| missing-secret fail-closed | PRESERVED (CORRECTION01 suite 20/20) |

### Provider credential behavior is PRESERVED

Provider API keys deliberately stay OUT of the host-private set: they are
part of the `apiConfiguration` the settings UI and provider surfaces operate
on. The suite asserts both directions — the provider credential is still
EXPORTED (read) and still WRITABLE from the webview (write).

## Protobuf field-number compatibility

Fields **51** and **52** are RETAINED in the `Secrets` message. Removing
them would have freed the numbers for reuse by a future field, which is a
wire-compatibility hazard; keeping them preserves the numbering exactly.

The generated TypeScript is unchanged by this correction: the keys still
exist as members of the `Secrets` message and in the `Secrets` type, so the
proto surface, the field numbers and the generated code are all identical.

The `state.proto` generator's `PRESERVED_SETTINGS_FIELDS` mechanism
(`Settings` message) is unaffected: these are `Secrets` fields, and the
`Secrets` message is generated from `SECRETS_KEYS`, which still contains
both keys.

## Build gates

| Gate | Result |
|---|---|
| `apps/vscode` `tsc --noEmit` | **0 diagnostics** |
| CORRECTION02 boundary suite (9 witnesses) | **9/9 PASS** |
| CORRECTION01 lifecycle suite (20 witnesses) | **20/20 PASS** |
| biome lint + format (3 changed files) | **PASS** (0 errors) |
| RED ablation | **4 failed / 5 passed** -> restored to 9/9 PASS |

### The base-suite regression (executed)

The full base suite was run three times with the CORRECTION02 change applied
and once with it stashed (the pre-correction baseline), and the runs were
compared at **individual failing-test identity** granularity — the same
measure CORRECTION01 established, and using an extractor validated by
reproducing CORRECTION01's preserved 187-identity file **byte-for-byte**.

| Run | Failing-test identities |
|---|---|
| baseline (CORRECTION02 stashed) | 199 |
| corrected, run 1 | 201 |
| corrected, run 2 | 200 |

**The identity set is not stable across runs of the SAME code.** Run 1 and
run 2 differ by exactly one identity
(`natural-exit-pgid-causal-repro01` C1 — present in run 1, absent in run 2),
which establishes that the suite is order/timing dependent.

The two identities that appeared "new" against the baseline run were each
proven PRE-EXISTING and unrelated to CORRECTION02:

1. **`natural-exit-pgid-causal-repro01` C1** — already present in
   CORRECTION01's preserved 187-identity baseline; and it fails identically
   when its file is run in isolation at the baseline AND with the
   correction applied.

2. **`background-completion-barrier01.bcb01` BCB-INT-01** — fails
   identically at the baseline AND with the correction when the file is run
   **ALONE** (`2 failed | 12 passed` in both cases). Decisively, the test
   file **mocks out `@/core/storage/StateManager` entirely**
   (`vi.mock("@/core/storage/StateManager", ...)` at line 61), so it never
   executes the code this correction changed.

```text
ZERO ACT-owned regressions.
ACT_OWNED_DIAGNOSTICS: 0
```

## What is NOT claimed

```text
INSTALLED-LIVE QUALIFICATION:  NOT EXECUTED. The corrected VSIX has not
                              been packaged, installed or run live.
ACT_OWNED_DIAGNOSTICS:        0
NEXT_ACTION:                  rebuild and repackage the VSIX from the
                              exact committed HEAD and verify the embedded
                              bundle SHA-256, before any installation into
                              the codium-roz profile.
ROUND C:                      unchanged and NOT re-litigated.
```

### ONE source closes EVERY downstream boundary

Every webview-facing consumer — `getStateToPostToWebview()`, the
`initializeWebview()` paths, the state subscription, `getLatestState()`,
`updateSettings()`, `updateApiConfiguration*()` — reads the SAME
`getApiConfiguration()` result. Excluding at that single source therefore
closes all of them at once; there is no second enumeration to keep in sync.

Verified: no logging path dumps `apiConfiguration`
(`grep` for `apiConfiguration` in a `Logger`/`console` context returns
nothing).


`setApiConfiguration()` categorized keys with `isSecretKey(key)`, which
matched the adjudication keys. So a webview-supplied payload could
**OVERWRITE** the host's per-session evidence secret — destroying the
session's evidence identity and letting the webview choose a value it would
later observe. Excluding the keys at the READ boundary alone would NOT have
closed this. Both boundaries are now closed.
