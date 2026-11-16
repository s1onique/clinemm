# ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01-INSTALL-QUAL01

Status: `IN_PROGRESS`

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
