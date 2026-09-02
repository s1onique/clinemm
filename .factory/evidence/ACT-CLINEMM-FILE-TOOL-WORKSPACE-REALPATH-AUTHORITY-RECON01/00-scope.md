# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 00-scope

ENTRY_HEAD       = 03af027a9 (P1 calibration + handoff commit)
SUBJECT_HEAD     = 03af027a9
CORRECTION_HEAD  = 03af027a9
CORRECTION_REASON = HALT_WRONG_AUTHORITY_CONTRACT
branch           = main
working tree     = clean at ENTRY (verified before this commit)
git diff --check HEAD = silent

## Scope (after bounded contract correction)

Bounded Q1-Q5 read-only recon of the **file-tool
capability-specific authorized-root escape** candidate. The
LIVE specimen is the reviewer's load-bearing evidence: a
model-controlled host file mutation created
`/Projects/Runtime/...` under a path that is **not in any
capability-specific authorized writable root** for the generic
editor / file mutation, while shell-side deletion later hit
Seatbelt denial.

The frozen invariant (per Factory reviewer C1
GO_FILE_TOOL_SECURITY_RECON + HALT_WRONG_AUTHORITY_CONTRACT):

```text
Every model-controlled mutation must remain inside the writable
root(s) explicitly authorized for THAT tool invocation.

NOT: every model-controlled mutation must remain inside the
     workspace.
```

Recon order is LIVE FIRST (Q1 binds the editor / write
tool the model actually uses), not the original 29-file
audit. The 29-file audit is deferred to a downstream ACT
if Q1-Q4 here expose a primitive worth centralizing.

Q1 stop condition: `FIRST_BROKEN_BOUNDARY = UNBOUND` until
the LIVE specimen is bound to a concrete production
handler.

NOT yet TRIAGE_BIND (no fresh TSWPD capture is required to
begin binding; the existing reviewer's evidence is
sufficient).

NOT yet RED (no production-seam test authored; Q5 is the
first RED opportunity and is gated on Q1-Q4).

Conservation: global-skill / global-rule / global-hook
creation are LEGITIMATE global-rooted tools and MUST stay
ALLOWED under the corrected contract (case G in the
corrected Q5 matrix).

Production files changed at ENTRY: 0

## Authority contract delta (this commit)

```text
BEFORE (217e7f53c):
  mission = workspace vs. outside-workspace containment
  A/B/C/D = traversal/absolute/global-clean/workspace-clean
  internal contradiction: case C allows global-base writes
  while the mission frames global-base as an escape

AFTER (03af027a9 / this commit):
  mission = capability-specific authorized writable root
  A/B/C/D/E/F = ALLOW, REFUSE-tx-out, REFUSE-..-out,
                REFUSE-abs, REFUSE-symlink, REFUSE-nonexistent
  G/H        = CONSERVATION (global-skill ALLOW,
                             workspace-clean ALLOW)
  case G keeps the case-C conservation while removing the
  internal contradiction
```

No production code change in this commit. The correction
is wording / mission / matrix reframing only. NEW_REVIEW_ROUND
= NO per the reviewer's verdict.
