# 00 — Entry and source identity

```text
ACT:      ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02
ENTRY:    5d6ff6e539c5bdc9f7ee461baa1ff15f0b417fa3
          ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01
VERDICT:  GO_PACKAGING
```

## The entry state

The entry head carried the CORRECTION01 trust boundary: the
`tool_observed` assurance was derived from ATOM-SCOPED SUPPORT against a
closed table of six observation atoms against three tool classes.

## The reviewed source

```text
sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/evidence.ts
  - interpretCanonicalEvidence(): the interpreter under review
  - OBSERVATION_ATOM_REQUIRED_CLASS: the atom -> tool-class table
  - collectCanonicalToolEvents(): the canonical tool-event ledger

sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/publication-gate.ts
  - GateEvidence.maximumAssuranceFor: the interpreter seam
  - gateClosedProposals(): the publication gate

sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/runtime.ts
  - runPckAttempt(): the production attempt
```

## The reviewed defect

The interpreter verified three properties — identity, execution success
and tool class — and never examined the actual result's meaning. It did
not even receive the selected `argument`.

```text
const supporting = events.some(
    (event) =>
        observed.includes(event.toolCallId) &&
        event.succeeded &&
        event.evidenceClass === requiredClass,
);
```

## The production mechanism the correction REUSED

The correction did NOT write a semantic verification engine. It reused a
production, runtime-owned, deterministic, fail-closed classifier that
already exists in the evidence-continuity module:

```text
sdk/packages/core/src/extensions/context/evidence-continuity.ts
  - classifyCommand(command): a FINITE-ALLOWLIST command CLASSIFICATION
  - COMMAND_CLASSIFICATION_ALLOWLIST / COMMAND_SUBCOMMAND_ALLOWLIST
```

`classifyCommand()` reduces a command line to a finite allowlist entry
(`helm template`, `make build`, `git status`, ...) and is already the
mechanism the rest of the system uses to decide that an operation was
verified. It carries no user-controlled text and fails closed on an
ambiguous shell chain.

There is NO import cycle: `evidence-continuity.ts` imports only from
`@cline/shared` and `../../session/models/session-compaction`.
