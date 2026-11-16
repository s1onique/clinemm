# ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01-INSTALL-QUAL01

Status: `PASS_P1_CORRECTION_PROVEN` (code scope complete) —
installed qualification `NOT_EXECUTED` (see §6).

Predecessor: `ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01` (CPR01) —
`PASS_CORRELATION_REPAIR_PROVEN`, reviewed as `PASS_WITH_NONBLOCKING_RESIDUE`.

## 1. Why this ACT exists

The CPR01 factory review closed the P0 (synthetic prompt-to-run correlation) and left
one bounded P1 in the EVIDENCE plus two non-blocking residues:

| Reviewer finding | Class | Disposition in THIS ACT |
| --- | --- | --- |
| `CPR01-01` claims TWO consecutive continuation turns but its sequence is ONE explicit turn + ONE queued continuation. The receipt shows two `run-started` events but only ONE `continuation_started` association. The mandated two-continuation scenario was NOT exercised. | P1 (evidence) | §2 — corrected in the real-host witness, once, no new review round |
| `git diff --check` reports one extra blank line at EOF in `06-cpr01-executable-receipt.txt`. | P2 (residue) | §2 — fixed |
| Leamas digest reports an invalid `.factory/gate-summary.json` binding; its gate summary is explicitly non-authoritative. | P2 (residue) | §6 — actual test receipts are used; the non-authoritative digest is NOT substituted |
| Equal failing-file sets / equal failure counts do not strictly prove identical failing assertions within those files. The strongest established claim is "no new failing files appeared". | evidence limitation | §6 — the strongest claim is stated, not over-claimed |

## 2. Bounded P1 correction — the two-continuation scenario

The correction extends the EXISTING real-host witness
(`apps/vscode/src/sdk/__tests__/elm-pending-prompt-correlation-repair01.cpr01.c24-c-bridge.test.ts`,
arm `CPR01-01`) with ONE additional queued continuation, and asserts:

- three DISTINCT run IDs (one per executed turn),
- TWO correctly-correlated prompt IDs (one per continuation), each paired with the
  run that ACTUALLY executed that continuation,
- NO orphaned Elm prompt (every scheduled continuation prompt is consumed by exactly
  one `continuation_started`).

No production change is made for this correction: the CPR01 production repair is
already at HEAD and is not touched.

## 3. Exact-head installed qualification

The reviewer mandated the following sequence:

1. Perform the bounded P1 test correction (§2).
2. Build and package from the resulting exact source HEAD, OUTSIDE the ClineMM sandbox.
3. Verify the VSIX and `extension.js` SHA-256, then install into `codium-clinemm`.
4. In a FRESH disposable task, exercise a session replacement followed by TWO queued
   continuations.
5. Capture the actual `run-started`, `continuation_started`, `agent_turn_done`, Elm
   decision and committed task phase.
6. Require the header to transition from `Working` to `Completed`, with no outstanding
   obligations.
7. Keep the ORIGINAL incident evidence untouched and record the installed extension
   identity SEPARATELY.

## 4. Scope boundaries

- Do NOT repair the old incident's persisted state.
- Do NOT weaken Elm completion policy, C9/C10, BCB or session ownership.
- Do NOT fabricate a run id or a `run-started` delivery.
- Do NOT repair the Elm completion semantics — the remaining work is packaging,
  installation and REAL extension-host execution qualification.
- Do NOT substitute the non-authoritative Leamas gate summary for actual receipts.

## 5. Evidence

`.factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01-INSTALL-QUAL01/`

## 6. Execution record

### 6.1 What was executed

| Gate | Command | Result |
| --- | --- | --- |
| CPR01 real-host witness (corrected) | `bun run test:vitest:c2-4-c-bridge src/sdk/__tests__/elm-pending-prompt-correlation-repair01.cpr01.c24-c-bridge.test.ts` | **7/7 PASS** |
| OPPOR01 historical witness (unchanged) | `bun run test:vitest src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts` | **5/5 PASS** |
| Base typecheck | `bun run check-types` | **PASS** (exit 0) |
| Bridge typecheck | `bun run check-types:c2-4-c-bridge` | **5 observed vs 0 baseline — PRE-EXISTING, zero new from this ACT** (see §6.2) |
| Whitespace residue | `git diff --check` | **clean (exit 0)** |

### 6.2 The bridge-typecheck baseline drift is PRE-EXISTING

The bridge gate reports 5 diagnostics against a frozen baseline of 0. This ACT
contributes **ZERO** of them. Proof: the same gate was re-run with this ACT's
test change **stashed**, and produced a **byte-identical** 5-diagnostic set
(`completion-continuation-delivery-seam01.ccds01`, `pending-prompt-lifecycle-discriminator01.ocrrd01`,
`runtime-followup-resume-subscription-parity.frsp01{,-correction01}`,
`automatic-incident-export.ts`). None references the file this ACT touched.
The frozen baseline file being empty is a pre-existing baseline staleness
condition, NOT a regression introduced here. The baseline was deliberately
**not** refreshed, so no diagnostic was masked.

### 6.3 The corrected two-continuation witness — observed receipt

From `.factory/evidence/...-INSTALL-QUAL01/01-cpr01-corrected-witness-receipt.txt`:

```
runStartedRunIds        : run_1hHyNKkI, run_Mgdg2iyw, run_z9pgGfm5   (3 DISTINCT)
continuationStarted      : pending_1794849211018_Kknak -> run_Mgdg2iyw
                          pending_1794849211031_8RTsn -> run_z9pgGfm5
continuationScheduledIds : pending_1794849211018_Kknak
                          pending_1794849211031_8RTsn   (both consumed EXACTLY once)
agentTurnDoneRunIds     : run_1hHyNKkI, run_Mgdg2iyw, run_z9pgGfm5   (conservation agrees)
```

The reviewer's P1 is CLOSED: the mandated two-continuation scenario IS now
exercised, with three distinct run IDs, two correctly-correlated prompt IDs,
and no orphaned Elm prompt.

### 6.4 Installed qualification — NOT_EXECUTED

The installed-extension qualification (review §3 steps 2–7) was **NOT EXECUTED**
in this run. No build was produced, no VSIX was packaged, no artifact was
installed, and no live task was driven.

What was established by inspection only (NOT a qualification result):

- A `codium-clinemm` VSCodium instance was already running (launched 20:06)
  against `--extensions-dir ~/.vscodium-clinemm/extensions`.
- The extension is installed there as
  `s1onique.clinemm-4.1.16-5a1c485cb-f596742d5`, version string
  `4.1.16-5a1c485cb-f596742d5`, `extensions.json` source `vsix`, pinned.
- Its `dist/extension.js` SHA-256 is
  `014639926780b13636a47e2bde1f21ffb11f854c6cc2a7973cfd159b956b5f9d`.
- The agent sandbox CANNOT write to `~/.vscodium-clinemm/extensions/`
  (`touch` → `Operation not permitted`), consistent with the read-only-mount
  constraint recorded by earlier ACTs (BCB-CAPTURE01, BCB-CAPTURE-ACTIVATION01,
  BACKGROUND-EXEC-SAME-SANDBOX-*).

Because the installed artifact's identity string names commit `f596742d5`
(the PREVIOUS HEAD) and this ACT's commit `86a8cf2fd` is **test-only** — no
production source changed — the production `extension.js` content is expected
to be unchanged by this ACT. That expectation has **not** been verified
against a freshly built artifact, and is therefore NOT claimed here.

The installed qualification therefore remains **open**, exactly as the reviewer
scoped it: prove the fix survives packaging, installation and real
extension-host execution.

### 6.5 Non-authoritative digest

The Leamas digest's `.factory/gate-summary.json` binding is invalid and its
gate summary is explicitly non-authoritative. It was **not** substituted for
the actual test receipts; every gate result in §6.1 comes from a command this
ACT ran.

### 6.6 Milestone report

```
ENTRY_HEAD=f596742d5aedfd70a7482c7756f78b2a1201b1b4 ENTRY_TREE=0eb33b327979fc311b80a9e6691ee606fa35d5aa
SEAM=apps/vscode/src/sdk/__tests__/elm-pending-prompt-correlation-repair01.cpr01.c24-c-bridge.test.ts:CPR01-01
RED=not applicable (evidence correction, not a production RED)
CAUSE=CPR01-01 exercised ONE explicit turn + ONE queued continuation; the mandated TWO-continuation scenario was never run
CHANGE=apps/vscode/src/sdk/__tests__/elm-pending-prompt-correlation-repair01.cpr01.c24-c-bridge.test.ts (+ .factory evidence/act files)
GREEN=bun run test:vitest:c2-4-c-bridge <CPR01> -> 7/7 PASS; bun run test:vitest <OPPOR01> -> 5/5 PASS; bun run check-types -> PASS
ABLATION=bridge typecheck re-run with the change STASHED -> byte-identical 5-diagnostic pre-existing set (zero new)
SUBJECT_HEAD=86a8cf2fdcf2d1a2e29e1f009c1fad6420732ab9 (tree 60933e47f2ccb08b945b0bdf76b1e004864e552f, clean)
LIVE=NOT_EXECUTED (installed qualification open; sandbox cannot write ~/.vscodium-clinemm/extensions)
VERDICT=PASS (P1 correction proven) + installed qualification OPEN
```
