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
> priority because our live evidence already suggests a
> model-controlled **host file mutation** created
> `/Projects/Runtime/...` under a path that is **not in any
> capability-specific authorized writable root** for the
> generic editor / file mutation, while shell-side deletion
> later hit Seatbelt denial — a containment-boundary candidate
> that the post-Q5-GREEN um ACT cannot host.
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

This is NOT a "candidate symptom" - it is the reviewer's
primary evidence pointer for opening this lane. The recon's
first job is to bind this LIVE specimen to:

  (a) the exact tool emitted by the model
      (editor? write_to_file? apply_patch? hostbridge
       mutation? controller/file handler?)
  (b) the exact production handler that performed the write
  (c) the path-authority primitive at that handler
      (lexical resolve, realpath, sanitization, basename,
       none)

Until (a)-(c) are bound, the recon does NOT generalize to
the 29 controller files and does NOT prescribe a repair.
```

The current evidence is strong: the model-facing editor path
reported successful creation of files under the erroneous
`/Projects/Runtime/srs/...` tree, while subsequent
shell-side removal was denied by Seatbelt. That is enough to
start Q1; a fresh TSWPD capture is NOT required to begin
binding.

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

Find and record the **exact** tool emitted by the model
(`editor`? `write_to_file`? `apply_patch`? hostbridge mutation?
a `controller/file/*` handler?) and the **exact** production
handler that performed the write.

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

This is per-tool, NOT universal. The Q4 seam for the editor
may differ from the Q4 seam for the global-skill creator; the
two tools have different authorized roots and should not
share a single global check.

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

CURRENT_AUTHORITY_CONTRACT =
  WRONG / OVERBROAD  (workspace-universal; would misclassify
                      legitimate global-skill / global-rule /
                      global-hook creation as escapes)

P0 =
  workspace root incorrectly treated as universal writable
  authority; legitimate global-config tools intentionally
  have non-workspace roots

CORRECT_INVARIANT =
  mutation target must remain inside the
  capability-specific authorized writable root(s)

SEATBELT =
  separate shell authority;
  do NOT modify in this recon

PRODUCTION_REPAIR =
  NOT AUTHORIZED  (recon only)

NEXT =
  bounded contract correction (this ACT)
  -> bind exact LIVE file / editor tool (Q1)
  -> identify per-tool authorized root (Q2)
  -> inspect path-authority primitive (Q3)
  -> RED against real production seam with case-G
     global-skill conservation (Q5)
  -> only then inventory sibling paths sharing that
     authority primitive (deferred to a downstream ACT)

VERDICT =
  HALT_WRONG_AUTHORITY_CONTRACT
  (correction applied; recon proceeds with corrected contract)

NEW_REVIEW_ROUND =
  NO
  (the correction is wording / mission / matrix reframing;
   no production code change; no new RED; no new test)
```
