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
