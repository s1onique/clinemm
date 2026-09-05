# 10 — Session-active profile persistence (Q-mechanical-2)

PRODUCTION HEAD = 97f49582e

This file answers the reviewer's Q-mechanical-2 from
`HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT`:

> "Where can `activeProfileId` persist per task/session using existing
> session metadata/state?"

## The failure mode the prior freeze had

The prior freeze used a single global `lastUsedProfileId` to mean
both "the active profile for THIS task" and "the default for new
tasks". The counterexample:

```text
Task A:  switch → Profile A
Task B:  switch → Profile B
(global lastUsedProfileId = B)
restart VSCodium
resume Task A
→ returns Profile B, not A
```

Global state collapses across tasks. To get the resume semantics
right, the session/task and the global state must be SEPARATE
records:

```text
SESSION_ACTIVE_PROFILE_ID  — per task/session; lives in the
                              per-session metadata that survives
                              restart
GLOBAL_DEFAULT_PROFILE_ID  — global setting; lives in globalState
                              (mirroring favoritedModelIds precedent)
```

These two never get conflated. The recon ACT body §21 already
defines the session binding contract; this file identifies the
persistence seam.

## Persistence seam candidates

Three places can carry the per-session `activeProfileId`. The
foundation ACT picks one (smallest-necessary extension).

### Candidate 1 — session manifest extension

The existing `CoreSessionConfig` snapshot is captured at session
start. Adding `activeProfileId?: string` to that snapshot is a
single-field schema extension. The snapshot is already per-session,
already survives restart (the snapshot is rebuilt from
`apiConfiguration` at session start, but the manifest carries
post-start changes).

Pros: smallest blast radius. Lives next to the rest of the session
shape. Already per-session.

Cons: the manifest is rebuilt at session start from
`apiConfiguration`. If `activeProfileId` is stored ONLY in the
manifest, a mid-session switch that bypasses the manifest rebuild
will lose it. The implementation must commit the activeProfileId
to BOTH the manifest AND a durable per-session metadata block.

### Candidate 2 — task metadata block in `taskHistory.json`

Each task already has a per-task metadata record in
`taskHistory.json`. Adding a `sessionMetadata: { activeProfileId?,
… }` block to that record gives a durable per-task seam.

Pros: per-task persistence; survives restart; reuses the existing
`taskHistory.json` infrastructure.

Cons: the task metadata block is read at task restore; it does not
necessarily propagate to the live session unless explicitly wired.

### Candidate 3 — separate per-session metadata file

`~/.cline/data/sessions/<sessionId>/metadata.json` carrying
`{ activeProfileId, … }`. Per-session, additive, isolated.

Pros: zero blast radius on existing files. Easy to debug.
Per-session atomicity is trivial.

Cons: new file pattern; needs a session-id-keyed storage helper
(mirrors the `workspaces/<hash>/workspaceState.json` precedent).

## Recommended decision (for the foundation ACT)

**Candidate 1 + Candidate 2 jointly.** The session manifest
carries the activeProfileId during the session lifetime (snapshot
truth), and `taskHistory.json` carries it across restart
(durable truth). This is the smallest-necessary extension that
covers both the in-session and the cross-restart cases.

Candidate 3 (separate per-session file) is the fallback if
candidate 1+2 proves too entangled with existing snapshot
machinery.

The recon does NOT pre-decide. The foundation ACT does the source
survey and freezes the persistence seam.

## Global default profile

`GLOBAL_DEFAULT_PROFILE_ID` is a NEW global state key, separate from
`SESSION_ACTIVE_PROFILE_ID`. It lives in `globalState.json`,
mirroring the existing `favoritedModelIds` precedent. It is updated
ONLY by:

- An explicit "Set as default" action in the Settings UI
- Profile management (creating a profile with "Make default" checked)

It is NOT updated by the footer quick-switch. Footer quick-switch
updates `SESSION_ACTIVE_PROFILE_ID` only.

EVIDENCE CLASS = STRUCTURAL — derives the persistence seam from the
                  existing task/session persistence contract; does
                  not depend on a live trace. Foundation ACT
                  does the source survey and freezes the seam.
