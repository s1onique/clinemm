# Working-context seam recon

**Authored 2026-09-02 in response to factory causal reviewer's
HALT_WRONG_POST_COMPACTION_PROJECTION on `3b789ef16`.**

**Status:** REOPEN, recon-only. The previous discriminator
specification in `semantic-contract-recon.md` reconstructed
`W_after` by calling `prepareProviderMessagesForApi(postCompact
CanonicalSnapshot)`, but that function does NOT read the
compaction artifact. Canonical session history is intentionally
append-only / full-fidelity, and the post-compaction active
working context lives separately as a compaction artifact.
Calling `prepareProviderMessagesForApi(postCompactCanonical
Snapshot)` would pass canonical history to a function that
ignores the compaction sidecar — i.e., `W_after ≈ W_before` even
when the active working context has shrunk dramatically.

This recon binds the real production seam that produces the
post-compaction working context, so the next revision of the
discriminator exercises it correctly.

## Source-of-truth citations

- `sdk/ARCHITECTURE.md:480-498` ("9. Context Compaction"):
  - "@cline/agents owns the generic turn-preparation seam"
  - "@cline/core owns compaction policy... persist the latest
    compacted working context as a session compaction artifact"
  - "canonical session history lives in the session messages
    artifact at full fidelity; compaction state lives separately
    in `${sessionId}.compaction.json`"
  - "resume loads the canonical transcript for history/debugging
    and, when present, reuses the latest compaction state only
    after validating a hash of the canonical prefix covered by
    that state; valid state is projected by appending canonical
    messages written after the compaction boundary"

## The four inspection steps

### Step 1 — Where the compaction result is persisted

**Owner:** `@cline/core` runtime-host.

- `sdk/packages/core/src/runtime/host/local-runtime-host.ts:655`
  `const compact = createContextCompactionPrepareTurn(configWithProvider);`
- `sdk/packages/core/src/runtime/host/local-runtime-host.ts:662-678`
  `prepareTurn = createCompactionStateAwarePrepareTurn({ compact,
  getState: () => activeSessionRef?.compactionState, saveState: ...
  })` — the seam-aware prepareTurn writes via `saveState` and
  reads via `getState`. The persisted artifact is
  `SessionCompactionState` (defined at
  `sdk/packages/core/src/session/models/session-compaction.ts`).
- Persistence target: `${sessionId}.compaction.json` per the
  architecture doc (line 497). Confirmed by
  `local-runtime-host.ts:1512` `session.compactionState = state`
  and `local-runtime-host.ts:2276`
  (`if (session.compactionState) { ... session.compactionState,
  ... session.compactionState = undefined }`) which orchestrate
  read / clear around resume boundaries.

### Step 2 — Where the artifact is read during the next turn

- `sdk/packages/core/src/extensions/context/compaction.ts:673-675`
  (inside `createCompactionStateAwarePrepareTurn`):
  ```
  const existingState = input.getState?.();
  const projectedMessages = existingState
      ? projectSessionCompactionState(existingState, context.messages)
      : undefined;
  ```
  The next-turn read is `getState()` (called from
  `local-runtime-host.ts:663`'s closure over
  `activeSessionRef.compactionState`). When `existingState`
  exists, `projectSessionCompactionState` projects it against
  the canonical context; when `existingState` is undefined (or
  the projection returns undefined due to hash mismatch), the
  seam falls back to canonical context.

### Step 3 — The canonical+artifact combiner

- `sdk/packages/core/src/session/models/session-compaction.ts:161-193`:
  ```
  export function projectSessionCompactionState(
      state: SessionCompactionState,
      sourceMessages: readonly MessageWithMetadata[],
  ): MessageWithMetadata[] | undefined {
      const hasEnoughSourceMessages =
          state.source_message_count <= sourceMessages.length;
      if (!hasEnoughSourceMessages) return undefined;
      const hasMatchingSourcePrefix =
          !!state.source_prefix_hash &&
          sourcePrefixHash(sourceMessages, state.source_message_count) ===
              state.source_prefix_hash;
      const boundary = sourceMessages[state.source_message_count - 1];
      const hasMatchingLegacyBoundary =
          !state.source_prefix_hash &&
          state.source_message_count > 0 &&
          !!state.source_last_message_key &&
          messageBoundaryKey(boundary) === state.source_last_message_key;
      const canProjectState = hasMatchingSourcePrefix || hasMatchingLegacyBoundary;
      if (!canProjectState) return undefined;
      return [
          ...cloneMessages(state.messages),
          ...cloneMessages(sourceMessages.slice(state.source_message_count)),
      ];
  }
  ```
  This is THE combiner. Result shape:
  `[...compaction-artifact messages, ...canonical-tail messages
  (those written after the compaction boundary)]`.

  The state-aware prepareTurn returns this array as
  `ContextPipelinePrepareTurnResult.messages`
  (`compaction.ts:60-64`). That's the working-context messages
  object.

### Step 4 — The final pre-provider builder / safety normalization

After `prepareTurn` returns `projectedMessages`, the agent
runtime consumes them through the regular message-build pipeline:

- `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1149`
  `const apiMessages = await this.prepareProviderMessagesForApi(messages);`
  where `messages` is the post-`prepareTurn` array.
- `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1186`
  `const providerMessages = await this.prepareProviderMessagesForApi(...)`
  for the next provider call.
- `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1192`
  `private async prepareProviderMessagesForApi(...)` — this is
  the function the previous recon mistakenly suggested calling
  directly on a canonical snapshot. In production it always runs
  AFTER `prepareTurn`, on the post-compaction projected
  messages. It applies additional normalization (image-URL
  rewriting, system-prompt prefixing, schema fixes, hook
  rewrites from the agent message-builder) — so it is a
  second-stage transformation, not the producer of the working
  context itself.

The agent's message-builder (configured at
`session-runtime-orchestrator.ts` constructor:
`this.messageBuilder = new WX(KU())` — `KU` being the default
config) is what turns the projected messages into provider-bound
`apiMessages`. That builder is also where safety normalization
hooks run.

## Implication for the discriminator (CAUSAL CORRECTION)

`3b789ef16` defined:

```text
W_before = estimate(prepareProviderMessagesForApi(preCompactCanonicalSnapshot) + systemPrompt + tools)
W_after  = estimate(prepareProviderMessagesForApi(postCompactCanonicalSnapshot) + systemPrompt + tools)
```

**This is wrong.** `prepareProviderMessagesForApi` is a second-
stage transformation; it does not consult the compaction
artifact. `postCompactCanonicalSnapshot` is the canonical
transcript (still full-fidelity); running it through
`prepareProviderMessagesForApi` is **indistinguishable** from
running `preCompactCanonicalSnapshot` through the same function
unless canonical tail grew in between (which it should not — no
model turn is allowed between pre and post). So `W_after ≈
W_before` would be the deterministic outcome, and the
discriminator would manufacture a false S3 PROVEN (or, if the
ratio happened to drift due to a hook, a false
`S3_RATIO_TRANSFER_NOT_REPRODUCED`). Either way: **useless**.

The correct definition of `W_before` / `W_after` must drive the
state-aware prepareTurn TWICE against identical surrounding
canonical state, with exactly one manual compaction applied in
between:

```text
STATE_PRE  = canonical history (unchanged between runs)

W_before   = estimate(buildForApi(
              prepareTurn({ messages: STATE_PRE, ... }).messages
            ) + systemPrompt + tools)

apply exactly one manual compaction:
   result = await compact({ messages: STATE_PRE, ... })
   newState = createSessionCompactionState({
                sourceMessages: STATE_PRE,
                compactedMessages: result.messages,
                conversationId, systemPrompt,
              })
   saveState(newState, STATE_PRE)   // installs the new artifact

W_after   = estimate(buildForApi(
              prepareTurn({ messages: STATE_PRE, ... }).messages
            ) + systemPrompt + tools)
```

Where:

- `prepareTurn = createCompactionStateAwarePrepareTurn({ compact,
  getState: () => session.compactionState, saveState: ... })` —
  the same construction used at
  `local-runtime-host.ts:665-678`.
- `buildForApi(...)` is the agent's message-builder
  constructor-time call (`session-runtime-orchestrator.ts`
  constructor wires `messageBuilder = new MessageBuilder(...)`).
- `systemPrompt` and `tools` are the SAME for both captures
  (so only the working-context projection varies between
  `W_before` and `W_after`).

### Why this is causal

Both `W_before` and `W_after` are produced by the SAME production
turn-preparation seam against the SAME canonical state. The ONLY
state change between the two captures is the compaction artifact
having been installed by the manual-compaction call. No model
turn, no hook traffic, no canonical-tail growth. This is the
only A/B comparison where `working_ratio = W_after / W_before`
isolates the compaction effect.

### Why the rename to WORKING_CONTEXT_RATIO (during recon)

The reviewer is right that "provider_projection_ratio" was
overclaimed. The seam ends at `prepareTurn(...).messages` —
that is the working-context projection. After `prepareTurn`, the
agent's message-builder (`buildForApi`) applies further
transformations (image rewriting, system-prompt prefixing,
schema fixes, hook rewrites, safety normalization) before the
final `providerMessages` array. Naming the recon variable
WORKING_CONTEXT_RATIO reflects what `prepareTurn` produces. If
subsequent inspection proves the buildForApi layer is
deterministic and idempotent across the post-compaction state
boundary (no extra compaction-aware logic), the discriminator can
promote:

```text
WORKING_CONTEXT_RATIO
  → PROVIDER_BOUND_PROJECTION_RATIO
```

with evidence. Until then, the recon variable is intentionally
named to NOT overclaim.

### What the recon does NOT yet prove

- Whether `buildForApi` itself contains compaction-aware logic
  beyond the `prepareTurn` projection (it shouldn't, per the
  architecture: "keep compaction logic out of the low-level
  agent message builder", `sdk/ARCHITECTURE.md:489`). A targeted
  inspection is the next bounded step.
- Whether the auto-vs-manual prepareTurn paths share the same
  combiner. (Auto uses
  `createContextCompactionPrepareTurn` → `compact(...)` →
  `saveState`; manual uses the same `compact` factory but
  passes canonical H. Both write through the same saveState;
  the next-turn read is shared.)
- Whether hash-mismatch recovery (when canonical was edited and
  the stored artifact's `source_prefix_hash` no longer matches)
  can occur on the manual-compaction path. (The recon evidence
  so far does not establish this either way; it should not
  affect the manual-compaction discriminator because manual
  compaction always uses the latest canonical history.)

## Reopen-condition for executing the discriminator — CALIBRATED 2026-09-02 fourth-review-second-pass

**Correction:** the previous wording of the buildForApi gate
was over-constrained. The proposed universal equivalence
`buildForApi(prepareTurn(x).messages) ≈ buildForApi(x.messages)`
is FALSE by design — `prepareTurn(x).messages` is supposed to
be materially different from `x.messages` (compaction
projection replaces a canonical prefix with the compacted
artifact). Requiring that the second-stage builder be
"transparent to compaction" would defeat the entire purpose of
measuring the production working-context projection.

**Correct gate** (per factory causal reviewer's
PASS_WITH_ONE_P1_FIX, 2026-09-02):

```text
BUILD_FOR_API_SIDE_CHANNEL_INVARIANT:

For the two A/B captures, buildForApi must be invoked through
the same production path with identical non-message
inputs/configuration. It must not independently read mutable
compaction state outside the prepared messages in a way that
differs between A/B.
```

Concretely, the A/B harness must satisfy:

```text
NON_MESSAGE_INPUTS_BEFORE == NON_MESSAGE_INPUTS_AFTER
CANONICAL_BEFORE          == CANONICAL_AFTER
ONLY_MUTATED_AUTHORITY    == compactionState
```

If `buildForApi` deterministically rewrites the message arrays
differently because **the arrays themselves differ**, that is
not contamination — that is precisely part of the production
working/provider projection we want to measure. We **include**
the second-stage transformation in W, not exclude it.

### Targeted inspection result (2026-09-02)

Inspected `MessageBuilder` at
`sdk/packages/core/src/session/services/message-builder.ts:166`:

```text
buildForApi(messages: Message[]): Message[] { ... }
```

The signature accepts only the prepared messages; no
`compactionState`, `session.compaction`, `currentCompaction`,
or `compactionMode` parameters. Searched the file body and
the broader `message-builder.ts` for any of those identifiers
— zero matches. The base builder receives compaction only
through its message argument.

(There is a "Known gap" note at
`sdk/packages/core/src/extensions/context/compaction.ts:253`
about plugin-registered message builders — that is a
different concern from the base builder we drive; plugins
register custom builders via `registerMessageBuilder()`,
which is opt-in extension territory. The base builder path
used by manual compaction is the one we control.)

### C1 GO status — corrected

**C1: GO — execute the discriminator immediately, no further
review loop.** The seam is sufficiently bound.

The corrected discriminator formula was already authored in
this commit's `semantic-contract-recon.md` update (the
`buildForApi(prepareTurn(...).messages)` form), so step 2 is
already satisfied. The narrowing check (no independent
compaction-state side channel) is satisfied by source
inspection above.

## What this commit DOES NOT change

- No production code change.
- No test delta.
- No review loop opened.
- No discriminator executed yet.

This file is the bound the next turn will use to revise the
discriminator. It is internally consistent with the prior
recons (producers.md, semantic-contract-recon.md,
compaction-input-identity-recon.md, entry-freeze.txt) and the
upstream architecture doc.

## POST-DISCRIMINATOR FORM REVIEW (added 2026-09-02 06:30:00Z)

The factory causal reviewer's P0/P1 hardening pass identified
that the committed discriminator test, while correctly reaching
the real production seam, was logging the verdict without
**asserting** it. The committed test file has been updated:

- **GREEN positive control** (case 1, small canonical) asserts
  `relativeDiff ≤ 0.10` — confirms the test harness is correct
  WHERE IT SHOULD BE.
- **RED-defect witness** (case 2, realistic canonical, 600K
  assistant text) asserts `relativeDiff > 0.10` AND
  `verdict === "S3_REPRODUCED"` — these would RED if the
  cross-scale mismatch ever disappears.
- **Causal controls added**:
  - `wBefore.estimate < hBefore.before` (mechanical proof that
    buildForApi's truncation has run before compaction)
  - `manualRatio < workingContextRatio` (mechanical proof
    that compactor's H scale < working-context W scale)
  - `relativeDiff > 0.10` (load-bearing witness)
  - `verdict === "S3_REPRODUCED"` (categorical match)
- **Strong RED form captured** in `red-witness.txt`:
  ```
  AssertionError: expected 0.6664678440519827 to be less
                  than or equal to 0.1
  ```
  This is the reviewer-recommended Factory form RED at HEAD;
  captured once and removed from the default suite (per
  Factory doctrine: do not permanently commit intentionally
  failing tests).

The seam itself (BUILD_FOR_API_SIDE_CHANNEL_INVARIANT, and
the targeted inspection of `MessageBuilder.buildForApi`) is
UNCHANGED by this hardening pass — it was already correctly
bounded. The hardening was about the TEST form, not the seam.

## POST-DISCRIMINATOR REVIEWER DISPOSITION (added 2026-09-02 07:00:00Z)

The factory causal reviewer's fourth-second-pass P1 wording fix
identified that the committed test's RED-witness comments
contradicted its actual assertions (the test PASSES at buggy
HEAD because the defect IS reproducible; comments incorrectly
described it as a RED). Wording corrected in this turn's
commit:

- Test renamed: "RED: manual-compaction ratio does not
  transfer to working-context shrink once provider-message
  truncation engages" → "DEFECT-WITNESS: cross-scale
  compaction ratio diverges once provider-message truncation
  engages"
- Test description clarified: this is a DEFECT WITNESS, NOT A
  RED. The assertion `relativeDiff > tolerance` PASSES at
  current buggy HEAD (relativeDiff ≈ 0.666) because the defect
  IS reproducible. If a future change accidentally removed
  the cross-scale mismatch, this test would correctly RED.
- The temporary RED capture in `red-witness.txt` is labelled
  `RED_ARITHMETIC_WITNESS = SYNTHETIC` (the temporary capture
  reconstructed the observed ratios from scratch in an ad-hoc
  one-time file removed after capture; it is NOT a production-
  seam RED). The production-seam RED is established by THIS
  test's inverted-invariant GREEN here. Recon composition:
  SYNTHETIC canonical/manualCompact + REAL production
  compaction projection + REAL MessageBuilder + exact causal
  assertions = SYNTHETIC_REAL defect reproduction.
- No further RED-capture ceremony required. C1: GO to the
  bounded consumer-side repair trial.

The downstream repair ACT
(`ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01`,
reviewer-retitled from WIRE-CONTRACT-REPAIR01 since the wire
is NOT yet proven defective) opens with its own entry-freeze
and review pass. First trial = option (d) consumer-side
reconciliation; no protocol change. Options (a)/(b) escalate
only if (d) proves insufficient.

## POST-DISCRIMINATOR REVIEWER P0 HALT_WRONG_REPAIR_ORACLE CORRECTION (added 2026-09-02 08:00:00Z)

The factory causal reviewer's fourth-second-pass P0 halt identified
that the originally opened repair ACT
(`ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01`)
proposed inverting the H/W DEFECT-WITNESS assertion to
`relativeDiff <= 0.10` as the post-fix regression oracle. This
is INCORRECT: Strategy D changes only the consumer seam
(`getApiMetrics.ts:174-225`) and does NOT change H/W scales.
After a correct Strategy-D implementation, the H/W mismatch is
still 0.666 relative divergence — the inverted assertion would
RED forever. The test being proposed for GREEN lives UPSTREAM
of the repaired boundary.

The reviewer's correction reframes the repair as a **necessity /
ablation matrix** (G1-G6):

```text
G1 — NECESSITY CONTROL
  H/W DEFECT-WITNESS stays GREEN after repair (the underlying
  scale mismatch still exists; the repair does NOT remove it,
  it removes the ratio TRANSFER). Evidence class: ABLATION_PREMISE.

G2 — CONSUMER RED → GREEN (load-bearing repair oracle)
  At buggy HEAD:
    expect(fabricated P_after).not.toEqual(
      previous P_before × H_after/H_before)
    → FAILS at buggy HEAD (the fabricated P_after IS present
      in current getApiMetrics output)
  After Strategy D applied:
    → PASSES (no fabricated P_after; the consumer refuses to
      synthesize a request-input count from an H-space ratio
      whose baseline is incompatible)

G3 — GENUINE TRUTH RESTORATION
  When the next genuine provider/request observation arrives,
  it replaces the stale/unknown post-compaction value via the
  existing UI contract.

G4 — POSITIVE COMPATIBILITY
  If the H baseline IS demonstrably compatible with the P
  baseline, existing transfer behavior remains permitted.

G5 — PRESENTATION CONSERVATION
  Compaction's own before→after numbers (H_before → H_after)
  remain visible as their own metric.

G6 — COLLATERAL
  Existing compaction suite + existing getApiMetrics tests
  remain GREEN. No producer/schema/API/.proto change for
  first trial.
```

The repair ACT's:

- Frozen contract reframed as `INCOMPATIBLE_BASELINE → no ratio
  transfer` (NOT a manual/auto special-case; the recon only
  proved INCOMPATIBLE_BASELINE, not manual-vs-auto equivalence).
- Frozen RED moved from H/W seam (upstream of repaired boundary)
  to consumer seam (G2).
- `PRODUCTION_DELTA` corrected to ZERO at opening commit (was
  incorrectly labelled APPLIED — this opening commit contains
  no `getApiMetrics.ts` change).
- `REPAIR_STATUS = NOT_YET_APPLIED`; `STRATEGY_D =
  SELECTED_FOR_IMPLEMENTATION`. Implementation commit graduates
  to APPLIED.
- `REPAIR_AUTHORIZED = YES` (C1: GO after P0 correction).

The seam binding described in this file (BUILD_FOR_API_SIDE_
CHANNEL_INVARIANT, and the targeted inspection of
`MessageBuilder.buildForApi`) is UNCHANGED by this P0
correction — it was already correctly bounded. The P0 halt
addressed the REPAIR ACT's oracle, not the recon's seam.

C1: GO (after the correction). Review round closed for this
recon ACT. The implementation commit
(`getApiMetrics.ts:174-225` consumer-side reconciliation +
new acceptance gates in `getApiMetrics.test.ts`) opens its own
review pass.

EOF NEWLINE (added 2026-09-02 08:00:00Z per factory causal
reviewer's P2 cleanup directive).
