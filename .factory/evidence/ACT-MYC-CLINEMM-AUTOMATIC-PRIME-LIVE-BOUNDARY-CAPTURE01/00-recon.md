# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01 — Recon

## Source of truth

```text
ENTRY_HEAD = 27868d9f1214e099bd444101f1c8ef8ed3869de9
SUBJECT_HEAD = 89249175c71fcbc059d26d54f5c50f7f6dbd3373 (production code unchanged)
```

The implementation is uncommitted at recon time. The ACT contract
forbids predicting the commit SHA before the diagnostic work is
landed; this file records the uncommitted state.

## Production seams (REAL, from source on HEAD)

The six production seams identified by §3 of the ACT are real and
located at the following lines (verified by `git grep` on the
working tree):

| Seam | Location |
|------|----------|
| `buildAgentHooks` creation | `apps/vscode/src/sdk/hooks-adapter.ts:143` |
| hook bag passed into runtime | `apps/vscode/src/sdk/sdk-session-config-builder.ts:31` (now `:36-41` after wiring) |
| `beforeModel` entry | `apps/vscode/src/sdk/hooks-adapter.ts:214` (now `:214` with ENTER at `:219-236`) |
| prime recorder lookup | `apps/vscode/src/sdk/hooks-adapter.ts:284,304,327` |
| injection return | `apps/vscode/src/sdk/hooks-adapter.ts:336` |
| provider capture binding | `apps/vscode/src/sdk/hooks-adapter.ts:375` (`recordMycPrimeLiveCapture`) |

## Existing diagnostic surface (REUSE, not redesign)

The `myc-prime-live-diag` module is already the central default-off
diagnostic surface for the prime injection causal chain. It exposes
a `MycPrimeLiveDiagnostic` entry shape and four recorder functions:

```text
acquisition (recorder; pre-runtime)
lookup      (recorder; inside beforeModel)
injection   (recorder; inside beforeModel)
capture     (recorder; inside beforeModel)
```

It is gated by `isMycPrimeLiveDiagEnabled()` which honors the
existing `CLINEMM_MYC_PRIME_DIAG` env var AND the central dogfood
profile resolver
(`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts#applyMycPrimeLiveDiagDiagnosticProfile`).
The central profile is invoked from
`apps/vscode/src/extension.ts:141` and auto-enables in dogfood
builds.

**No new env flag is required** (ACT §6: "Preferred gate: `CLINEMM_MYC_PRIME_DIAG=1`. Do not add a second env flag unless the existing diagnostic mechanism cannot represent these events cleanly.").

## Gap analysis: what §4 requires vs. what the existing surface provides

| ACT §4 event | Existing? | Gap |
|--------------|-----------|-----|
| `myc_beforemodel_enter` | NO | Must add — proves the runtime invoked beforeModel (Case A discriminator) |
| `myc_beforemodel_lookup` | PARTIAL | The existing `recordMycPrimeLiveLookup` captures `matchedRecordedSession` and `recordedPrimeFound`, but not the `lookupKey` itself. Adding `lookupKey` is necessary for Case B (key mismatch). |
| `myc_beforemodel_exit` | INDIRECT | `recordMycPrimeLiveInjection` captures `injected`, `reason`, `packetBytes`, `iteration`. This is "exit" semantics. No new recorder is needed; the field is named differently but semantically equivalent. |
| `myc_provider_capture_binding` | YES | `recordMycPrimeLiveCapture` stamps the `captureId` and records `aiSdkPromptObserved: true`. Already wired into the injection branch. |

**Two new recorders required**: `recordMycPrimeLiveBind` (proves
hook bag construction) and `recordMycPrimeLiveEnter` (proves
`beforeModel` body entry). One field extension required: `lookupKey`
on the existing `lookup` observation.

## Discrimination between the §17 cases

After the two new recorders fire, the §17 discriminator tree reads
as follows from the captured entry:

| Case | Detected by |
|------|-------------|
| A: hook never installed | `entry.bind === undefined` for the host sessionId the operator captured from the running myc MCP process |
| B: runtime sessionId identity defect | `entry.bind?.sessionId === S` AND `entry.enter?.sessionId !== S` |
| C: prime recorder lifetime/instance | `entry.enter?.sessionId === S` AND `entry.lookup.recordedPrimeFound === false` (key matches, but recorder had nothing for that key) |
| D: prime injection guard | `entry.injection.injected === false` AND `entry.injection.reason !== "ok"` (the discriminated reason narrows the guard branch) |
| E: post-hook request composition loss | `entry.injection.injected === true` AND the on-disk provider capture file's `primePacketCount` === 0 |
| F: not reproduced live | `entry.injection.injected === true` AND the on-disk provider capture file's `primePacketCount` === 1 |

Each case is now reachable from a single captured entry plus a single
on-disk capture-file join — no extra architectural plumbing, no
production code redesign, no second diagnostic framework.

## Conservation test plan

Per §10, the conservation tests that must remain GREEN are:

- `myc-prime-live-diag.test.ts` (14 pre-existing tests + 5 new LBC tests = 19/19)
- `myc-prime-auto-injection01.api01-red.c24-c-bridge.test.ts` (4/4)
- `myc-prime-automation.identity-join.red.c24-c-bridge.test.ts` (2/2)
- `dogfood-diagnostic-profile-myc-clinemm01.test.ts` (39/39)
- `hooks-adapter.test.ts` (covered by the base config)
- `sdk-session-config-builder.test.ts` (3/3, exercises `buildAgentHooks` call site)
- `myc-prime-automation.lifecycle01.test.ts` (12/12, runs under the bridge config)
- `myc-prime-automation.lifecycle02.test.ts` (4/4, runs under the bridge config)

Pre-existing drift: `turn-state-writer-provenance.wprov.test.ts`
fails on `WPROV07.1` (writerId union reconciliation) **independent
of this ACT** — verified by `git stash` and re-run on the
predecessor commit.

## Implementation budget

- 1 production file modified beyond the existing diagnostic surface: `apps/vscode/src/sdk/hooks-adapter.ts` (wiring at three call sites + one call site in `sdk-session-config-builder.ts`).
- 1 diagnostic surface file modified: `apps/vscode/src/sdk/myc-prime-live-diag.ts` (two new recorders + one field extension + one structural preservation in `startMycPrimeLiveDiag`).
- 1 test file extended: `apps/vscode/src/sdk/__tests__/myc-prime-live-diag.test.ts` (5 new LBC tests).

Total: 3 files. Well under the §8 budget of 1–3 production files.
