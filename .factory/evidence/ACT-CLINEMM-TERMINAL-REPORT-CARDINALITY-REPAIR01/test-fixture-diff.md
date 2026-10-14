# ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01 — Test Fixture Diff

This document records the precise differences between the EXISTING
TRD01 fixture (`terminal-report-duplication-corr01.trd01.test.ts`)
and the NEW TRCR01 fixture
(`terminal-report-cardinality-repair01.trcr01.test.ts`).

## Why two fixtures

The existing TRD01 fixture is the pre-repair chat-surface
characterization. Its runtime-control user message between the two
`submit_and_exit` tool_uses carries **only** text content — it does
NOT carry the `metadata.runtimeControl / metadata.kind` fingerprint
that the live transcript actually emits. As a result, the existing
TRD01 fixture falls into the TRCR01 conservative-fallback path
("no metadata → both rows authoritative"), and the
pre-repair chat surface is preserved for that fixture.

The new TRCR01 fixture mirrors the LIVE persisted-transcript shape:
the runtime-control user message carries BOTH
`metadata.runtimeAuthority: "host_runtime_control"` AND
`metadata.kind: "completion_continuation_control"`. This is the
durable signal that the live task `1791892624249_io4fp` actually
records at msg 335. With this metadata, the bounded repair
correctly classifies the first `submit_and_exit` as HELD and
omits the authoritative-completion marker on its emit.

## The shape difference

**Existing TRD01 fixture (lines 149-159 of the test file):**
```ts
{
    role: "user",
    id: "runtime-control-1791893907292",
    ts: 1791893907292,
    content: [
        {
            type: "text",
            text: "<user_input mode=\"act\">A deferred completion is requesting observation of unconsumed terminal results.</user_input>",
        },
    ],
},
```

**New TRCR01 fixture (lines 75-80 of the test file):**
```ts
{
    role: "user",
    id: "runtime-control-1791893907292",
    ts: 1791893907292,
    metadata: { runtimeAuthority: "host_runtime_control", kind: "completion_continuation_control" },
    content: [{ type: "text", text: "<user_input mode=\"act\">A deferred completion is requesting observation of unconsumed terminal results.</user_input>" }],
},
```

**The single difference**: the new TRCR01 fixture adds the
`metadata: { runtimeAuthority: "host_runtime_control", kind: "completion_continuation_control" }` field on the runtime-control user
message. This is the durable BCB hold signal emitted by the host
runtime (see `apps/vscode/src/sdk/SdkController.ts:991` and
`background-notify-coordinator.ts:607-650`).

The two fixtures agree on every other field (role, id, ts,
content).

## Why this matters

The bounded repair scans the source transcript for the
`metadata.runtimeAuthority + metadata.kind` conjunctive
fingerprint. If the fingerprint is present, the corresponding
`submit_and_exit` is classified as HELD. If the fingerprint is
absent, the corresponding `submit_and_exit` is treated as
COMMITTED (conservative fallback).

This means:
- Existing transcripts (without the fingerprint) → unchanged
  chat surface (the pre-repair two-card behavior is preserved
  for legacy / unknown data).
- New transcripts (with the fingerprint, as the live task
  `1791892624249_io4fp` already carries) → exactly one
  authoritative card, matching the live view's cardinality.
- Live streaming → unchanged (the live `content_end` for
  completion tools in `agentEventToMessages` never threads
  the new `isAuthoritativeCompletion` flag, so the live
  "always stamp the marker" behavior is preserved).

## Fixture coverage

The new TRCR01 test covers five distinct scenarios that the
existing TRD01 characterization does not:

| Fixture | Description | Pre-repair | Post-repair |
|---------|-------------|-----------|-------------|
| A | Held submit_and_exit followed by committed submit_and_exit (with runtime-control marker) | 2 authoritative rows | 1 authoritative row |
| B | Single submit_and_exit (no runtime-control) | 1 authoritative row | 1 authoritative row |
| C | Two LEGITIMATE independent completion episodes (no runtime-control between) | 2 authoritative rows | 2 authoritative rows |
| D | Two HELD attempts followed by one committed (multiple runtime-control markers) | 3 authoritative rows | 1 authoritative row |
| E | Legacy / unknown runtime-control shape (no metadata) | 2 authoritative rows | 2 authoritative rows (conservative) |

Fixtures B, C, and E pass under both pre-repair and post-repair
production code — the bounded repair is a strict refinement of
the pre-repair behavior, not a regression. Only Fixtures A and D
flip from RED (pre-repair: incorrect two/three-card behavior)
to GREEN (post-repair: correct one-card behavior).
