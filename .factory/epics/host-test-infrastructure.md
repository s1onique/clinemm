# EPIC-HOST-TEST-INFRASTRUCTURE

> Host-orchestrated, unsandboxed end-to-end test runner that lets a ClineMM authoring process ask the host to run a bounded corpus of commands / tests / live captures and return machine-readable results. See `.factory/epic-board.md` for the active index.

## Current status

- Status: ACTIVE — fresh epic opened at FUTURE-BACKLOG-CENSUS01 (2026-08-27). No ACT authored yet; `HOST-TEST RUNNER` is the working label and remains a label until canonical ACT ID is assigned per FACT-001 in `.factory/epics/factory-infrastructure.md`.
- Priority: P1 (substrate for several independent ACTs; without it, real-kernel Seatbelt probes, fresh VSIX dogfood, live approval-UI capture, classic-protection qualification, and any test that cannot run inside a Seatbelted ClineMM all remain unqualifiable)
- Current frontier: `HOST-TEST RUNNER` recon (working label).
- Blocked by: n/a (the runner is itself the unblocker for the dependents below).

## Contract / durable conclusions

- **Purpose.** A separate, host-orchestrated test runner is the natural next layer above the substrate probes. It provides a single bounded dogfood artifact per ACT, replacing per-test `skipIf(!HAS_SUBSTRATE)` caveats with explicit `HOST_REQUIRED` qualification.
- **Trust model.**

```text
sandboxed Cline/Codium authoring process
        ↓ request host-side qualification
unsandboxed host-side runner
        ↓ bounded command/test corpus
machine-readable result (JSON / JSONL)
        ↓ consumed by the authoring process
```

- **Inputs are bounded.** The runner accepts a declared corpus (commands + expected exit codes + optional timeouts); it does **not** accept arbitrary shell from the agent. The corpus is part of the canonical ACT contract, not a side-channel.
- **Outputs are machine-readable, not natural-language.** Failures must be classified (exit code, signal, expected-vs-actual, captured-output diff) so an ACT can read the result without human transcription.
- **Audit trail.** Every runner invocation must log: ACT ID, source HEAD, corpus file path, runner version, host OS / kernel, start/end wall time, full result. The log is appended to `.factory/evidence/<ACT>/` (local-by-default per `ACT-CLINEMM-FACTORY-BOARD-DURABILITY-AND-FACTORIZE-INTAKE01`).
- **No widening of authority.** The runner runs as the host user; the runner does not gain Seatbelt privileges the user does not have, and it does not use the runner as a covert YOLO bypass.

## ACT ledger

| ACT / ID | Verdict | Head | Purpose |
|---|---|---|---|
| `HOST-TEST RUNNER` (working label) | OPEN / HIGH | — | Author the host-orchestrated runner; ship the corpus/result schema; one minimal working invocation per dependent ACT |
| (no concrete dependent ACTs yet) | — | — | The dependents below (real-kernel Seatbelt probes, fresh VSIX dogfood, live approval-UI capture, classic-protection qualification, non-Seatbelt tests) gain `HOST_REQUIRED` qualification *once* this runner exists |

## Open work

- **`HOST-TEST RUNNER`**. Status: OPEN / HIGH. The working label appears on board row 18 (`.factory/epics/safe-yolo-seatbelt.md`) and on the Current frontier. Authoring ACT must ship: (a) the runner binary / script, (b) the corpus/result schema, (c) at least one minimal invocation per dependent ACT (real-kernel Seatbelt probe + fresh VSIX dogfood + live approval-UI capture), (d) the audit-log contract above.
- **Reclassify `skipIf(!HAS_SUBSTRATE)` callers.** Once the runner exists, prior per-test Vitest skip conditions can be migrated from `SKIP` (non-Darwin CI) to `HOST_REQUIRED` (via runner; the runner result is the evidence). Migration is a *separate* ACT and is not part of the runner ACT.

Known dependents (not ACTs yet — they are use cases that gain a runner once it exists):

- Real-kernel Seatbelt probes (currently RED-on-kernel, GREEN-on-kernel inside the substrate probes).
- Fresh VSIX dogfood (already used in `ac40e4399` evidence; no generic runner yet).
- Live approval-UI capture (per upstream issue #13114: the prompt occurs AFTER file creation).
- Classic-protection qualification (once `ACT-CLINEMM-CLASSIC-PROTECTION-RECON01` lands).
- Any test that cannot run inside a Seatbelted ClineMM authoring process.

Reopen / new-work conditions:

- A Seatbelt / approval / classic-protection ACT needs host-only evidence and the runner does not yet cover the required corpus (→ new runner ACT scoped).
- The runner is observed widening authority / leaking secrets / being used as a covert bypass (→ HALT the runner ACT and any consumer).

## Deferred work

None.

## Historical detail

Epic opened by `ACT-CLINEMM-FACTORY-FUTURE-BACKLOG-CENSUS01` (this commit). The working label `HOST-TEST RUNNER` already appears on board row 18 (`.factory/epics/safe-yolo-seatbelt.md`); this epic gives the working label a canonical detail file so the lane has durable backlog rather than a single-row reference.