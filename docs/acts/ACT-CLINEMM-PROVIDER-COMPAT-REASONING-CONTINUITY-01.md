# ACT-CLINEMM-PROVIDER-COMPAT-REASONING-CONTINUITY-01

**C1: GO — bounded reproduction and repair.**

Close the newly identified origin-authority loss in the compat message
projection, without reopening the established reasoning-authorization
architecture.

```text
ENTRY_HEAD:            a431368ece9a8346a83dc419ff11d9fce4daeb63
                       (ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01
                        (ADDENDUM-01): record the compat projection
                        origin-authority loss)
VERDICT:               GO_COMPAT_REASONING_CONTINUITY
```

## 1. The boundary

The compat projection is `toGatewayRequestMessages()`
(`sdk/packages/llms/src/providers/compat.ts`). Its `thinking` -> `reasoning`
case converts a provider-visible `thinking` block into a gateway `reasoning`
part.

BEFORE the repair it copied `signature`, `call_id` and `details` into the
part's `metadata` bag and did **not** copy `originAuthority`:

```ts
metadata:
    part.signature || part.call_id
        ? {
                signature: part.signature,
                callId: part.call_id,
                details: part.details,
          }
        : undefined,
```

The downstream outbound conversion (`toAiSdkMessages`,
`sdk/packages/llms/src/providers/ai-sdk.ts:833-839`) reads the origin from
`metadata[REASONING_METADATA_ORIGIN_KEY]` (`"originAuthority"`) and gates the
opaque payload through `mayReplayOpaqueReasoning` — which is **fail-closed**:
a missing or malformed origin grants NO replay authority. So the signature was
withheld and the Anthropic serializer dropped the whole thinking block, even
when the block had been signed by the very endpoint the request was going to.

The **established architecture is NOT reopened**: no new authority field, no
identity service, no registry, and `mayReplayOpaqueReasoning` is untouched.

### The existing shared provider-visible projection

`toProviderVisibleMessages()`
(`sdk/packages/shared/src/llms/request-budget.ts:204-211`) ALREADY conserves
the authority — it reads it from the part's metadata bag under the SAME key
the production persistence codec writes and carries it into the content block
as `ThinkingContent.originAuthority`.

### The existing reasoning persistence codec

`contentBlockToAgentPart()`
(`sdk/packages/core/src/runtime/config/agent-message-codec.ts:253-262`)
already writes it back, using the established idiom:

```ts
metadata:
    block.signature || block.originAuthority || block.details
        ? {
                ...(block.signature ? { signature: block.signature } : {}),
                ...(block.originAuthority
                    ? { originAuthority: block.originAuthority }
                    : {}),
                ...(block.details ? { details: block.details } : {}),
          }
        : undefined,
```

### The existing origin-authority replay predicate

`mayReplayOpaqueReasoning()` (`ai-sdk.ts:1715-1743`) — fail-closed on every
branch; UNCHANGED by this ACT.

### The existing ApiHandler production dispatch witness

`createGatewayApiHandler()` (`compat.ts:821-823`) ->
`GatewayApiHandler.createMessage()` (`compat.ts:769-803`) ->
`buildGatewayRequest()` -> `toGatewayRequestMessages()` -> the REAL gateway ->
the REAL resolved Anthropic provider -> the REAL `@ai-sdk/anthropic`
serializer. Only the external `fetch` is substituted.

**Conclusion.** The compat projection DID drop `originAuthority` on otherwise
valid signed reasoning.

## 2. RED

New witness: `sdk/packages/llms/src/providers/compat.origin-authority-continuity.test.ts`.

It drives the ACTUAL production compat dispatch path through the REAL gateway
and the RESOLVED Anthropic serializer, replacing only the external fetch. The
positive control uses the PUBLISHED MiniMax Anthropic route
(`https://api.minimax.io/anthropic/v1`), which is the route the repository
publishes for the `minimax` provider and therefore the only route for which
the production origin authority is ESTABLISHED. The fixture carries the
EXACT authority the frozen session recorded:
`minimax\u0000https://api.minimax.io\u0000/anthropic/v1`.

The conditional signature assertion was strengthened as required:

- Exactly TWO signed reasoning parts enter the compat projection.
- Both retain their ORIGINAL signatures (and their exact thinking text).
- Both must retain their ESTABLISHED `originAuthority`.

**RED RESULT (pre-repair), observed:**

```text
FAIL  CONSERVES two established signed reasoning blocks on the compat wire
AssertionError: expected +0 to be 2   (expected 2, received 0)

Test Files  1 failed (1)
     Tests  3 failed | 2 passed (3)
```

The valid signed blocks were ABSENT from the actual HTTP body — zero
`thinking` blocks reached the Anthropic wire, because the compat projection
dropped the authority and the fail-closed gate withheld the signatures.

The two denial arms (unknown origin, incompatible origin) PASSED pre-repair,
which establishes that the defect was a LOSS of conservation and NOT a
weakening of the gate.

`RED` WAS REPRODUCED; `HALT_RED_NOT_REPRODUCED` does not apply.

## 3. Repair

`sdk/packages/llms/src/providers/compat.ts` — the smallest field-preservation
correction consistent with the existing production codec: carry
`originAuthority` across the defective conversion, under the SAME key the
production persistence codec writes and the SAME key the outbound conversion
reads.

```ts
metadata:
    part.signature || part.call_id || part.originAuthority
        ? {
                signature: part.signature,
                callId: part.call_id,
                details: part.details,
                ...(part.originAuthority === undefined
                    ? {}
                    : { originAuthority: part.originAuthority }),
          }
        : undefined,
```

Constraints honoured:

- **No new authority field, identity service or registry.** The existing
  `ThinkingContent.originAuthority` / `REASONING_METADATA_ORIGIN_KEY` /
  `metadata.originAuthority` triple is reused verbatim.
- **`mayReplayOpaqueReasoning` is NOT weakened.** It is untouched.
- **No fabricated authority.** The authority is carried only when it is
  actually present; a record written before the field existed simply has none
  and remains fail-closed.
- **The authority never reaches the provider.** It is consumed by the outbound
  conversion and is not forwarded.

## 4. Conservation

Verified by the permanent witness
(`compat.origin-authority-continuity.test.ts`) and by the converted
characterization witness (`output-exhaustion-wire-forensics01.test.ts`):

| Property | Result |
|---|---|
| Same-route signed reasoning reaches the actual HTTP body | PASS (2 blocks, real signatures, real thinking text, real ordering) |
| Unknown-origin reasoning remains excluded | PASS (no signature on the wire) |
| Incompatible-origin reasoning remains excluded | PASS (no signature on the wire) |
| Unsigned reasoning remains excluded where required | PASS (unchanged; owned by CMP-09) |
| Exact thinking text, signature and block ordering preserved | PASS |
| Tool-call and tool-result identities unchanged | PASS (`call-01`, `read_files` intact) |
| `originAuthority` never appears on the provider wire | PASS (raw body contains neither the authority nor the key) |
| Canonical history remains unchanged | PASS (the caller-held history is byte-identical after dispatch) |

The defect-characterization witness was CONVERTED into a permanent
conservation assertion: the assertion
`DROPS the origin authority when projecting through the compat adapter` became
`CONSERVES the origin authority when projecting through the compat adapter`,
and it now asserts that BOTH signed blocks carry the established authority.

**No intentionally failing default-suite tests.** The full `@cline/llms` suite
is byte-identical to the pre-ACT baseline except for the pre-existing
`ai-sdk-reasoning.test.ts` failures (see §6).

## 5. Historical attribution

Four distinct classes are distinguished, and they are NOT collapsed:

**(a) Fully observable SDK captures.** The frozen archive's 88 captures are
`captureStage: "ai_sdk_prompt"`. The capture is emitted at `ai-sdk.ts:2900`,
which runs AFTER `buildAiSdkRequestMessages()` (`ai-sdk.ts:2875`) — and
`buildAiSdkRequestMessages` is the call that applies the origin-authority
gate. So these captures are **post-gate and PRE-wire-serialization**. Their
content is the AI SDK's converted messages, not the HTTP body.

**(b) Size-truncated captures.** The last 30 of the 88 captures are
size-truncated; their generation settings are NOT observable.

**(c) Actual historical dispatch-path identity.** The historical run's
signatures were ABSENT from the archived captures. Because the captures are
post-gate, a post-gate absence does NOT by itself identify the compat
projection as the cause: the gate itself withholds the signature whenever the
origin is absent, whatever produced that absence. The archive therefore does
**not** establish the historical dispatch path.

**(d) Synthetic reproduction of the loss mechanism.** The RED witness is an
executed, synthetic reproduction through the REAL production compat dispatch
path. It establishes the MECHANISM (the compat projection drops the
authority, and the gate then withholds the signature), not the historical
occurrence.

**Disposition.** The compat adapter's origin-authority loss is
`REPRODUCED (SYNTHETIC_REAL_PRODUCTION_SEAM)` as a mechanism. The claim that
the compat adapter CAUSED the historical session's signature loss is
**NOT ESTABLISHED**, because the archived captures are post-gate and do not
identify the dispatch path that dropped the authority.

**No LIVE HTTP-body observation is claimed from SDK-prompt captures.** The
HTTP-body observation in this ACT is from the synthetic harness, where the
capture IS the wire body.

## 6. Qualification

| Gate | Result |
|---|---|
| Focused RED | FAIL as required (0 of 2 signed blocks on the wire) |
| Focused GREEN | PASS (5/5 new witness, 8/8 converted witness) |
| Affected suites | `compat.test.ts` 23, `ai-sdk-transport-continuation.test.ts` 8, shared 14, core 20, agents 15 — ALL PASS |
| `@cline/llms` full suite | 1246 PASS; the only failing file is `ai-sdk-reasoning.test.ts` (15 failures) — **IDENTICAL to the pre-ACT baseline**, verified by a `git stash` probe on the pristine tree. Pre-existing, not introduced here. |
| Typecheck | `@cline/llms` PASS |
| Biome | CLEAN on all three touched files |
| SDK rebuild | `bun run build:sdk` PASS (llms, ui, shared, core, agents) |

### CMP-09 coordination

CMP-09 has **no committed** implementation or evidence in this repository
(`git log --all`, `git ls-files` — confirmed again at this ACT's head),
consistent with §9.1 of the predecessor ACT. Nothing was imported and no
CMP-09 code is claimed.

The repaired replay-eligibility contract is now COHERENT with CMP-09's
WIRE-01 assertion:

- CMP-09's fixture supplies a signature but **no** `originAuthority`. Under
  the established fail-closed policy that grants NO replay authority, so the
  block is correctly withheld. That behaviour is unchanged by this ACT.
- CMP-09's WIRE-01 becomes satisfiable **only** when the fixture also carries
  the ESTABLISHED authority, which is the production contract. The compat
  projection no longer silently destroys that authority, so the compat path
  and the shared path now AGREE: a same-route signed block reaches the wire,
  and an authority-less one does not.

The two boundaries remain SEPARATE and their ownership is unchanged:
CMP-09 owns compaction-trigger causality and the budget-authority repair
(the UNSIGNED-block accounting, R-A); this ACT owns the compat
origin-authority conservation (the SIGNED-block loss).

## 7. Closure

```text
COMPAT_ORIGIN_AUTHORITY_CONSERVATION:  CONSERVED (authority now crosses the compat projection)
SIGNED_REASONING_WIRE_CONSERVATION:     SAME-ROUTE signed reasoning reaches the actual HTTP body (2/2, exact text/signature/order)
UNAUTHORIZED_REPLAY_DENIAL:             UNCHANGED (unknown-origin and incompatible-origin remain excluded)
HISTORICAL_DISPATCH_PATH_DISPOSITION:   NOT ESTABLISHED (archive is post-gate; compat cause NOT claimed)
CMP09_COORDINATION:                     REPLAY-ELIGIBILITY CONTRACT COHERENT; ownership unchanged; no CMP-09 code imported
FINAL_HEAD:                             (this commit)
TRACKED_DIRT:                           none beyond this ACT's own files
```

**Verdict:** `GO_COMPAT_REASONING_CONTINUITY`
