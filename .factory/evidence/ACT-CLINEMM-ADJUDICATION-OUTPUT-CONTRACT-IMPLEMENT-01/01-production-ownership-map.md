# 01 — The production ownership map

Every owner below was established by READING the production source at the
entry head, not by inference.

```text
PUBLICATION_OWNER:        the provider adapter -> canonical assistant `text`
                          block. The canonical history is owned by
                          `MessageWithMetadata`; the provider stream is
                          converted by the adapter in `@cline/llms` and
                          persisted through
                          `sdk/packages/core/src/runtime/config/agent-message-codec.ts`.

CANONICAL_ID_OWNER:      the provider issues the tool-call id. The runtime
                          stores it in the canonical `tool_use.id` and
                          `tool_result.tool_use_id`. The provider wire
                          format carries it as `toolCallId` on BOTH the
                          `tool-call` and the `tool-result` part
                          (`sdk/packages/shared/src/llms/ai-sdk-format.ts`,
                          lines 808-834), so the id IS model-visible.

TOOL_RESULT_OWNER:       the canonical `tool_result` block. The success
                          classification is owned by
                          `classifyToolResultStatus()` in
                          `sdk/packages/core/src/extensions/context/evidence-continuity.ts`.

SOURCE_REVISION_OWNER:   `createWorkspaceGitReader()` in
                          `sdk/packages/core/src/services/workspace/workspace-manifest.ts`
                          owns `headSha()`, `symbolicBranch()` and
                          `worktreeStatus()`. The runtime — never the model
                          — derives the revision from these.

TASK_VOCABULARY_OWNER:   NONE IN PRODUCTION at the entry head. There was no
                          `finding_id`, `findingId` or `qualification_code`
                          anywhere in `sdk/packages/core/src`,
                          `sdk/packages/shared/src` or
                          `sdk/packages/agents/src`, and no `adjudication`
                          symbol in any production module. The vocabulary
                          was TEST-LOCAL. This ACT therefore makes it a
                          HOST-SUPPLIED config input
                          (`CoreAdjudicationConfig.vocabulary`) rather than
                          installing a global vocabulary.

COMPACTION_PROJECTION_OWNER: `createCompactionStateAwarePrepareTurn()` in
                          `sdk/packages/core/src/extensions/context/compaction.ts`.
                          It owns the enrichment chain
                          `applyTaskContractToCompactedMessages` ->
                          `applyVerifiedEvidenceToCompactedMessages`, and
                          the ACT's
                          `applyAdjudicationCarryForward` was added to the
                          SAME chain, at all three sites (first compaction,
                          re-compaction, provider-visible restoration).

PERSISTENCE_OWNER:       `createSessionCompactionState()` /
                          `projectSessionCompactionState()` in
                          `sdk/packages/core/src/session/models/session-compaction.ts`.
                          The sidecar schema was NOT changed: the ACT
                          reuses the existing `compaction_summary` message
                          and the existing `metadata.summary` field.

PROVIDER_DISPATCH_OWNER: `MessageBuilder.buildForApi()` in
                          `sdk/packages/core/src/session/services/message-builder.ts`,
                          then `messagesToAgentMessages()` and
                          `toProviderVisibleMessages()`.
```

## G1.1 — The publication boundary

```text
Provider response
  -> adapter content blocks (`@cline/llms` stream chunks)
  -> canonical assistant `text` block
  -> session persistence (`normalizeStoredMessagesForPersistence`)
```

A structured assistant-text candidate can be observed in the canonical
`assistant` message's `text` block WITHOUT inspecting a `thinking` block.
The predecessor's probe established that this carrier survives
persistence and the agent-message codec round-trip byte-identically.

## G1.2 — The evidence identity boundary

```text
Provider-issued tool call
  -> canonical tool_use.id
  -> tool execution
  -> canonical tool_result.tool_use_id
  -> model-visible representation (`toolCallId` on the wire)
  -> source identity
```

The CRITICAL finding of this trace: the canonical id IS on the wire, but
the predecessor's live receipts show the model does NOT quote it back. It
wrote `call_1`, `read_files_1` and a synthetic filename label. So
"the runtime stores an exact id" does NOT imply "the model can name it".

That is why the ACT issues an opaque, session-scoped HANDLE that the
runtime maps back to the canonical id EXACTLY, rather than requiring the
model to reproduce the provider's identifier.

## G1.3 — The compaction boundary

```text
Canonical history
  -> agentic summary-input projection (`buildBudgetProjection`,
     `policyIntent: "agentic_summary"`, `dropThinkingBlocks: true`)
  -> generated summary
  -> task-contract enrichment
  -> verified-outcome enrichment
  -> session-compaction sidecar
  -> MessageBuilder.buildForApi()
  -> provider request
```

The smallest existing place where deterministic adjudication continuity can
be applied without mutating canonical history is the enrichment chain
INSIDE `createCompactionStateAwarePrepareTurn`. The ACT's section is
attached to the EXISTING `compaction_summary` message and updates
`metadata.summary` and the provider-visible `content` together, exactly as
the task-contract carry-forward does.

## G1.4 — The existing representation contract

The synthetic fixture's `S1`, `manual_enforcement_only` and the other codes
are NOT automatically valid global vocabulary, and this ACT does not make
them so.

The production system CAN establish an authorized task-scoped vocabulary
without an unrelated new protocol: the vocabulary is a HOST-SUPPLIED
CONFIG INPUT (`CoreAdjudicationConfig.vocabulary`), carried on the existing
`CoreSessionConfig`. The runtime never derives authoritative vocabulary by
scanning thinking, tool output or free-form source text.

Without a supplied vocabulary, `resolveAdjudicationCandidate()` returns
`candidate_accepted: false` with `reason: "no_authorized_vocabulary"`.
The ordinary agent path is unchanged because no host supplies a vocabulary
by default.

## G1 exit — no `HALT_SCOPE_EXPANSION`

No new public tool, provider protocol field, persistence subsystem or
cross-session state service was required. The mechanism is:

- one new production module (`adjudication-continuity.ts`);
- one new config input (`CoreAdjudicationConfig`);
- one new compaction projection (the adjudication section), attached to
  the EXISTING `compaction_summary` message;
- one existing hook surface (`config.hooks.beforeModel`) for the
  model-visible handle projection.
