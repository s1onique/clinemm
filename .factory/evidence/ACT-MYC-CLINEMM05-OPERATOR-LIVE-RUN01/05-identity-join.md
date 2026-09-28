# 05 — Identity Join (LIVE-E, operator observes)

## §13 LIVE-D: identity join

The "identity join" is the join between the host Cline session id
(S, the Codium chat-session id) and the various session-id keys used
inside the prime path. All five keys must be equal to S for the join
to be clean.

```text
LIVE_SESSION_ID                = S              (PENDING_OPERATOR_LIVE_RUN)
MYC_CHILD_SESSION_ID           = S              (PENDING_OPERATOR_LIVE_RUN)
PRIME_RECORDER_SESSION_ID      = S              (PENDING_OPERATOR_LIVE_RUN)
SNAPSHOT_SESSION_ID            = S              (PENDING_OPERATOR_LIVE_RUN)
BEFOREMODEL_LOOKUP_KEY         = S              (PENDING_OPERATOR_LIVE_RUN)
BEFOREMODEL_LOOKUP_HIT         = true           (PENDING_OPERATOR_LIVE_RUN)
```

Required:

```text
all session IDs = S
BEFOREMODEL_LOOKUP_HIT = true
```

Failure boundaries:

```text
any join mismatch      -> HALT_LIVE_IDENTITY_JOIN_REGRESSION
recorder lookup miss   -> HALT_PRIME_RECORDER_LOOKUP_MISS
```

## What each key means

- `LIVE_SESSION_ID`: the Codium chat session id S, taken from the URL
  or the session-listing view.
- `MYC_CHILD_SESSION_ID`: the `MYC_SESSION_ID` env var on the spawned
  `myc mcp` stdio child. Verified via:
  ```bash
  ps eww -p <MYC_PID> | tr ' ' '\n' | grep '^MYC_SESSION_ID='
  ```
- `PRIME_RECORDER_SESSION_ID`: the `acquisition.recordedPrime.snapshotSessionId`
  field of the diagnostic snapshot. The recorder stores the prime
  keyed by the snapshot session id.
- `SNAPSHOT_SESSION_ID`: the `lookup.snapshotSessionIdPresent` field.
  This is the id embedded in the prime packet itself.
- `BEFOREMODEL_LOOKUP_KEY`: the session id the `beforeModel` hook uses
  to look up the prime in the recorder.

The identity join is proven code-level by
`myc-prime-automation.identity-join.red.c24-c-bridge.test.ts`
(ACT-MYC-CLINEMM02-C-CORRECTION02). The RED→GREEN provenance is
`hostSessionId != conversationId` correctly joins to the snapshot
session id when the recorder uses the host session id. Live evidence
required to convert code-level to live-proven.