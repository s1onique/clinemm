# 04 — Exit report

**ACT:** `ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01`
**Executor:** `codium-clinemm2`
**Verdict:** `GO_PROVIDER_REASONING_REPAIR_INTEGRATION`

---

## 1. Dispositions

```
EXECUTION_ISOLATION                 VERIFIED
ENTRY_SOURCE_IDENTITY               VERIFIED
INSTALLED_BUILD_CORRELATION         UNKNOWN
LIVE_WARNING_CORRELATION            LIVE_UNOBSERVABLE
WARNING_EMITTER_IDENTIFIED          VERIFIED

MINIMAX_PROVIDER_CONTRACT           VERIFIED
NATIVE_ANTHROPIC_CONTRACT           VERIFIED
UPSTREAM_PR_APPLICABILITY           PARTIALLY_PRESENT

MINIMAX_RED                         REPRODUCED
ANTHROPIC_RED                       REPRODUCED
LOSS_BOUNDARY                       IDENTIFIED
CAUSAL_NECESSITY                    PROVEN

OUTBOUND_REASONING_REPLAY           VERIFIED
REASONING_BLOCK_ASSOCIATION         VERIFIED
SIGNATURE_CONSERVATION              VERIFIED
UNSIGNED_REASONING_HANDLING          VERIFIED
SESSION_ROUNDTRIP                   VERIFIED
MULTI_TOOL_ROUND_CONSERVATION       VERIFIED
PROVIDER_ORIGIN_CONSERVATION        VERIFIED

MINIMAX_LOW_WIRE_EFFORT             CORRECT
REDACTED_REASONING_DISPOSITION       DISTINCT_PRE_EXISTING_DEFECT (successor ACT recommended)
COMPACTION_DISPOSITION              CONSERVED

FOCUSED_REGRESSION_GATE              PASS (238/238)
TYPECHECK_GATE                      PASS (exit 0)
ORDINARY_GATE                       PASS_WITH_PRE_EXISTING_FAILURES (1189 passed, 17 pre-existing failures in 3 unrelated suites)
ACT_OWNED_DIAGNOSTICS               NONE

FINAL_HEAD                          a20fe940d91003dd5b4ff4a48ce904d26bdcf0b3
ACT_BRANCH                          act/provider-reasoning-continuity-p0-01
WORKTREE_PATH                       /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-second/.worktrees/act-pr-p0-01
TRACKED_DIRT                        none

INTEGRATION                         NOT_AUTHORIZED (isolated branch only)
VSIX_PACKAGING                      NOT_AUTHORIZED
LIVE_PROVIDER_QUALIFICATION         NOT_AUTHORIZED
```

## 2. Handoff identity

| Property | Value |
|---|---|
| `ENTRY_HEAD` | `1d45a8d845eca27bce311949a08fca7868f211cd` |
| `RED_SUBJECT_HEAD` | `1d45a8d845eca27bce311949a08fca7868f211cd` |
| `FINAL_HEAD` | `a20fe940d91003dd5b4ff4a48ce904d26bdcf0b3` |
| `ACT_BRANCH` | `act/provider-reasoning-continuity-p0-01` |
| `WORKTREE_PATH` | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-second/.worktrees/act-pr-p0-01` |
| `TRACKED_DIRT` | none (clean at exit) |
| `CHANGED_FILES` | 1 production + 5 test + 4 evidence |
| `PRODUCTION_DIFFSTAT` | `sdk/packages/llms/src/providers/ai-sdk.ts` — +77 / -7 |
| `TEST_DIFFSTAT` | 5 new files, 1 000+ lines of assertions |
| Commit message | `fix(llms): preserve provider reasoning across tool rounds` |

The primary checkout (`main`, `1d45a8d84`) was NOT branched, merged,
rebased, cherry-picked into, or otherwise modified. It was restored to its
exact entry state.

## 3. Required summary

### 3.1 What actually failed

The ClineMM AI SDK translator discarded the provider's reasoning SIGNATURE.

The Anthropic-compatible transport (which serves MiniMax M3 / M3.1 Flash)
streams a thinking block's signature as a SEPARATE, EMPTY-TEXT event. The
resolved `@ai-sdk/anthropic@4.0.94` surfaces it as a `reasoning-delta` with
an empty `delta` and the signature in `providerMetadata.anthropic`.

ClineMM's translator had two independent gaps:

1. its reasoning branch was guarded by a non-empty-text check, so the
   signature-only event was **dropped entirely**;
2. its metadata extractor read only the Google/Vertex buckets and never read
   `providerMetadata.anthropic`.

The consequence was not a cosmetic warning: the next outbound request
serialised the reasoning WITHOUT a signature, and the Anthropic serializer
then emitted `unsupported reasoning metadata` **and dropped the reasoning
block from the request entirely**. The provider-required reasoning was
silently lost between rounds.

The deterministic reproduction emits the exact observed warning string —
`AI SDK Warning (minimax / MiniMax-M3.1-Flash): unsupported reasoning
metadata` — through the real gateway and the real resolved SDK.

### 3.2 Where the information was lost

**`sdk/packages/llms/src/providers/ai-sdk.ts`, the AI SDK stream translator.**

The boundary matrix (measured, not inferred):

| Boundary | Observed |
|---|---|
| Raw response | Contract-valid: thinking text + a separate `signature_delta` |
| SDK stream | 2 `reasoning-delta` parts; 1 signature-bearing; 1 with an empty `delta` — **correct** |
| **Translator** | 1 `reasoning-delta`; **0** carrying the Anthropic signature — **THE LOSS** |
| HTTP request | No `thinking` block; warning emitted |

The runtime accumulation, the persistence codec and the outbound conversion
were all already correct — they were never reached with a signature to carry.

### 3.3 Why the correction is necessary

Three independent ablations, each restoring RED together with the exact
warning string:

| Ablation | Change | Result |
|---|---|---|
| A | revert the whole production change | RED restored |
| B | keep the metadata extraction, restore the `if (text)` guard | RED restored |
| C | forward the empty-text event, remove only the Anthropic extraction | RED restored |

B and C isolate the two halves of the correction, so each half is
independently necessary.

### 3.4 What changed in production

One file, `sdk/packages/llms/src/providers/ai-sdk.ts` (+77 / -7):

1. `extractGoogleThoughtMetadata` → `extractReasoningMetadata`: the
   Google/Vertex extraction is unchanged; the Anthropic `signature` and
   `redactedData` are now carried verbatim under the same key names the
   outbound conversion already reads — so the round trip needs no
   provider-specific branch at the send boundary.
2. A metadata-bearing reasoning event is forwarded even when its text is
   empty. An event with neither text nor metadata remains a no-op, so every
   other provider's default path is unchanged.

Nothing else changed. No signature is fabricated; no reasoning replay is
disabled; no signature validation is bypassed; no placeholder reasoning is
inserted; reasoning is not converted into ordinary text; the warning is not
suppressed; the provider registry, the MiniMax transport and the AI SDK
dependency tree are untouched; no permanent diagnostic field was added.

### 3.5 What executable evidence proves the repair

- The RED is asserted against the **actual serialized outbound HTTP request
  body** produced by the real gateway and the real resolved provider SDK,
  with only the external network boundary replaced. The assertion is exact
  equality on the reasoning text, the signature, the tool-call id and the
  tool-result id — not a warning count and not a reconstructed history.
- After the repair the follow-up request carries
  `{"type":"thinking","thinking":"SYNTHETIC-REASONING-BLOCK-TEXT","signature":"synthetic-opaque-signature-aa11bb22"}`.
- Focused regression gate: **238/238** (`src/providers/routing/`).
- Existing provider regression: **245/245** (`gateway.test.ts`,
  `ai-sdk.test.ts`, `ai-sdk.tool-calls.test.ts`,
  `ai-sdk-transport-continuation.test.ts`); `gateway.test.ts` alone is
  183/183, including the Vertex/Google `thoughtSignature` extraction and
  replay tests.
- Affected-package typecheck: exit 0, no diagnostics.
- Biome check on every changed file: exit 0, no findings.
- The ordinary package gate shows 1189 passed / 17 failed; those 17 failures
  are **identical on the pristine baseline** and are in
  `resolvePortableReasoning` and the SAP process-hygiene suites — unrelated
  to this path. `ACT_OWNED_DIAGNOSTICS = NONE`.

### 3.6 Which independent defects or uncertainties remain

| Item | Disposition |
|---|---|
| **Redacted thinking** | A **distinct, pre-existing defect**. The SDK surfaces a redacted block as a `reasoning-start` part with no text delta; the translator reads only `reasoning-delta` / `reasoning`, so no runtime event is produced. Measured IDENTICAL before and after this repair. A redacted block is therefore NOT replayed on the wire. **A successor ACT is recommended** to handle `providerMetadata.anthropic.redactedData` on the `reasoning-start` part. This ACT does not claim to cover it. |
| `INSTALLED_BUILD_CORRELATION` | `UNKNOWN` — the ACT forbids altering, reloading or restarting the installed extension, and no live capture of the `4.1.26-821b20e7a` installation was taken. The defect does not depend on that identity: it is a property of the resolved `@ai-sdk/anthropic@4.0.94` plus the translator, and it was reproduced deterministically on the source revision named above. |
| `LIVE_WARNING_CORRELATION` | `LIVE_UNOBSERVABLE` — by design; the causal claim rests on the reproduction, which emits the byte-identical warning string for the same provider id and model id. |
| Historical conversations | Existing conversations with already-lost reasoning metadata are **not** repaired by this change. Do not attempt to reconstruct unavailable historical provider metadata; use a fresh session for subsequent live qualification. |
| gitleaks | The repository's secret-scanning binary is not installed in this environment, so the gitleaks gate was **not executed**. The fixtures were reviewed by hand and contain no credential-shaped values. |

### 3.7 The exact isolated commit available for integration

```
branch: act/provider-reasoning-continuity-p0-01
commit: a20fe940d91003dd5b4ff4a48ce904d26bdcf0b3
message: docs(factory): add the provider reasoning continuity P0 exit report
parent:  57fc492d5451b9f95085a7fcace226cf68506dc0

  (the production repair itself:)
commit: 57fc492d5451b9f95085a7fcace226cf68506dc0
message: fix(llms): preserve provider reasoning across tool rounds
parent:  1d45a8d845eca27bce311949a08fca7868f211cd
```

Integration into the advancing primary branch is a separate, explicitly
authorised operation and was NOT performed.

## 4. Successor recommendation

**One successor ACT is recommended** (recorded, not initiated):

> `ACT-CLINEMM-PROVIDER-REDACTED-REASONING-REPLAY-01` — make the AI SDK
> translator handle the `reasoning-start` part's
> `providerMetadata.anthropic.redactedData`, so an Anthropic
> `redacted_thinking` block can be replayed on the wire, with the same
> provider-origin conservation rules as this ACT.

No reasoning-effort successor is recommended: `MINIMAX_LOW_WIRE_EFFORT =
CORRECT`.
