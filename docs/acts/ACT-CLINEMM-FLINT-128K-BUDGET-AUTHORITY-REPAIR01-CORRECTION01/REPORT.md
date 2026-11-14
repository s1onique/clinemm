# ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01-CORRECTION01

**Verdict: `CORRECTION01` PASS — the codec conservation defect is repaired.**
**The 128K budget repair itself was NOT reopened.**

Commit: `281b379d016b9d692e94fd149ccee70fc51358cf`
Parent (the reviewed commit): `477b09c83d62f0c3a9d92a4a09d4ec4299c36726`

---

## 1. The defect

The 128K budget repair extracted the provider-message codec into
`@cline/shared` (`toProviderVisibleMessages`, `sdk/packages/shared/src/llms/request-budget.ts`)
so that the budget authority and the provider codec measure and emit the SAME
representation. The core codec was changed to delegate to the shared
function.

The extraction silently changed the handling of NON-STRING image payloads.

**Before** — `sdk/packages/core/src/runtime/config/agent-message-codec.ts` at `477b09c83^`:

```ts
case "image":
  return typeof part.image === "string"
    ? {
        type: "image",
        data: part.image,
        mediaType: part.mediaType ?? "image/png",
      }
    : undefined;
```

**After** — the extracted shared implementation:

```ts
case "image":
  return {
    type: "image",
    data: typeof part.image === "string" ? part.image : "",
    mediaType: part.mediaType ?? "image/png",
  };
```

`AgentImagePart.image` is `string | Uint8Array | ArrayBuffer | URL`
(`sdk/packages/shared/src/agent.ts:50`), so `Uint8Array`, `ArrayBuffer` and
`URL` are VALID typed inputs. The old codec omitted them; the new one emits
an EMPTY image block.

Two consequences on a production path:

1. **Broken provider-bound content.** A provider receives
   `{ type: "image", data: "" }` — an image with no payload.
2. **Altered image-token accounting.** The estimator charges a flat
   `ESTIMATED_TOKENS_PER_IMAGE` (1600) per image node regardless of payload
   (`sdk/packages/shared/src/llms/tokens.ts:21,54-62`), so the empty block is
   billed in full even though the image is meaningless.

This change was unrelated to the 128K budget repair and must not ship.

## 2. Why the shipped test could not catch it

`477b09c83` added a parity test asserting that the shared projection equals
the core codec. But the core codec DELEGATES to the shared projection, so
both sides necessarily share the same behavior. The parity test was green
while the shared projection was defective.

This was verified empirically, not just reasoned about: with the defect
reintroduced, the parity test (`"measures exactly the representation the
provider receives"`) still PASSED, while every newly added pinned case
FAILED.

## 3. The correction

Bounded, three files, `387 insertions(+), 5 deletions(-)`:

| File | Change |
| --- | --- |
| `sdk/packages/shared/src/llms/request-budget.ts` | Restore the pre-repair omission semantics: non-string image → `undefined`. |
| `sdk/packages/shared/src/llms/request-budget.test.ts` | **New.** Independent conservation suite (9 cases). |
| `sdk/packages/core/src/extensions/context/task-contract-budget-authority.test.ts` | Retain the parity test; **supplement** it with 4 cases pinned to the pre-repair contract, exercised through the production `agentMessagesToMessages()` codec. |

The restored form is byte-equivalent to the pre-repair contract:

```ts
case "image":
  return typeof part.image === "string"
    ? { type: "image", data: part.image, mediaType: part.mediaType ?? "image/png" }
    : undefined;
```

The regression cases cover `string`, `Uint8Array`, `ArrayBuffer` and `URL`,
and assert BOTH the emitted content AND the budget accounting:

- a string image is emitted verbatim (default `image/png`, explicit media type honoured);
- a non-string image is OMITTED — never an empty image block;
- sibling parts around an omitted image are preserved;
- a string image is charged the flat per-image cost;
- an omitted non-string image is charged NOTHING, and therefore cannot flip a
  fail-closed budget decision.

## 4. RED -> GREEN

With the defect reintroduced:

```
shared suite: 6 failed | 3 passed
core suite:   4 failed | 5 passed
```

With the correction applied:

```
shared suite: 9 passed
core suite:   9 passed
```

## 5. Gates

All gates pass; full detail in `evidence/gates.txt`.

| Gate | Result |
| --- | --- |
| Non-string image semantics restored | PASS |
| Independent cases for `string` / `Uint8Array` / `ArrayBuffer` / `URL` (content + accounting) | PASS |
| Parity test supplemented with pinned assertions | PASS |
| RED -> GREEN demonstrated | PASS |
| Core focused (codec / budget-authority / compaction / message-builder) | PASS — 269 passed, 1 skipped |
| Agents focused + full suite | PASS — 163 passed / 581 passed |
| Shared full suite | PASS — 568 passed, 6 skipped |
| TypeScript: shared / agents | PASS — exit 0 |
| TypeScript: core | PASS — 58 errors, IDENTICAL to the pre-correction baseline |
| Core full suite | PASS — same 18 pre-existing environment failures before and after |
| Exact-source VSIX rebuilt and hashed | PASS |
| Protected stash preserved, no push | PASS |

### Explicitly unchanged

`git diff HEAD~1 HEAD` over these files is EMPTY:

- `sdk/packages/core/src/extensions/context/compaction.ts` — 128K ceiling, summarizer config
- `sdk/packages/core/src/extensions/context/task-contract.ts` — fail-closed guard
- `sdk/packages/agents/src/agent-runtime.ts` — final-request check
- `sdk/packages/shared/src/llms/tokens.ts` — estimator

No change to the 128K ceiling, the Flint summarizer configuration, provider
routing, the retry policy, the estimator, or the fail-closed invariant.

## 6. Artifact

```
SOURCE_HEAD=281b379d016b9d692e94fd149ccee70fc51358cf
SOURCE_TREE=18424d1c22d5b4fc8566b11300d80b3e7d8ea0af
ARTIFACT=dist/clinemm-4.1.16-281b379d0.vsix
BYTES=65332419
SHA256=2a7bcd8ed02c85490a1515e93233085f2330b44bc77b41b703cd9932becfd518
```

The corrected codec is present in 9 bundled JS files (including the main
`extension/dist/extension.js` and the `@cline/core` / `@cline/agents` /
`@cline/shared` plugin-runtime bundles). The buggy empty-image-block form is
present in ZERO.

Full detail in `evidence/package.txt`.

## 7. Disposition

The `HALT_CODEC_CONSERVATION` hold is cleared for the codec-conservation
defect. The 128K budget-authority repair in `477b09c83` was NOT reopened and
its remaining assessment is unchanged.

**Next step (per the review):** proceed directly to the short Flint/Kapitsa
live qualification. That step is OUT OF SCOPE for this bounded correction and
has NOT been performed here.

The VSIX was NOT installed; the operator's installed extension was not
replaced. Nothing was pushed.
