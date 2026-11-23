# 04 — Canonical persistence (G3, PROBE-3)

Executable source:
`sdk/packages/core/src/extensions/context/compaction.adjudication-output-contract.probe01.test.ts`
(`describe("PROBE-3 — canonical persistence")`)

```text
EXECUTION CLASS: REAL_PRODUCTION_SEAM
  (the REAL production persistence normalization and the REAL agent-message
   codec are invoked; the fixture is synthetic)
```

## Result: PASS — `CANONICAL_PERSISTENCE` is VERIFIED

Two independent production paths were exercised. Neither is a
hand-constructed canonical message substituted for the real path.

### Path 1 — the real persistence normalization

```ts
const { normalizeStoredMessagesForPersistence } = await import(
    "../../services/session-data"
);
const history = syntheticCanonicalHistory();
const persisted = normalizeStoredMessagesForPersistence(history);
```

This is the SAME function the production persistence service calls
(`UnifiedSessionPersistenceService.toPersistedMessages` and
`persistSessionMessages` both route through it).

Observed:

```text
persisted assistant text == the original envelope string   (byte-identical)
parse(persisted text)       == ok
```

### Path 2 — the real agent-message codec round-trip

```ts
const roundTripped = agentMessagesToMessagesWithMetadata(
    messagesToAgentMessages(history),
);
```

Observed:

```text
round-tripped assistant text == the original envelope string  (byte-identical)
```

### Why the round-trip is byte-stable

`agent-message-codec.ts` documents the invariant that matters here:

```ts
// A message that is already a single tool result needs no id
// disambiguation — the suffix only distinguishes the parts of a split
// message. Keeping the id verbatim makes restore/persist round-trips
// byte-stable; ids feed the compaction source-prefix hash, and a
// re-suffixed id silently invalidates saved compaction state (and grows
// without bound across restores).
```

The `text` block takes the `contentBlockToAgentPart` /
`agentPartToContentBlock` path (`{type:"text"}` -> `{type:"text", text}` ->
`{type:"text", text}`), so the carrier text is untouched in both
directions.

## The provider-visible continuation

`MessageBuilder.buildForApi()` was exercised on the same canonical history
and the provider-visible projection contains the envelope:

```text
JSON.stringify(providerMessages) contains "adjudication_candidate"
JSON.stringify(providerMessages) contains "manual_enforcement_only"
```

The assistant-text truncation in `buildForApi` uses
`DEFAULT_MAX_ASSISTANT_TEXT_CHARS = 200_000`, and the contract caps a
carrier at 2,000 characters, so the envelope is 100x below the limit. The
`maxAssistantToolMarkupChars` path (12,000) only triggers on REPEATED
tool-call markup, which a strict JSON envelope does not contain.

## Canonical persistence conclusion

```text
CANONICAL_PERSISTENCE: YES
CANONICAL_PERSISTENCE_UNVERIFIED: NOT TRIGGERED
```

The published carrier survives the real canonical persistence path and the
real provider-visible projection VERBATIM. A future implementation does
NOT need a new persistence subsystem, a new content-block type, or a side
channel to carry the artifact.
