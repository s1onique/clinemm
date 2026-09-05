# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01

> Status: **OPEN / RECON_LANE_AUTHORIZED / BOUNDED_CONTRACT_CORRECTION_APPLIED / LIVE_FIRST_BIND_PENDING**.
> RECON ONLY, no production repair yet.
>
> ```text
> ENTRY_HEAD       = 03af027a9 (P1 calibration + handoff commit; this
>                    ACT carries the bounded contract correction from
>                    the Factory causal reviewer verdict
>                    HALT_WRONG_AUTHORITY_CONTRACT on the original
>                    mission at 217e7f53c)
> SUBJECT_HEAD     = 03af027a9
> CORRECTION_HEAD  = 03af027a9
> CORRECTION_REASON = HALT_WRONG_AUTHORITY_CONTRACT
>   The original mission framed authority as "inside the workspace
>   vs. outside the workspace", which would treat legitimately
>   global skill / rule / hook creation as escapes. The correct
>   invariant is capability-specific authorized writable root
>   containment.
> TRIAGE_HEAD      = (this commit; no TRIAGE_BIND until the LIVE
>                    editor / write tool is bound — see Q1)
> ```
>
> Operational state: opening RECON lane for the **file-tool
> capability-specific authorized-root escape** candidate. The
> umbrella ACT's Q5 matrix is implementation-closed at
> `217e7f53c` with `WAITING_Q5_IMPLEMENTATION = CLOSED` and
> `FRESH_POST_REPAIR_LIVE = PENDING / NON-BLOCKING`. Per the
> Factory causal reviewer verdict on the P1 calibration
> (commit `03af027a9`), this file-tool security lane takes
> priority because our live evidence suggests a
> model-controlled **host file mutation** created
> `/Projects/Runtime/...` while shell-side deletion later
> hit Seatbelt denial — a containment-boundary candidate
> that the post-Q5-GREEN um ACT cannot host.
>
> ```text
> LIVE host mutation target =
>   /Projects/Runtime/...
>
> EXPECTED generic-editor authority =
>   likely workspace / session-root bounded
>   (per upstream docs, built-in tools respect CoreSessionConfig.cwd)
>
> ACTUAL_TOOL =
>   UNBOUND  (not yet identified by this ACT)
>
> ACTUAL_AUTHORIZED_ROOT =
>   UNBOUND  (not yet established by this ACT)
>
> AUTHORIZED_ROOT_VIOLATION =
>   NOT YET PROVEN
>   (the two observed facts — host mutation outside the
>    intended Runity/srs tree, and shell-side deletion
>    later denied by Seatbelt — are STRONG but do NOT by
>    themselves classify the host mutation as a
>    capability-root escape; classification requires Q1/Q2
>    to bind the tool identity and its authorized root)
>
> NEXT_DECISION_OWNER =
>   Q1 / Q2  (this ACT)
> ```
>
> Owned by `EPIC-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY01`
> (open alongside this ACT in the next deferred-work entry).
>
> **Note:** `FRESH_POST_REPAIR_LIVE` does NOT gate this ACT; the
> two lanes are independent. Dogfood qualification for the Q5
> repair runs in parallel.

## 0. Mission (per Factory reviewer C1: GO_FILE_TOOL_SECURITY_RECON + correction)

Determine whether the **generic editor / file mutation path
used by the LIVE specimen**, or any sibling generic mutation
path sharing its authority primitive, can resolve a
model-supplied path **outside the authorized writable root
for that operation**.

### 0.1 The correct invariant (CAPABILITY-SPECIFIC, not workspace-universal)

```text
Every model-controlled mutation must remain inside the writable
root(s) explicitly authorized for THAT tool invocation.
```

Examples (the load-bearing partition, not a violation list):

```text
editor / generic file mutation
  -> workspace roots only

create LOCAL skill
  -> <workspace>/.cline/skills/...     (or upstream-equivalent)

create GLOBAL skill
  -> ~/.cline/skills/...               (intentionally global;
                                        legitimate product feature)

create global rule / hook
  -> its explicitly designated global config root

temporary-file operation
  -> designated temp root
  (e.g. os.tmpdir() for the read-only remote-rule /
   workflow / skill mirror in openFile.openRemoteFile)

shell command
  -> separately governed by Seatbelt
  (DO NOT modify Seatbelt in this recon)
```

The defect class is therefore **NOT** "writes outside the
workspace." It is:

> **A mutation escapes the capability-specific authorized
> writable root.**

That distinction is security-load-bearing. Treating
legitimate global config writes as escapes would break
valid product functionality — for example, creating a global
skill at `~/.cline/skills/aws-deploy/SKILL.md` is an
intentionally supported upstream feature, and the
`createSkillFile` controller at
`apps/vscode/src/core/controller/file/createSkillFile.ts`
correctly switches its base directory between
`globalSkillsDir = ensureAgentSkillsDirectoryExists({ isGlobal: true })`
and the workspace-resolved `localSkillsDir` according to the
caller's `isGlobal` flag.

### 0.2 Recon order (LIVE FIRST, not 29-file audit)

```text
1. BIND the LIVE editor / write tool invoked by the model
2. IDENTIFY that tool's intended authorized-root contract
3. INSPECT its path-authority primitive
   (lexical resolve, realpath, sanitization, basename, ...)
4. RED against the real production seam
   (traversal, absolute, symlink, nonexistent descendant)
5. ONLY THEN inventory sibling paths sharing that authority
   primitive
```

Until step 1 is bound:

```text
FIRST_BROKEN_BOUNDARY = UNBOUND
```

The original mission's Q1 ("enumerate all 29 controller
files first") is **deferred to a downstream ACT** if Q1-Q4
here expose a primitive worth centralizing. The recon does
NOT start with a broad audit.

## 1. Live-evidence anchor (BIND target for Q1)

```text
LIVE specimen (the reviewer's load-bearing evidence):
  /Projects/Runtime/... was created by a model-controlled host
  file mutation while the workspace was elsewhere.
  Shell-side deletion later hit Seatbelt denial.

OBSERVED FACTS (durable, before any tool classification):
  F1. host mutation outside the intended Runity/srs tree
  F2. shell-side deletion of the same tree later denied
      by Seatbelt

UNBOUND UNTIL Q1/Q2:
  ACTUAL_TOOL                = UNBOUND
  ACTUAL_AUTHORIZED_ROOT     = UNBOUND
  AUTHORIZED_ROOT_VIOLATION  = NOT YET PROVEN

Q1 TOOL-CANDIDATES (search the session/transcript around
the LIVE specimen's creation; do not assume the upstream
SDK name `editor` is the only one - ClineMM inherits
legacy terminology including `write_to_file`,
`replace_in_file`, `apply_patch`):
  - editor             (current SDK built-in)
  - write_to_file      (legacy / hook-receivable)
  - replace_in_file    (legacy)
  - apply_patch        (current SDK built-in; treats
                        Add/Update/Delete/Move as a
                        separate mutation tool)
  - hostbridge mutation / controller/file/* handler
                       (non-controller write path)
```

This is NOT a "candidate symptom" - it is the reviewer's
primary evidence pointer for opening this lane. The recon's
first job is to bind this LIVE specimen to:

  (a) the exact tool emitted by the model
      (editor? write_to_file? replace_in_file? apply_patch?
       hostbridge mutation? controller/file handler?)
  (b) the exact production handler that performed the write
  (c) the path-authority primitive at that handler
      (lexical resolve, realpath, sanitization, basename,
       none)

Until (a)-(c) are bound, the recon does NOT generalize to
the 29 controller files and does NOT prescribe a repair;
the LIVE specimen is NOT classified as a capability-root
escape (F1+F2 alone do NOT establish that - they only
establish host mutation occurred outside the intended tree
and shell authority denied the deletion); and
`FIRST_BROKEN_BOUNDARY = UNBOUND`.
```

The current evidence is strong: the model-facing tool path
reported successful creation of files under the erroneous
`/Projects/Runtime/srs/...` tree, while subsequent
shell-side removal was denied by Seatbelt. The host
mutation succeeded (tool-side authority permitted it);
the shell deletion was denied (shell-side Seatbelt
authority refused it). Whether the host mutation
constituted a capability-root escape depends on which
tool produced it and what its authorized root was
(Q1/Q2). A fresh TSWPD capture is NOT required to begin
binding; the durable session/transcript around the LIVE
creation is sufficient. Do NOT infer from directory
contents alone.

## 2. Initial scan (LIVE bind priority)

```text
PRIORITY 1 (Q1 bind - load-bearing):
  the editor / write path that the model uses to mutate
  files reachable from a tool-call prompt response.
  Candidates to inspect in order:
    - editor / replace_in_file / apply_patch tool definitions
      under sdk/packages/core/src/extensions/tools/...
    - any hostbridge file-write adapter under
      apps/vscode/src/hosts/vscode/...
    - generic `fs.writeFile` callers in non-controller paths
      reachable from a tool-call prompt response

PRIORITY 2 (Q1.5 - capability inventory, NOT audit):
  capability-specific authorized-root per tool
  (NOT a violation list):
    - editor: workspace roots only
    - create LOCAL skill: <workspace>/.cline/skills
    - create GLOBAL skill: ~/.cline/skills   (legitimate)
    - create LOCAL rule: <workspace>/.cline/rules
    - create GLOBAL rule: ~/.cline/rules     (legitimate)
    - create LOCAL hook: <workspace>/.cline/hooks
    - create GLOBAL hook: ~/.cline/hooks     (legitimate)
    - read-only remote mirror: os.tmpdir()
    - shell command: governed by Seatbelt
  This inventory is the conservation reference for Q5,
  not a defect list.

PRIORITY 3 (deferred downstream ACT if Q1-Q4 expose a
shared primitive):
  - the other 28 controller endpoints under
    apps/vscode/src/core/controller/file/
  - non-controller `fs.writeFile` callers

Sandbox-policy authority (informational, NOT in scope):
  - CommandJobManager.start refuses host-shell fallback when
    mandatorySeatbeltExecution=true (per ACT-CLINEMM-SEATBELT-...)
  - File-tool authority is a SEPARATE question from shell
    authority. Seatbelt denying SHELL deletion of a file that
    the FILE-TOOL wrote is the containment-boundary
    candidate - not a contradiction.
```

## 3. Reconnaissance plan (Q1-Q5)

The recon is bounded. The scope is intentionally narrow: read
the LIVE editor / file path first; do NOT yet change code;
do NOT yet bind a RED to the 29-file surface.

### Q1: bind the LIVE editor / write tool

Trace the LIVE specimen `/Projects/Runtime/...` to:

```text
model tool call
  -> host / tool adapter
  -> path normalization
  -> authorization
  -> filesystem mutation
```

Find and record the **exact** tool emitted by the model.
The candidates are NOT just the current SDK built-in
`editor`. Search the session/transcript around the LIVE
specimen's creation for any of:

```text
editor             (current SDK built-in)
write_to_file      (legacy / hook-receivable)
replace_in_file    (legacy)
apply_patch        (current SDK built-in; treats
                   Add/Update/Delete/Move as a separate
                   mutation tool)
hostbridge mutation / controller/file/* handler
```

Record the **exact** production handler that performed
the write.

Useful output (this is the bind):

```text
LIVE_TOOL              = (the exact tool name)
LIVE_INPUT_PATH        = (the exact path or path component
                         the model supplied)
PRODUCTION_ENTRY       = (the exact handler / adapter
                         entry point)
PATH_NORMALIZER        = (the exact path normalization
                         function used, if any)
MUTATION_PRIMITIVE     = (the exact fs.* primitive invoked)
```

If the bind cannot be made from durable transcript/log
evidence:

```text
CAPTURE_INSUFFICIENT
```

and add the smallest capture needed. Do NOT infer from
directory contents alone.

Deliverable: a section in
`.factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/01-live-bind.md`
containing the full tool-call -> handler chain for
`/Projects/Runtime/...`.

Stop condition: until the chain is bound,
`FIRST_BROKEN_BOUNDARY = UNBOUND` and the recon does NOT
proceed to Q2.

### Q2: identify that tool's intended authorized-root contract

For the bound tool ONLY, record:

```text
authorized_root(tool invocation) =
  the writable root(s) explicitly authorized for THIS tool
```

Common answers per upstream product contract:

```text
editor / generic file mutation:
  workspace roots only
  (the editor tool's documented contract)

create LOCAL skill:
  <workspace>/.cline/skills/...

create GLOBAL skill:
  ~/.cline/skills/...          (legitimate product feature)

create global rule / hook:
  its explicitly designated global config root

temporary-file operation:
  designated temp root
  (e.g. os.tmpdir() for the read-only remote rule / workflow /
   skill mirror in openFile.openRemoteFile)
```

This step is the conservation for Q5: a write to
`~/.cline/skills/aws-deploy/SKILL.md` from the
global-skill-creator tool is **ALLOWED**, not a violation.

Deliverable: a section in
`.factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/02-authorized-root.md`
containing the per-tool authorized-root contract for the
bound tool.

### Q3: inspect the path-authority primitive

For the bound tool, inspect the path-authority primitive at
the write site:

```text
input string (model-controlled)
sanitization transform (regex / basename / none)
base-directory source (workspace-resolved / global config / tempdir)
containment authority check:
  - lexical resolve against authoritative base
  - realpath of nearest existing ancestor (file may not
    exist yet, so `fs.realpath` on the final target is
    insufficient by itself)
  - explicit containment comparison against
    `authorized_root(tool invocation)`
  - TOCTOU protection (the resolved-vs-written path must
    not be replaceable via a symlink that lands after
    resolution)
```

The contract for the eventual repair is closer to:

```text
1. resolve path lexically against the authoritative base;
2. find / canonicalize the nearest existing ancestor;
3. ensure that ancestor is within `authorized_root(tool)`;
4. protect against symlink traversal / replacement;
5. perform the mutation.
```

Q3 is a **discovery** step - do NOT preselect `realpath()` as
the solution; discover the seam the production handler
already uses.

Deliverable: a section in
`.factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/03-authority-primitive.md`.

### Q4: lowest composition seam

Identify the lowest already-authoritative seam where a
`authorized_root(tool)` containment check could be inserted
ONCE for the bound tool (e.g. a wrapper over the bound
handler; OR a new option on an existing resolver that fails
closed when the resolved path escapes
`authorized_root(tool)`).

This is per-tool, NOT universal. The Q4 seam for the bound
tool may differ from the Q4 seam for the global-skill
creator; the two tools have different authorized roots and
should not share a single global check.

Sibling check (after the LIVE bind):
- `apply_patch` is a likely sibling of the editor. If it
  shares the editor's path resolver, it belongs in the
  same eventual repair conservation.
- If `apply_patch` does NOT share the editor's resolver,
  do NOT widen this ACT; record the divergence and stop.

Deliverable: a section in
`.factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/04-composition-seam.md`.

### Q5: RED formulation (only after Q1-Q4)

Per the umbrella ACT's pattern, the RED matrix is reframed
around `authorized_root(tool)` for the bound tool ONLY:

```text
A. clean name, workspace-resolved base, target inside
   authorized_root(editor)                         -> ALLOW

B. clean name, workspace-resolved base, target outside
   authorized_root(editor) (e.g. workspace/../sibling)
                                                  -> REFUSE (RED)

C. traversal ".." name, workspace-resolved base,
   target resolves outside authorized_root(editor)
   (e.g. workspace/../Runtime/foo)                -> REFUSE (RED)

D. absolute name (e.g. "/etc/passwd")            -> REFUSE (RED)

E. symlink under workspace pointing to a sibling
   outside authorized_root(editor)               -> REFUSE (RED)

F. nonexistent descendant below a sibling outside
   authorized_root(editor)
   (e.g. workspace/../Runtime/new/deep/file
    where the new/deep/file does not exist yet)
                                                  -> REFUSE (RED)
   Note: this case CANNOT be detected by
   `fs.realpath(file)` alone because the target does not
   exist. The contract is lexical resolve + nearest
   existing ancestor canonicalization + containment.

G. CONSERVATION (regression-preserving control):
   create GLOBAL skill, name = "aws-deploy",
   base = ~/.cline/skills/
   target = ~/.cline/skills/aws-deploy/SKILL.md
   -> ALLOW (legitimate global-rooted tool; NOT a violation
            of the per-tool authorized-root contract)
   This case MUST stay ALLOWED. If a future repair breaks
   it, the repair is wrong.

H. CONSERVATION (regression-preserving control):
   editor, clean name, base = <workspace>/src,
   target = <workspace>/src/foo.ts               -> ALLOW
```

The original A/B/C/D matrix framed the mission as workspace
containment and then said "clean alphanumeric + global base"
is allowed, which is an internal contradiction. The corrected
matrix above keeps the conservation (case G) while making
the contract explicit per tool.

Deliverable: a section in
`.factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/05-red-matrix.md`.

## 4. Conservation and stop rules

```text
PRODUCTION_FILES_CHANGED = 0 during the recon (Q1-Q5 read-only)
NO production repair until:
  - Q1 LIVE bind is complete
  - Q5 RED is authored
  - Factory reviewer authorizes the repair
  - Conservation proof (ACAS01-equivalent for the file-tool
    surface, INCLUDING the case-G global-skill conservation)
    is captured
NO modification to Seatbelt / shell-command authority in
  this recon (per Factory reviewer instruction)
```

## 5. Exit (one of three useful outcomes)

After Q5:

```text
1. CLOSED / RED_BOUND + REPAIR_AUTHORIZED
   the LIVE editor is bound to a real call path; the lowest
   seam is identified; a narrow per-tool repair is authorized
   in a follow-up ACT.

2. NO_RED_FOUND
   the live evidence cannot be reproduced against the bound
   tool; the lane is closed pending fresh evidence.

3. SYMPTOM_REQUIRES_LIVE_BIND
   Q1 cannot bind the LIVE specimen to a concrete handler
   without a fresh live TSWPD capture; the lane is parked
   at FRESH_LIVE_BIND_PENDING and the umbrella ACT pivots.
```

## 6. Sequence after this ACT

This ACT opens the file-tool security lane. It does NOT modify
the umbrella ACT's Q5 work (which is implementation-closed).
`FRESH_POST_REPAIR_LIVE` for the Q5 repair runs in parallel
and does NOT gate this ACT.

If this ACT closes with REPAIR_AUTHORIZED, a bounded child
ACT implements the per-tool containment check at the seam
identified in Q4. That child ACT follows the same contract
ACT / implementation ACT / Q5-RED matrix discipline used for
`BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01`.

## 7. Sign-off gate (per the umbrella ACT's discipline)

Before this ACT can close with REPAIR_AUTHORIZED:

```text
- typecheck apps/vscode                       = clean
- ACAS01 vitest                               = preserved (4/4 PASS)
- BHTD01 vitest                               = preserved (6/6 PASS)
- Q5RR01 vitest                               = preserved (6/6 PASS)
- Q1 LIVE editor bind                         = AUTHORED
- Q2 per-tool authorized-root contract        = AUTHORED
- Q3 path-authority primitive                 = AUTHORED
- Q4 lowest composition seam (per tool)      = AUTHORED
- Q5 RED matrix (A-F + G/H conservation)      = AUTHORED + EXECUTED
- case-G global-skill conservation            = PRESERVED
- necessity ablation (disable per-tool check) = REPRODUCED
- git diff --check                            = silent
- working tree                                = clean
```

## 8. Factory state (frozen, for board durability)

```text
ACT =
  ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01

SECURITY_PRIORITY =
  CORRECT

LIVE_SYMPTOM =
  HIGH VALUE  (load-bearing evidence, not a candidate
               symptom; the recon's first job is to bind it)

OBSERVED_FACTS =
  F1. host mutation outside the intended Runity/srs tree
  F2. shell-side deletion of the same tree later denied
      by Seatbelt

CURRENT_AUTHORITY_CONTRACT =
  WRONG / OVERBROAD  (workspace-universal; would misclassify
                      legitimate global-skill / global-rule /
                      global-hook creation as escapes)

P0 =
  workspace root incorrectly treated as universal writable
  authority; legitimate global-config tools intentionally
  have non-workspace roots

P1 =
  LIVE target prematurely labeled outside the generic
  editor's authorized root before Q1/Q2 bind tool + root

FIX =
  ACTUAL_TOOL                = UNBOUND  (until Q1)
  ACTUAL_AUTHORIZED_ROOT     = UNBOUND  (until Q2)
  AUTHORIZED_ROOT_VIOLATION  = NOT YET PROVEN
  (F1 + F2 are STRONG but do NOT by themselves classify
   the host mutation as a capability-root escape;
   classification requires Q1/Q2)

CORRECT_INVARIANT =
  mutation target must remain inside the
  capability-specific authorized writable root(s)

EXPECTED_GENERIC_EDITOR_AUTHORITY =
  likely workspace / session-root bounded
  (per upstream docs, built-in tools respect
   CoreSessionConfig.cwd)

SEATBELT =
  separate shell authority;
  do NOT modify in this recon

PRODUCTION_REPAIR =
  NOT AUTHORIZED  (recon only)

NEXT =
  bounded contract correction (this ACT)
  -> bind exact LIVE file / editor tool (Q1)
     search session/transcript for:
       editor | write_to_file | replace_in_file | apply_patch
     (do not assume upstream SDK name `editor` is the only
      one; legacy terminology and apply_patch both apply)
  -> identify per-tool authorized root (Q2)
  -> inspect path-authority primitive (Q3)
     - lexical resolve vs. authoritative base
     - realpath of nearest existing ancestor
       (file often does not exist yet)
     - containment vs. authorized_root(tool)
     - symlink / TOCTOU protection
  -> RED against real production seam with case-G
     global-skill conservation (Q5)
     separate these for the first RED:
       a) lexical escape       ../sibling
       b) absolute escape      /outside/path
       c) existing symlink     workspace/link -> outside
       d) nonexistent target   outside/new/file
     if all four reproduce through the same resolver,
     centralization is justified
     (race-safe mutation may need stronger OS primitives;
      that is repair design, not recon)
  -> only then inventory sibling paths sharing that
     authority primitive (deferred to a downstream ACT)
     including `apply_patch` as a likely sibling that
     shares the editor's path resolver (or does not -
     if it does not, do NOT widen this ACT)

VERDICT =
  PASS_WITH_ONE_P1_FIX  (Factory causal reviewer)
  - a127aed18 = contract correction PASS
  - this commit = P1 wording + apply_patch sibling note
  - capability-specific authority model = CORRECT
  - global-skill conservation = REQUIRED / CORRECT
  - Seatbelt = separate / preserved
  - LIVE tool / authorized root = UNBOUND until Q1/Q2
  - production change = FORBIDDEN
  - repair authorized = NO
  - new review round = NO
  C1: GO_LIVE_BIND

NEW_REVIEW_ROUND =
  NO
  (the P1 fix is wording-only + sibling-candidate addition;
   no production code change; no new RED; no new test)
```

---

## 9. REVIEWER VERDICT on CYCLE7 (commit 72594d509) — PRODUCTION_ACT_AUTHORIZED

```text
ACT_ID             = ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01
REVIEWER_CYCLE     = on commit 72594d509 (this ACT's CYCLE7)
REVIEWER_VERDICT   = PASS_WITH_ONE_BOUNDED_P1
C1                 = GO (proceed to production ACT)
RECON_LANE         = CLOSED (do NOT reopen)
PRODUCTION_ACT     = AUTHORIZED
                      ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
PRODUCTION_HEAD    = 72594d509 (this commit; docs-only opening)
APPROVAL_SEMANTICS = BOUND_FROM_SOURCE
```

The CYCLE7 reviewer's verdict on the CYCLE7 evidence commit
(72594d509) accepted all six P1 corrections and the P2
verdict noun change. The reviewer authorized the production
ACT to open with **one bounded P1 wording correction** applied
inside Phase 0 of the production ACT:

```text
P1 wording correction (applied in production ACT §3):
  REPLACE  "non-approved-outside target still refuses"
  WITH     "denied approval means executor not invoked"
```

This is the only remaining work from the recon lane. The
production ACT ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
opens in the same commit (this commit) in docs-only form
with Phase 0 binding the six reconfirmation facts.

### CYCLE7 factory classification (per reviewer verdict)

```text
P0               : NONE
P1               : wording/layering only (1 item; applied
                   in production ACT §3, no further recon
                   cycles required)
P2               : none material
RECON            : CLOSED
APPROVAL_SEMANTICS : BOUND
PRODUCTION_ACT   : AUTHORIZED
```

### Reviewer's confirmation of the corrected lattice

The reviewer confirmed the 5-row lattice from CYCLE7 P1-1:

```text
editFiles | destination  | external-edit | result
--------- | ------------ | ------------- | ------
   false  | inside       | any           | ASK
   false  | outside      | any           | ASK
   true   | inside       | any           | ALLOW
   true   | outside      | false         | ASK
   true   | outside      | true          | ALLOW
   (any)  | unavailable  | (any)         | ASK   (fail-closed)
```

This is the contract the production ACT must freeze as Phase 0.

### Reviewer's confirmation of the 3-layer split

The reviewer corrected CYCLE7's wording that conflated
executor safety with approval:

```text
CLASSIFIER
  path -> inside | outside | unavailable

POLICY
  classifier result + toggles -> ALLOW | ASK

COORDINATOR / APPROVAL INTEGRATION
  ASK + deny    -> executor NOT invoked
  ASK + approve -> executor invoked and outside write succeeds
  ALLOW         -> executor invoked directly

EXECUTOR
  approved outside request -> writes successfully
```

The executor must NOT know about the approval policy.

### Reviewer's confirmation of the async-evidence architecture

The reviewer confirmed that the correct architecture is:

```text
ASYNC filesystem observation
  -> immutable classification evidence
  -> PURE approval policy
```

And explicitly forbade mutating isToolAutoApproved() to be
async (it almost certainly is sync; converting it ripples
through every tool-approval caller).

### Reviewer's note on tooling residue

The reviewer noted that the digest's embedded gate-summary
and generator binding remain invalid/non-authoritative but
are unrelated Factory tooling residue and should not delay
this lane. (Confirmed: this ACT does not touch them.)

### Production ACT authorization

The production ACT is **AUTHORIZED** to open:

```text
ACT_ID            = ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
PARENT_RECON_ACT  = ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01
PARENT_HEAD       = 72594d50921fe2527b98d5052e09c74969a88fe1
PHASE_0_DELTA     = 6-fact binding + wording correction
PRODUCTION_CHANGE = 0 in this commit (docs-only opening)
NEXT              = Phase 0 binds the 6 facts from source;
                    Phases 1-4 implement R1..R5 RED + GREEN
                    + necessity ablation
```

### Final acknowledgement

CYCLE7 is the recon ACT's terminal bound. The recon lane is
closed; no further recon cycles are required for this
surface. The production ACT owns the remaining work.

```text
RECON_LANE_STATUS       = CLOSED
PRODUCTION_ACT_STATUS   = OPEN / AUTHORIZED / PHASE_0_BIND_PENDING
PARENT_RECON_VERDICT    = PASS_WITH_ONE_BOUNDED_P1
PRODUCTION_ACT_VERDICT  = (to be set by production ACT's own
                          Factory reviewer verdict)
NEW_REVIEW_ROUND        = NO (per CYCLE7 reviewer: "No new
                          recon cycle"; the bounded P1 lives
                          in production ACT Phase 0)
```

### Post-CYCLE1-opener-receiver update (commit 148e30c17)

Per Factory reviewer verdict on the production ACT opener
(commit 148e30c17, "CYCLE1 opener"):
  VERDICT = PASS_WITH_NO_NEW_P1_AT_C1_GO
  C1      = GO (Phase 0 binding authorized)
  PHASE_0 = BOUND (six-fact binding + opener-receiver P1/P2
                   corrections applied in the production ACT's
                   phase0-reconfirmation.md)

The production ACT's Phase 0 now binds:
  - Six reconfirmations (1.1..1.6) with file:line evidence
  - P1 multi-target aggregation (unavailable > outside > inside)
  - P2 EDITOR_PATH_CONTRACT = ABSOLUTE_ONLY source-confirmed

No change to the recon lane; the recon ACT's terminal bound
remains CYCLE7.

```text
RECON_LANE_STATUS       = CLOSED  (unchanged)
PRODUCTION_ACT_STATUS   = OPEN / AUTHORIZED / PHASE_0_BOUND
PARENT_RECON_VERDICT    = PASS_WITH_ONE_BOUNDED_P1
PRODUCTION_ACT_VERDICT  = PASS_WITH_NO_NEW_P1_AT_C1_GO
NEW_REVIEW_ROUND        = NO  (per opener-receiver: "C1: GO.
                          No more contract review. Bind the six
                          facts, add the multi-target aggregation
                          rule if needed, and get to RED.")
```

## 10. Post-CYCLE1-opener-receiver Phase 0 binding review (commit a985e774f)

Per the Factory reviewer's verdict on the production ACT
Phase 0 binding commit (a985e774f):

```text
FACTORY_VERDICT   = PASS_WITH_ONE_BOUNDED_P1
                    (CYCLE1 reviewer on the Phase 0 binding)
C1                = GO after one bounded correction
RECON_LANE        = CLOSED (unchanged)
PRODUCTION_ACT    = GO TO RED
NEW_REVIEW_ROUND  = NO (per CYCLE1 reviewer: "C1: GO after that
                    one bounded correction. Then write RED
                    immediately - no Phase-0 CYCLE2, no new
                    planning commit, no more contract review.")
```

### The three bounded corrections

**P1 (first half) — apply_patch movePath target enumeration**

The reviewer's primary load-bearing correction: `apply_patch`
carries TWO path-bearing locations per move action:

```ts
interface PatchAction {
  ...
  movePath?: string   // apply-patch-parser.ts:36
}

interface Patch {
  actions: Record<string, PatchAction>   // apply-patch-parser.ts:46-49
}
```

`Object.keys(patch.actions)` alone would miss the move
destination and silently auto-approve `inside source →
outside move target` patches. Frozen enumeration (now in
production ACT phase0 §1.2):

```ts
for each (sourcePath, action) in patch.actions:
    targets += sourcePath
    if action.movePath exists:
        targets += action.movePath
```

Load-bearing R1 cases (now in production ACT phase0 §2.1):

| apply_patch shape                  | REQUEST_CLASS |
|------------------------------------|---------------|
| inside source -> inside move target  | INSIDE     |
| inside source -> outside move target | OUTSIDE    |
| outside source -> inside move target | OUTSIDE    |

**P1 (second half) — isEditTool inventory tightening**

The reviewer's secondary correction: the previous "All five
share the same classification lattice" sentence was TOO BROAD.
The inventory now splits:

```text
CURRENT INCLUDED SURFACE (conservation PROVEN by this ACT):
  editor
  apply_patch

LEGACY POLICY NAMES (existing behavior preserved; NO target-
aware parity claim from this ACT):
  replace_in_file
  write_to_file
  delete_file
```

**P2 — AsyncLocalStorage not prematurely frozen as carrier**

The reviewer's architectural precision: `AsyncLocalStorage`
inside `handleRequestToolApproval` is the proven async
composition seam, but is NOT itself the correct evidence
carrier. Phase 0 binds the seam; carrier choice is deferred
to Phase 1-2 with the preferred shape being a local
immutable variable + direct function parameter passing
(NOT ambient ALS).

### Disposition

All three corrections were APPLIED in the production ACT
phase0-reconfirmation.md and §13 verdict block. The production
ACT is now in `PHASE_0_BOUND_CORRECTED` state and authorized
to enter Phases 1-4 (RED + GREEN + necessity-ablation) against
the corrected, bound seams.

```text
RECON_LANE_STATUS        = CLOSED  (unchanged from CYCLE7)
PRODUCTION_ACT_STATUS    = OPEN / AUTHORIZED / PHASE_0_BOUND_CORRECTED
CYCLE1_REVIEWER_VERDICT  = PASS_WITH_ONE_BOUNDED_P1
NEW_REVIEW_ROUND         = NO
NEXT                     = Phases 1-4 (RED + GREEN + necessity-ablation)
                            No new recon cycle.
                            No new planning commit.
                            No more contract review.
```

## 11. Post-HALT_RED_BEFORE_IMPLEMENTATION R0 reproduction (Phase 1 RED FIRST per reviewer)

After the CYCLE1 bounded corrections landed (commit e1016a0e6),
the reviewer issued `HALT_RED_BEFORE_IMPLEMENTATION` requiring
the principal RED be reproduced through the REAL coordinator
seam BEFORE any implementation work. The R0 RED has now been
executed and observed:

```text
TEST FILE
  apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.r0-red.test.ts

SEAM (all REAL, no mocks)
  SdkInteractionCoordinator.handleRequestToolApproval
    apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326
  shouldAutoApproveTool wired to isToolAutoApproved
    apps/vscode/src/sdk/sdk-interaction-coordinator.ts:521
  isToolAutoApproved
    apps/vscode/src/sdk/sdk-tool-policies.ts:1072-1077
  Filesystem geometry constructed via realpathSync +
    mkdtempSync + writeFileSync

OBSERVED
  × R0  OUTSIDE + editFiles=true => expected ASK,
        currently silently ALLOW (DEFECT CONFIRMED).
  ✓ R0b INSIDE + editFiles=true => ALLOW (positive control).
  ✓ R0c OUTSIDE + editFiles=false => ASK (base-disabled control).

STOP RULE
  RED_REPRODUCED, not HALT_RED_NOT_REPRODUCED. The seam was
  reached through constructed filesystem geometry, not a
  hand-rolled substitute.

PHASE ORDERING (post-R0)
  PHASE 1 RED FIRST                [DONE]
  PHASE 2 Bounded repair           [NEXT, on RED]
  PHASE 3 apply_patch + R3/R4      [POST-REPAIR]
  PHASE 4 Necessity ablation       [POST-REPAIR]
```

The reviewer's authoritative instructions in this verdict:

> "Then write RED immediately."

> "If you cannot reproduce the silent auto-approval through
>  the real coordinator: HALT_RED_NOT_REPRODUCED and do not
>  implement anything."

> "Once R0 is demonstrably RED, proceed: PHASE 2 add
>  classifier + pure policy."

> "C1: GO directly into the bounded repair in the same ACT."

PHASE 2 is AUTHORIZED to begin in the next commit by the same
ACT — no new planning commit, no new recon cycle, no more
contract review. PHASE 2 implementation begins in the next
commit.

```text
RECON_LANE_STATUS        = CLOSED  (unchanged)
PRODUCTION_ACT_STATUS    = OPEN / AUTHORIZED / R0_RED_REPRODUCED /
                           PHASE_2_AUTHORIZED
NEW_REVIEW_ROUND         = NO
NEXT                     = PHASE 2 bounded repair in next commit
                            (classifier + pure policy + coordinator
                             wiring + auto-approval branch)
```

## 12. PHASE 2 BOUNDED REPAIR COMPLETED — R0 GREEN on real seam (commit 861e18502)

PHASE 2 (the bounded repair authorized by the reviewer's
`PASS_RED_REPRODUCED + GO TO BOUNDED REPAIR` verdict on commit
1aaa65a84) is implemented + verified in commit 861e18502.

```text
PHASE 2  AUTHORIZED  + IMPLEMENTED + VERIFIED  -> COMPLETE

Files changed:
  A apps/vscode/src/sdk/editor-auto-approval-policy.ts
  A apps/vscode/src/sdk/editor-path-authority.ts
  A apps/vscode/src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts
  A apps/vscode/src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts
  R apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.r0-red.test.ts
    -> apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts
  M apps/vscode/src/sdk/sdk-interaction-coordinator.ts
  M apps/vscode/src/sdk/SdkController.ts
  M apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts

  8 files changed, 861 insertions(+), 103 deletions(-)

Verifier (vitest, real node 26 + vitest 4.1.10):
  src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts (4 tests) 111ms
  src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts       (8 tests)   2ms
  src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts           (6 tests)   4ms
  src/sdk/sdk-interaction-coordinator.test.ts                             (43 tests) ~30s

  Test Files  4 passed (4)
       Tests  61 passed (61)

  Plus the targeted interaction-coordinator + session-autonomy suites
  show 99/101 passed; the 2 failures are pre-existing on origin/main
  (confirmed via `git stash` reproduction) and unrelated to PHASE 2.

  bunx tsc --noEmit:
    (clean)

  bunx biome lint on touched files:
    Checked 8 files in 192ms. No fixes applied.
```

The principal defect — silent auto-approval of editor /
apply_patch requests targeting OUTSIDE the workspace when
`editFiles=true` — is fixed at the lowest existing async seam
in `sdk-interaction-coordinator.ts:548`.

### Updated disposition

```text
RECON_LANE_STATUS        = CLOSED  (unchanged from CYCLE7)
PRODUCTION_ACT_STATUS    = OPEN / PHASE_2_GREEN / R0-R1-R2_PASS
                           PHASE_3-PHASE_4_REMAIN
NEW_REVIEW_ROUND         = NO
MAX_REVIEW_FIX_CYCLE     = ONE  (satisfied; bounded repair
                                  implemented + verified + GREEN
                                  in a single commit)
PHASE_2_DISPOSITION      = COMPLETE
PHASE_3_DISPOSITION      = AUTHORIZED_FOR_NEXT_ACT
PHASE_4_DISPOSITION      = AUTHORIZED_FOR_NEXT_ACT
```

## 13. PHASE 2 CORRECTION01 bounded repair COMPLETED — P0 + P1s closed on real seam (commit 93d4bd746)

Per the factory reviewer's HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS verdict
on commit 861e18502 (PHASE 2 GREEN), CORRECTION01 was opened and is now
COMPLETE.

```text
PHASE 2 CORRECTION01  AUTHORIZED  + IMPLEMENTED + VERIFIED  -> COMPLETE

Files changed:
  A apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.r0p0-multi-target-dominance.red.test.ts
  A apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.correction01-relative-paths.red.test.ts
  A apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.correction01-apply-patch-matrix.red.test.ts
  A apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.correction01-fallback-fails-closed.red.test.ts
  M apps/vscode/src/sdk/editor-path-authority.ts
  M apps/vscode/src/sdk/sdk-interaction-coordinator.ts
  M apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts

  7 files changed, 792 insertions(+), 36 deletions(-)

Verifier (vitest, real node 26 + vitest 4.1.10):
  src/sdk/__tests__/editor-effective-destination-approval.correction01-relative-paths.red.test.ts           (5 tests)  11ms
  src/sdk/__tests__/editor-effective-destination-approval.correction01-apply-patch-matrix.red.test.ts      (10 tests)  3ms
  src/sdk/__tests__/editor-effective-destination-approval.correction01-fallback-fails-closed.red.test.ts   (3 tests) 210ms
  src/sdk/__tests__/editor-effective-destination-approval.r0p0-multi-target-dominance.red.test.ts          (8 tests)  2ms
  src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts                                  (4 tests) 111ms
  src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts                                          (8 tests)   2ms
  src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts                                              (6 tests)   4ms
  src/sdk/sdk-interaction-coordinator.test.ts                                                               (43 tests) ~30s

  Test Files  8 passed (8)
       Tests  87 passed (87)

  bunx tsc --noEmit: clean
  bunx biome lint on touched files: 11 files, 0 fixes applied
```

### P0 + P1 disposition

```text
P0  MULTI_TARGET_UNAVAILABLE_ORDER_BYPASS            FIXED
P1  relative paths                                   FIXED
P1  apply_patch extractor                            QUALIFIED
P1  missing-options fallback                         FIXED
```

### Updated disposition

```text
RECON_LANE_STATUS        = CLOSED
PRODUCTION_ACT_STATUS    = OPEN / PHASE_2_CORRECTION01_GREEN
                           PHASE_3-PHASE_4_REMAIN
NEW_REVIEW_ROUND         = NO
MAX_REVIEW_FIX_CYCLE     = ONE  (satisfied; bounded CORRECTION01
                                  implemented + verified + GREEN
                                  in a single commit)
PHASE_2_DISPOSITION      = COMPLETE (PHASE 2 + CORRECTION01)
PHASE_3_DISPOSITION      = AUTHORIZED_FOR_NEXT_ACT
PHASE_4_DISPOSITION      = AUTHORIZED_FOR_NEXT_ACT
```

## 14. PHASE 2 CORRECTION02 bounded repair COMPLETED — P0 precedence frozen + P1 fallback test strengthening + P2 dead-code cleanup (commit 00d71e51c)

Per the factory reviewer's HALT_TOOL_POLICY_PRECEDENCE_REGRESSION verdict
on commit 93d4bd746 (PHASE 2 CORRECTION01 GREEN), CORRECTION02 was opened
and is now COMPLETE.

```text
PHASE 2 CORRECTION02  AUTHORIZED  + IMPLEMENTED + VERIFIED  -> COMPLETE

Files changed:
  A apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.correction02-policy-precedence.red.test.ts
  M apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.correction01-fallback-fails-closed.red.test.ts
  M apps/vscode/src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts
  M apps/vscode/src/sdk/editor-path-authority.ts
  M apps/vscode/src/sdk/sdk-interaction-coordinator.ts

  5 files changed, 488 insertions(+), 47 deletions(-)

Verifier (vitest, real node 26 + vitest 4.1.10):
  src/sdk/__tests__/editor-effective-destination-approval.correction01-relative-paths.red.test.ts           (5 tests)  11ms
  src/sdk/__tests__/editor-effective-destination-approval.correction01-apply-patch-matrix.red.test.ts      (10 tests)  3ms
  src/sdk/__tests__/editor-effective-destination-approval.correction01-fallback-fails-closed.red.test.ts   (3 tests)  ~110ms
  src/sdk/__tests__/editor-effective-destination-approval.correction02-policy-precedence.red.test.ts       (7 tests)  ~110ms
  src/sdk/__tests__/editor-effective-destination-approval.r0p0-multi-target-dominance.red.test.ts          (8 tests)  2ms
  src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts                                  (4 tests) 111ms
  src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts                                          (8 tests)   2ms
  src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts                                              (6 tests)   7ms
  src/sdk/sdk-interaction-coordinator.test.ts                                                               (43 tests) ~30s

  Test Files  9 passed (9)
       Tests  94 passed (94)

  bunx tsc --noEmit: clean
  bunx biome check on 5 touched files: 0 fixes applied
```

### P0 + P1 + P2 disposition

```text
P0  TOOL_POLICY_PRECEDENCE_REGRESSION                  FIXED (frozen precedence)
P1  fallback test proves non-resolution                FIXED (mechanical ASK
                                                        publication assertion)
P2  editor/apply_patch ASK decision carrier residue    FIXED (decision carried
                                                        on ASK return path)
P2  nearest-existing-ancestor skips fsRoot             FIXED (loop now tries
                                                        fsRoot before giving up)
```

### Frozen ClineMM EDIT-TOOL precedence (CORRECTION02)

```text
1.  request.policy.autoApprove === true                => ALLOW (override)
2.  otherwise (default ClineMM host wiring forces
    autoApprove=false for editor/apply_patch at SDK seam):

    a.  getCwd() unavailable          => ASK (fail closed)
    b.  getAutoApprovalSettings() unavailable => ASK
    c.  classification=inside + editFiles=true => ALLOW
    d.  classification=outside + editFilesExternally=true => ALLOW
    e.  classification=outside + editFilesExternally=false => ASK
    f.  classification=unavailable    => ASK (fail closed)
```

### Updated disposition

```text
RECON_LANE_STATUS        = CLOSED
PRODUCTION_ACT_STATUS    = OPEN / PHASE_2_CORRECTION02_GREEN
                           PHASE_3-PHASE_4_REMAIN
NEW_REVIEW_ROUND         = NO
MAX_REVIEW_FIX_CYCLE     = ONE  (satisfied; bounded CORRECTION02
                                  implemented + verified + GREEN
                                  in a single commit)
PHASE_2_DISPOSITION      = COMPLETE (PHASE 2 + CORRECTION01 + CORRECTION02)
PHASE_3_DISPOSITION      = AUTHORIZED_FOR_NEXT_ACT
PHASE_4_DISPOSITION      = AUTHORIZED_FOR_NEXT_ACT
```

## 15. PHASE 2 CORRECTION03 bounded repair COMPLETED — P0 dangling-symlink effective-destination bypass closed (commit fa2710da4)

Per the factory reviewer's `HALT_DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS`
verdict on commit 00d71e51c (PHASE 2 CORRECTION02 GREEN), CORRECTION03 was
opened and is now COMPLETE. Per the reviewer's directive this is the
**final bounded Phase-2 repair cycle**.

```text
PHASE 2 CORRECTION03  AUTHORIZED  + IMPLEMENTED + VERIFIED  -> COMPLETE

Files changed:
  A apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.correction03-dangling-symlink.red.test.ts
  M apps/vscode/src/sdk/editor-path-authority.ts

  2 files changed, 200 insertions(+), 13 deletions(-)

Verifier (vitest, real node 26 + vitest 4.1.10):
  src/sdk/__tests__/editor-effective-destination-approval.correction01-relative-paths.red.test.ts           (5 tests)  12ms
  src/sdk/__tests__/editor-effective-destination-approval.correction01-apply-patch-matrix.red.test.ts      (10 tests)  3ms
  src/sdk/__tests__/editor-effective-destination-approval.correction01-fallback-fails-closed.red.test.ts   (3 tests)  ~110ms
  src/sdk/__tests__/editor-effective-destination-approval.correction02-policy-precedence.red.test.ts       (7 tests)  ~110ms
  src/sdk/__tests__/editor-effective-destination-approval.correction03-dangling-symlink.red.test.ts       (4 tests)  5ms
  src/sdk/__tests__/editor-effective-destination-approval.r0p0-multi-target-dominance.red.test.ts          (8 tests)  2ms
  src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts                                  (4 tests) 111ms
  src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts                                          (8 tests)   2ms
  src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts                                              (6 tests)   7ms
  src/sdk/sdk-interaction-coordinator.test.ts                                                               (43 tests) ~30s

  Test Files  10 passed (10)
       Tests  98 passed (98)

  bunx tsc --noEmit: clean
  bunx biome check on 2 touched files: clean
```

### P0 disposition

```text
P0  DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS   FIXED (lstatSync lexical
                                                       existence + realpath
                                                       fail closed)
```

### The defect

```text
  workspace/escape-link -> /tmp/outside/new-file.txt   (ABSENT)

    realpath(workspace/escape-link)  => ENOENT
    lexically-existing deepest ancestor = workspace/escape-link
    realpath(workspace)              => workspace
    OLD ALGORITHM: returns workspace  => INSIDE  (BYPASS)
    NEW ALGORITHM: returns undefined  => UNAVAILABLE  (fail closed)
```

EFFECTIVE DESTINATION = OUTSIDE; CLASSIFICATION = INSIDE; HOST POLICY =
editFiles=true external=false; RESULT = SILENT ALLOW.

### Critical correctness note

```text
Initial fix attempt using fs.existsSync (which FOLLOWS SYMLINKS on macOS)
still returned INSIDE — existsSync returns false for a dangling symlink
whose target is absent, and the walk silently climbed past the dangling
component to an older ancestor. Only fs.lstatSync (does NOT follow
symlinks) reliably reports lexical existence of the symlink itself.
```

### The new algorithm (frozen CORRECTION03)

```text
1. Walk upward using fs.lstatSync (lexical existence — does not
   follow symlinks).
2. Stop at the deepest lexically-existing component.
3. Canonicalize exactly that component via fs.realpathSync.
4. If realpath throws: return undefined. The caller maps to UNAVAILABLE
   (fail closed at the policy lattice).
5. Otherwise the canonical ancestor is the realpath of the deepest
   lexically-existing component.

Order-independent. Always terminates because the filesystem root `/`
lexically exists (`lstatSync("/").isSymbolicLink() === false`).
```

### PHASE 3 — apply_patch movePath GREEN via CORRECTION01

Already covered by `correction01-apply-patch-matrix.red.test.ts`
(10 cases, all GREEN under the CORRECTION03 algorithm). The verifier
output above proves the movePath enumeration behavior is preserved.
No new production code required for PHASE 3.

### PHASE 4 — necessity ablation analysis

Reviewer's question: can the `resolveNearestExistingAncestor` fallback
be eliminated entirely by mapping every realpath failure to UNAVAILABLE?

Ablation:

  - Drop the fallback entirely
    => ordinary file creation (e.g. `workspace/new-file.ts` where
    `workspace/` exists but the file does not) breaks. The legitimate
    file-creation case currently classifies INSIDE via the fallback;
    without the fallback, ordinary writes that don't yet have a target
    file would now ASK. This breaks the R0 GREEN invariant — file
    creation is a basic edit-tool use case that must not require user
    approval.

  - Keep the fallback with the new lexically-existing-ancestor walk
    (CORRECTION03 algorithm)
    => ordinary file creation works AND dangling symlinks cannot
    bypass containment.

Conclusion: the fallback is NECESSARY for legitimate file creation.
The CORRECTION03 algorithm is the minimal-necessary refinement.
A bespoke symlink-resolution engine is NOT necessary — `UNAVAILABLE`
is already fail-closed in the policy lattice.

### Updated disposition

```text
RECON_LANE_STATUS        = CLOSED
PRODUCTION_ACT_STATUS    = OPEN / PHASE_2_CORRECTION03_GREEN
                           PHASE_3 GREEN (no new production changes)
                           PHASE_4 COMPLETE (necessity ablation analyzed)
NEW_REVIEW_ROUND         = NO
MAX_REVIEW_FIX_CYCLE     = ONE  (satisfied; bounded CORRECTION03
                                  implemented + verified + GREEN
                                  in a single commit)
PHASE_2_DISPOSITION      = COMPLETE (PHASE 2 + CORRECTION01 + CORRECTION02 + CORRECTION03)
PHASE_3_DISPOSITION      = GREEN (covered by CORRECTION01 movePath matrix)
PHASE_4_DISPOSITION      = COMPLETE (necessity ablation analyzed; minimal-necessary confirmed)

REVIEWER_CHAIN           = PASS_RED_REPRODUCED (861e18502) → PHASE 2 GREEN
                            HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS → CORRECTION01 (93d4bd746 GREEN)
                            HALT_TOOL_POLICY_PRECEDENCE_REGRESSION → CORRECTION02 (00d71e51c GREEN)
                            HALT_DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS → CORRECTION03 (fa2710da4 GREEN)

UNRESOLVED RESIDUE (P2 only, out of bounded cycle)
                          MISSING-DEPENDENCY ASK EVIDENCE CARRIER (getCwd
                          unavailable + getAutoApprovalSettings unavailable
                          return {approved:false, reason} without decision;
                          does not affect authority; strengthened test in
                          CORRECTION02 mechanically proves the ASK card
                          is published)
```
