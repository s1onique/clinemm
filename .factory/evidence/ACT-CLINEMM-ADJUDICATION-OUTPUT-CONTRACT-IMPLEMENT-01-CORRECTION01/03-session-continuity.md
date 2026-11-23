# 03 — The session continuity and the multi-source compatibility

## P0 — the acquisition records are now DURABLE

The predecessor kept the acquisition records in an in-memory map owned by the
runtime host. A recreated host built a NEW EMPTY map, so:

    Session A:  afterTool -> acquisition record in Map A
                candidate -> accepted
                compaction -> adjudication retained

    Restart:   Session B -> new Map B (EMPTY)
                secretProvider -> same handle secret
                historical handle -> resolves successfully
                acquisition record -> ABSENT
                source revision -> UNBOUND
                accepted candidate -> DROPPED

Reusing the secret alone was insufficient: the handle resolved, but the
evidence it stood for had no provenance left to bind.

## The repair

The record now rides ON the canonical tool-result block, which is persisted
verbatim in the session's messages file. The ledger is therefore derived from
the CANONICAL HISTORY ALONE:

    buildAcquisitionEvidenceLedger(messages)

A recreated host restores the ledger by reading the persisted transcript —
with NO caller-supplied in-memory ledger and NO workspace re-read. The
persistence round-trip is exercised by the suite: the canonical history is
serialised to JSON and read back, exactly as the session service does.

The persisted record is UNTRUSTED input, so every field is validated by
`parseAcquisitionRecord()` and a malformed record is treated as ABSENT — which
is `UNBOUND` downstream, the fail-closed direction.

## The handle secret is host-supplied

The registry's secret is now supplied by the host
(`CoreAdjudicationConfig.secretProvider`), because the host owns the
session's lifetime and is the only party that can reproduce the same secret
for the same session id. A restored session therefore re-derives identical
handles.

When the host supplies NO secret, the registry reports
`isRestorable() === false`: the FAIL-CLOSED DEGRADED MODE. The handles are
valid for the lifetime of the process and a handle published before a restart
stops resolving. That direction is correct for SECURITY — an unresolvable
handle cannot authenticate anything — but it means the adjudication it
supported does not survive the restart. The distinction is REPORTED rather
than claimed away, and both branches are tested.

## P1 — the multi-source compatibility

The predecessor required the cited sources' CONTENT identities to agree:

    revision.revision !== first.revision ||
    revision.contentIdentity !== first.contentIdentity

`contentIdentity` describes an INDIVIDUAL FILE, so two different files at the
SAME repository revision normally have DIFFERENT content hashes. A candidate
citing two valid reads from two different files of the same repository state
— a state that really existed — was rejected as `STALE`.

The compatibility decision now uses the WORKSPACE identity:

    revision.revision !== first.revision ||
    revision.repositoryIdentity !== first.repositoryIdentity ||
    revision.workspaceRootIdentity !== first.workspaceRootIdentity

and the content identity is validated INDEPENDENTLY, per observed source:

    missing_content_identity:<toolUseId>:<path>

A source whose content identity was never pinned describes a file whose bytes
were never pinned, so it establishes nothing.

## The REDs

    verification/gate1-red-durable-restoration.txt   7 failures
    verification/gate2-red-multi-source-stale.txt    1 failure

The gate-2 RED reverts ONLY the comparison, keeping everything else fixed,
so it isolates the P1 defect exactly.
