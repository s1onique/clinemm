# 01 — G0.2 bounded P1 correction: the ablation helper

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01`
**Scope:** test-local only. **No production file was touched.**

---

## 1. The defect, stated precisely

The ACT's G0.2 states the predecessor's bounded P1 as:

> "The existing test-local ablation helper inserts an adjudication into every
> assistant message without a matching text block. Correct it to target
> **exactly one identified adjudication-bearing message**."

The predecessor's helper in
`sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts`
was:

```ts
function testLocalRestoreAdjudication(
	messages: readonly MessageWithMetadata[],
	adjudication: string,
): MessageWithMetadata[] {
	return messages.map((message) => {
		if (message.role !== "assistant" || !Array.isArray(message.content)) {
			return message;
		}
		const hasAdjudication = message.content.some(/* ... */);
		if (hasAdjudication) {
			return message;
		}
		return {
			...message,
			content: [
				{ type: "text" as const, text: adjudication },
				...message.content,
			],
		};
	});
}
```

### 1.1 The measured effect

The canonical fixture `s1CanonicalHistory()` produces four messages:

| Index | Role | Content |
|---|---|---|
| 0 | user | the original finding |
| 1 | assistant | `[thinking, tool_use]` — **the adjudication-bearing turn** |
| 2 | user | the matching `tool_result` |
| 3 | assistant | `[text("Continuing.")]` — the preserved tail |

The predecessor helper prepended the adjudication to **every** assistant
message that did not already carry it. That is **messages 1 AND 3** — the
adjudication-bearing turn **and the unrelated preserved tail**.

**Two insertions where one was intended.** The A/B comparison therefore
measured "restore the adjudication into two places", not "restore exactly the
missing qualified adjudication", and the ablation's blast radius was
inflated: the preserved tail — a message with no relationship to the
witness — was made to carry the verdict.


---

## 2. The correction

The helper now takes an explicit target identity and restores **exactly one
block into exactly one message**:

```ts
const ADJUDICATION_MESSAGE_INDEX = 1;

function testLocalRestoreAdjudication(
	messages: readonly MessageWithMetadata[],
	adjudication: string,
	targetIndex: number = ADJUDICATION_MESSAGE_INDEX,
): MessageWithMetadata[] {
	const target = messages[targetIndex];
	// ... fails loudly when the target does not exist, is not an assistant
	//     turn, or does not carry the source-read tool call ...
	return messages.map((message, index): MessageWithMetadata => {
		if (index !== targetIndex) {
			return message;
		}
		return {
			...message,
			content: [
				{ type: "text", text: adjudication },
				...(target.content as ContentBlock[]),
			],
		};
	});
}
```

### 2.1 Requirement-by-requirement


---

## 3. The A/B/C ablation after the correction

The ablation compares three projections built from **identical** canonical
input, budget and policy:

| Arm | Input | Expected |
|---|---|---|
| **A** | original production projection (`agentic_summary`) | RED — no verdict token, no qualification token |
| **B** | identical projection + the bounded adjudication restored into the ONE identified message | verdict token **and** qualification token present |
| **C** | B with the restoration removed (i.e. A again) | RED returns |

The A-vs-B residual comparison (remove the restored block from B, compare the
remaining structured message lists) remains **exactly equal**, so the
restoration changes nothing but the adjudication.

---

## 4. Executable evidence

```bash
cd sdk/packages/core
bun x vitest run \
  src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts \
  --config vitest.config.ts
```

**Observed:** `Test Files 1 passed (1)` / `Tests 24 passed (24)` / exit 0.

The G0.2 additions are:

| Test | Asserts |
|---|---|
| `ABLATION A/B/C: A is RED, B carries the adjudication, C restores RED` | the original A/B/C contract **plus** the six new G0.2 invariants (one insertion, correct target, unchanged count/order, byte-identical tail, unchanged tool identity) |
| `ABLATION TARGETING: a mis-targeted restore fails loudly instead of restoring into the wrong message` | index 0 (user turn), index 3 (unrelated tail) and index 99 (out of range) are all **refused** with a descriptive error |

**RED preservation re-verified after the correction:**

```bash
bun run test:red:adjudication-continuity-red01
```
→ `Tests 5 failed (5)` / exit 1. The RED witness was **not** touched by the
correction.

---

## 5. Classification

| Claim | Label |
|---|---|
| The predecessor helper inserted the adjudication into two messages | **REAL** (read from the committed predecessor source) |
| The corrected helper inserts exactly one block into exactly one identified message | **REAL_PRODUCTION_SEAM** (executable) |
| A mis-targeted restore is refused | **REAL_PRODUCTION_SEAM** (executable) |
| The A/B/C ablation still shows RED → presence → RED with identical inputs | **REAL_PRODUCTION_SEAM** (executable) |
| The repair preserves the adjudicated finding's authority semantics | **NOT_EXECUTED** — no repair was deployed; see `03-mechanism-selection.md` |

| ACT requirement | How the correction satisfies it |
|---|---|
| **Exact message ID or explicit test-local identity** | The target is the explicit, test-local constant `ADJUDICATION_MESSAGE_INDEX = 1`, and the helper additionally requires that the target **carries the source-read tool call** `SOURCE_CALL_ID`. A mis-target therefore fails loudly instead of restoring into the wrong message. |
| **Exactly one inserted block** | The `map` callback returns the original message for every index other than `targetIndex`; only the target is rewritten, and it receives exactly one new block. Asserted: `insertedBlocks === 1` across the whole history. |
| **Unchanged message order** | The `map` preserves index order; asserted: `b.map(m => m.role)` equals `a.map(m => m.role)` and `b.length === a.length`. |
| **Unchanged tool-call/result identity** | The inserted block is a `text` block; no `tool_use` or `tool_result` block is touched. Asserted: the extracted tool-id sequence of B equals that of A, and still contains `SOURCE_CALL_ID`. |
| **Byte-identical remaining messages** | Every non-target message is returned by reference. Asserted: `JSON.stringify(b[b.length - 1]) === JSON.stringify(a[a.length - 1])`, and the tail does not contain the adjudication. |
| **A/B/C ablation still demonstrates RED → presence → RED** | Preserved and extended. See §3. |
