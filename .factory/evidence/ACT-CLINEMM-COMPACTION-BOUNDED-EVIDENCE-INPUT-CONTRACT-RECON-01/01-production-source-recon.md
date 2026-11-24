# 01 — Production source recon

ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01

## The inspected production surface

| Function | Location | Role in the loss |
| --- | --- | --- |
| `renderStructuredToolPayload()` | `sdk/packages/core/src/extensions/context/compaction-shared.ts:258-280` | **THE RESPONSIBLE TRANSFORMATION.** Renders one structured payload. |
| `renderToolResultBlocks()` | `compaction-shared.ts:308-342` | Applies the per-result character cap. |
| `flattenToolResultContent()` | `compaction-shared.ts:344-353` | Entry point of the rendering chain. |
| `truncateToolResultContentForCompaction()` | `compaction-shared.ts:355-379` | Typed-block truncation only. Does not touch structured payloads. |
| `serializeMessage()` | `compaction-shared.ts:387-436` | Emits `[Tool result]: <rendered>`. |
| `serializeConversation()` | `compaction-shared.ts:438-440` | The complete summarizer input text. |
| `buildSourceFileFact()` | `evidence-continuity.ts:590-653` | The ONE existing source-attributed excerpt class. |
| `isSensitiveSourceFilePath()` | `evidence-continuity.ts:406-411` | The existing credential-path rule. |
| `sanitizeOutcomeText()` | `evidence-continuity.ts:1379-1406` | The existing value-position credential sanitizer. |
| `classifyCommand()` | `evidence-continuity.ts:1268-1356` | The existing finite command allowlist. |
| `buildAgenticSummaryInputBudget()` | `agentic-compaction.ts:31-42` | The production summarizer-input budget projection. |
| `runAgenticCompaction()` | `agentic-compaction.ts:52-262` | The production summarizer request path. |
| `buildBudgetProjection()` | `budget-projection/project.ts` | The projection that DROPS every `thinking` block for the `agentic_summary` intent. |
| `applyVerifiedEvidenceToCompactedMessages()` | `evidence-continuity.ts:2356-2469` | The verified-outcome carry-forward. Takes a `sourceMessageCount` boundary. |
| `applyTaskContractToCompactedMessages()` | `task-contract.ts:358-445` | The task-contract carry-forward. Takes a `sourceMessageCount` boundary. |

## The loss boundary, quoted from the production source

`sdk/packages/core/src/extensions/context/compaction-shared.ts:258-280`:

```ts
function renderStructuredToolPayload(
	payload: Record<string, unknown>,
	index: number,
	toolName?: string,
): string {
	const status = classifyStructuredPayloadStatus(payload);
	const rawQuery = payload.query;
	const classification =
		typeof rawQuery === "string" ? classifyCommand(rawQuery) : "";
	const label = classification || `#${index + 1}`;
	const rawResult = payload.result;
	const sourceFileFact = buildSourceFileFact(payload, toolName);
	if (sourceFileFact) {
		return `[${status}] source-file ${sourceFileFact.path}: ${sourceFileFact.excerpt}`;
	}
	const approvedResult =
		typeof rawResult === "boolean"
			? `result=${rawResult}`
			: typeof rawResult === "number" && Number.isFinite(rawResult)
				? `result=${rawResult}`
				: OMITTED_STRUCTURED_RESULT_MARKER;
	return `[${status}] ${label}: ${approvedResult}`;
}
```

**The omission is not an oversight.** It is a deliberate confidentiality
decision, and the module documents it:

> "The rendering is DETERMINISTIC and preserves only independently verified
> facts: the payload status, a finite command classification, and approved
> scalar facts. Arbitrary command arguments and arbitrary output strings
> are never copied because regex redaction cannot make arbitrary data safe."

The reviewer is right that this must not be simply reverted.

## What the existing mechanisms already provide — and can be REUSED

The ACT forbids inventing a new command parser, a new evidence store or a
generalised extraction framework. The existing surface already provides
every primitive the repair needs:

| Existing primitive | What it gives | How the contract reuses it |
| --- | --- | --- |
| `isSensitiveSourceFilePath()` | The credential-path rule | The contract's admission rule calls it UNCHANGED. |
| `sanitizeOutcomeText()` | The value-position credential sanitizer | The contract calls it UNCHANGED on the bounded excerpt. |
| The inline approved-scalar rule | The finite boolean/number rule | The contract reproduces it EXACTLY, so no new scalar channel exists. |
| The inline status classifier | The succeeded/failed/unknown vocabulary | The contract reproduces it EXACTLY, so the summarizer sees one status language. |
| `buildSourceFileFact()` | The source-attributed excerpt concept | The contract generalises the CONCEPT, not the mechanism, and keeps the mechanism OFF by default. |
| `classifyCommand()` | The finite command allowlist | UNCHANGED and still insufficient: a `cd <path> && <cmd>` chain classifies empty because the `cd` segment's path makes the chain ambiguous under the existing rules. The contract does NOT depend on the classification for admission. |

## The two existing mechanisms that are OFF by default, and why that matters

`SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED` is `false`
(`evidence-continuity.ts:525`). The containment ACT
(`COMPACTION-EVIDENCE-FIDELITY-CONTAINMENT-01`) turned it off because:

> "Source attribution proves WHERE the bytes came from; it does not prove
> that those bytes are safe to retain or forward."

**This ACT does not switch it on, and does not switch it on by another
name.** The contract's admission rule is a DIFFERENT and stricter rule: the
excerpt must be a bounded, redacted, line-windowed observation, and the
exclusion of a credential-bearing SOURCE PATH still applies. The
measurement below shows the difference on the real workload: the real
payload at canonical index 201 contains a live-looking `REDSMS_API_KEY`
value, and neither the transcript-order nor the relevance-order projection
carries it.

## The boundary the predecessor's replay crossed

`applyVerifiedEvidenceToCompactedMessages(compactedMessages, canonicalMessages, { sourceMessageCount })`
derives its "boundary prefix" as `canonical.slice(0, boundaryCount)`. The
predecessor passed `canonicalMessages.length`, so the boundary prefix was
the WHOLE history — 2 messages past W1's boundary, 38 past W2's.

This ACT's correction is to pass the FROZEN PREFIX ITSELF as the canonical
collection, so the carry-forwards are structurally incapable of observing
post-boundary information. The property is asserted executably, not
asserted in prose.

## A PRODUCTION DEFECT FOUND BY THIS ACT (not repaired here)

The production `sanitizeOutcomeText()` applies a value-position credential
regex whose alternation backtracks CATASTROPHICALLY on a long body with no
match. A 500 000-character run of a single repeated character does not
terminate in reasonable time.

This was discovered by the ACT's own witness, which initially hung. It is a
property of the PRODUCTION sanitizer, which is shared with the
evidence-continuity module, so repairing it is a SEPARATE and wider change
than this ACT's scope.

The contract therefore BOUNDS FIRST and REDACTS SECOND: the body is cut to
the per-fragment budget, and only the bounded text reaches the sanitizer.
The confidentiality direction is the SAFE one — the truncation happens
before any byte could be published, and the sanitizer never sees more than
2 000 characters.

**Recorded as a separate finding. Not repaired by this ACT.**
