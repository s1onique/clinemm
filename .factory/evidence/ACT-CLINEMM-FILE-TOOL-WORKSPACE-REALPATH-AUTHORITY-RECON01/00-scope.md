# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 00-scope

ENTRY_HEAD       = 03af027a9 (P1 calibration + handoff commit)
SUBJECT_HEAD     = 03af027a9
CORRECTION_HEAD  = 03af027a9
CORRECTION_REASON = HALT_WRONG_AUTHORITY_CONTRACT
CORRECTION2_HEAD = a127aed18 (this commit; P1 wording fix)
branch           = main
working tree     = clean at ENTRY (verified before this commit)
git diff --check HEAD = silent

## Scope (after bounded contract correction + P1 wording fix)

Bounded Q1-Q5 read-only recon of the **file-tool
capability-specific authorized-root escape** candidate. The
LIVE specimen is the reviewer's load-bearing evidence: a
model-controlled host file mutation created
`/Projects/Runtime/...` while shell-side deletion later hit
Seatbelt denial.

The frozen invariant (per Factory reviewer C1
GO_FILE_TOOL_SECURITY_RECON + HALT_WRONG_AUTHORITY_CONTRACT):

```text
Every model-controlled mutation must remain inside the writable
root(s) explicitly authorized for THAT tool invocation.

NOT: every model-controlled mutation must remain inside the
     workspace.
```

## Observed facts vs. UNBOUND (P1 fix)

```text
OBSERVED FACTS (durable, before any tool classification):
  F1. host mutation outside the intended Runity/srs tree
  F2. shell-side deletion of the same tree later denied
      by Seatbelt

UNBOUND UNTIL Q1/Q2:
  ACTUAL_TOOL                = UNBOUND
  ACTUAL_AUTHORIZED_ROOT     = UNBOUND
  AUTHORIZED_ROOT_VIOLATION  = NOT YET PROVEN
```

The two observed facts are STRONG but do NOT by themselves
classify the host mutation as a capability-root escape.
Classification requires Q1 (bind tool) + Q2 (bind root) to
establish which tool produced the mutation and what its
authorized writable root was.

## Expected vs. actual authority (P1 fix)

```text
EXPECTED generic-editor authority =
  likely workspace / session-root bounded
  (per upstream docs, built-in tools respect
   CoreSessionConfig.cwd)

ACTUAL_TOOL                = UNBOUND  (not yet identified)
ACTUAL_AUTHORIZED_ROOT     = UNBOUND  (not yet established)
```

The recon does NOT assume the LIVE mutation came from the
`editor` tool. Q1 must search the session/transcript around
the LIVE specimen's creation for any of:

```text
editor             (current SDK built-in)
write_to_file      (legacy / hook-receivable)
replace_in_file    (legacy)
apply_patch        (current SDK built-in;
                    treats Add/Update/Delete/Move as a
                    separate mutation tool)
hostbridge mutation / controller/file/* handler
```

## Recon order

LIVE FIRST (Q1 binds the editor / write tool the model
actually uses), not the original 29-file audit. The 29-file
audit is deferred to a downstream ACT if Q1-Q4 here expose
a primitive worth centralizing.

Q1 stop condition: `FIRST_BROKEN_BOUNDARY = UNBOUND` until
the LIVE specimen is bound to a concrete production
handler.

NOT yet TRIAGE_BIND (no fresh TSWPD capture is required to
begin binding; the existing reviewer's evidence is
sufficient). Do NOT infer from directory contents alone.

NOT yet RED (no production-seam test authored; Q5 is the
first RED opportunity and is gated on Q1-Q4).

## Conservation

Global-skill / global-rule / global-hook creation are
LEGITIMATE global-rooted tools and MUST stay ALLOWED under
the corrected contract (case G in the corrected Q5 matrix).

`apply_patch` is a likely sibling that may share the
editor's path resolver; if it does, it belongs in the same
eventual repair conservation. If it does not, do NOT widen
this ACT.

## Authority contract delta (this commit series)

```text
BEFORE (217e7f53c):
  mission = workspace vs. outside-workspace containment
  A/B/C/D = traversal/absolute/global-clean/workspace-clean
  internal contradiction: case C allows global-base writes
  while the mission frames global-base as an escape

AFTER a127aed18 (contract correction):
  mission = capability-specific authorized writable root
  A/B/C/D/E/F = ALLOW, REFUSE-tx-out, REFUSE-..-out,
                REFUSE-abs, REFUSE-symlink, REFUSE-nonexistent
  G/H        = CONSERVATION (global-skill ALLOW,
                             workspace-clean ALLOW)

AFTER this commit (P1 wording fix):
  ACTUAL_TOOL / ACTUAL_AUTHORIZED_ROOT marked UNBOUND
  until Q1/Q2 establish them; LIVE specimen is NOT
  classified as a capability-root escape on F1+F2 alone.
  ADD: apply_patch noted as a likely sibling candidate.
```

No production code change in this commit series. The
correction is wording / mission / matrix reframing only.
NEW_REVIEW_ROUND = NO per the reviewer's verdict.

Verdict: PASS_WITH_ONE_P1_FIX (Factory causal reviewer).
C1: GO_LIVE_BIND.
