ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01 / 06-live-qualification

PHASE 11 — LIVE QUALIFICATION

STATUS: OPERATOR-RUN

This dev environment lacks the VSCodium + Nix wrapper + isolated
user-data-dir infrastructure required to execute the same
production-shaped launch path that produced the historical
BAD=99006fbcc native Extension Host OOM reproduction. Per the
predecessor ACT pattern (see
`.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01/05-live-ablation.md`),
live qualification is operator-executed against the bundled VSIX.

SPECIMEN
  = dist/dogfood/clinemm-4.1.16-0a97b445c.vsix
  SUBJECT_HEAD = 0a97b445c (post-CORRECTION01)
  Version      = 4.1.16
  sha256        = ab4ddfffe825826a573b47b553407aaa40e921dad67c798ee369f5d245ab2037
  Size          = 14627805 bytes (~13.95 MB)
  Built on      = 2026-09-25 from the CORRECTION01 commit (P1
                  deriveOrigin precedence fix + conservation
                  assertions)

REQUIRED EVIDENCE
  LIVE                       = PASS_DELIVERY_SEMANTICS_REPAIR_LIVE_QUALIFIED
  REAL_PRODUCTION_SEAM       = local-runtime-host.ts:1172 (runTurn) +
                               pending-prompt-service.ts:487 (drain)

PROCEDURE
  1. Install the bundled VSIX:
     - Same VSCodium install path used for the historical
       BAD=99006fbcc reproduction.
     - VSIX path: dist/dogfood/clinemm-4.1.16-0a97b445c.vsix
     - sha256: ab4ddfffe825826a573b47b553407aaa40e921dad67c798ee369f5d245ab2037
     - After install, the extension should be at version 4.1.16.

  2. Record the installed extension's
     `extension/dist/extension.js` sha256 and confirm it equals
     the extracted VSIX sha256 (26c353a3f071e34fa0bea9351e06faf9ce802ed06597dd0d8f2ba9dff3433c9c).
     Proves the install path didn't transform the bundle.

  3. Run the SAME production-shaped workload that produced
     BAD=99006fbcc (the historical native OOM):
     - Use the same ClineMM Nix wrapper, isolated user-data-dir,
       and proxy/env shape as the BAD reproduction.
     - Duration >= predecessor's frozen workload duration.

  4. Capture:
     - Extension Host PID + start/end timestamps
     - main.log + renderer.log relevant lines
     - Any DiagnosticReport if a crash occurs
     - ClineMM_OOM_DISC01_ATTEST lines (none — predecessor's
       attestation is removed)

CLASSIFICATION (RESTORED-only — no ABLATED this time, since
the ablation seam no longer exists)

  If Extension Host survives the full window:
    classification = PASS_DELIVERY_SEMANTICS_REPAIR_LIVE_QUALIFIED
    verdict         = PASS_DELIVERY_SEMANTICS_REPAIR

  If crash occurs with the same native OOM signature
  (EXC_BREAKPOINT / SIGTRAP, code 5, VSCodium Helper (Plugin),
  PartitionAlloc/V8 fatal OOM):
    classification = HALT_REPAIR_NOT_SUFFICIENT
    next action    = CAPTURE_INSUFFICIENT — the bounded repair
                     is necessary but not sufficient; a deeper
                     structural cause must exist.

  If crash occurs differently:
    classification = CAPTURE_INSUFFICIENT

  If historical failure does not reproduce:
    classification = NOT_REPRODUCED

LIVE-QUALIFICATION PASS CRITERIA

  PASS_DELIVERY_SEMANTICS_REPAIR requires ALL of:
  - [P1] repaired artifact survives the full frozen workload window
  - [P2] no equivalent native Extension Host OOM reproduces
  - [P3] the repaired production seam was exercised (verify via
         ClineCore debug dump `pendingPromptsController.drain`
         observed at least once with a non-empty queue, OR via
         post-mortem log inspection of the
         `pending_prompt_submitted` events)
  - [P4] required CCARD / origin correlation remains functional
         (verify via the dogfood CCARD JSONL — drained turns
         should have `origin: "pending_prompt_drain"` derived
         from `jobId` presence per the new deriveOrigin contract)

SCRUTINY OF (P4) IN PARTICULAR

  The deriveOrigin change moves C7/C8 origin derivation from
  `delivery`-based to `jobId`-presence-based. If the live
  diagnostic shows C7/C8 records with `origin: "explicit_user"`
  for what should be drained turns, then the `jobId` is not
  reaching the `runTurn` call site — this would be a
  HALT_CORRELATION_REGRESSION.

  Verify by inspecting the CCARD JSONL for the expected
  pattern: any drained turn (originating from a terminal
  wake) MUST have `origin: "pending_prompt_drain"` at C7 and C8.