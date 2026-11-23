# ACT-CLINEMM-MCP-SUPERVISION-V2-LIVE-QUAL01

ACT_ID: ACT-CLINEMM-MCP-SUPERVISION-V2-LIVE-QUAL01
VERDICT: PARTIAL_LIVE
ENTRY_HEAD: a493eff078ec5c8f2b6c874ad8f4a85009d1b64f
SUBJECT_HEAD: a493eff078ec5c8f2b6c874ad8f4a85009d1b64f
FINAL_HEAD: a493eff078ec5c8f2b6c874ad8f4a85009d1b64f
WORKTREE_STATUS: only this ACT evidence directory is untracked; no source changes

INSTALLED_VERSION: 4.1.26-a493eff07
VSIX_SHA256: d1ad8067ce1f00bd2a62b9e9c5afbeaebdd8689342c80a4fbea2838ff00b5354
INSTALLED_BUNDLE_SHA256: 48234a456deec83597575c2a8804a141ca17e5a3fca6456531f96c5586547d0f
SOURCE_IDENTITY_VERIFIED: YES (version suffix binds the artifact to ENTRY_HEAD; installed bundle hash matches the exact named VSIX's embedded bundle)

LIVE_SESSIONS: none; start rejected before session creation
FEEDBACK_RESULT: NOT_EXECUTED
CONTINUATION_RESULT: NOT_EXECUTED
QUEUED_FEEDBACK_RESULT: NOT_EXECUTED
CANCELLATION_RESULT: NOT_EXECUTED
APPROVAL_FENCE_RESULT: NOT_EXECUTED
IDEMPOTENCY_RESULT: NOT_EXECUTED
CONSERVATION_RESULT: Partial. Both pilot and fresh fixtures remained clean; mutation failed closed and no active task was present after rejection. Native UI and the remaining live invariants were not observed.

NEW_P0: none observed
NEW_P1: none observed
P2_RESIDUE: none

EVIDENCE_DIR: .factory/evidence/ACT-CLINEMM-MCP-SUPERVISION-V2-LIVE-QUAL01/
REOPEN_CONDITION: Arm the existing operator-issued mutation grant in the correct codium-clinemm profile/workspace. Provide native UI observation access for TaskHeader and the real approval fence. Then rerun G0; no architecture or implementation change is indicated by this run.
NEXT_ACT: Resume this ACT after G0 is satisfied. No subsequent Factory-supervision experiment is authorized by this partial qualification.

The live host listed mutation operations (`readOnly=false`), but the actual start request returned `control_seam_mutation_not_authorized`. The tool was not retried. This is a missing live precondition, not evidence of a V2 product defect. All L1-L8 mutation scenarios remain NOT_EXECUTED.
