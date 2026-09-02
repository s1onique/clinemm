# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01

> Status: **OPEN / RECON_LANE_AUTHORIZED / NO_LIVE_FAIL_BIND_YET**.
> RECON ONLY, no production repair yet.
>
> ```text
> ENTRY_HEAD  = 217e7f53c (the Q5 GREEN + repair commit; this ACT
>               opens immediately after the Factory causal reviewer
>               verdict PASS_WITH_ONE_P1_FIX / C1: GO_FILE_TOOL_
>               SECURITY_RECON)
> SUBJECT_HEAD = 217e7f53c
> TRIAGE_HEAD = (this commit; no TRIAGE_BIND until a real
>               symptom is bound)
> ```
>
> Operational state: opening RECON lane for the **file-tool
> workspace-escape authority** candidate. The umbrella ACT's Q5
> matrix is implementation-closed at `217e7f53c` with
> `WAITING_Q5_IMPLEMENTATION = CLOSED` and
> `FRESH_POST_REPAIR_LIVE = PENDING / NON-BLOCKING`. Per the Factory
> causal reviewer verdict, this file-tool security lane takes priority
> because our live evidence already suggests a model-controlled
> **host file mutation** created `/Projects/Runtime/...` outside the
> workspace while shell-side deletion later hit Seatbelt denial —
> a containment-boundary candidate that the post-Q5-GREEN um ACT
> cannot host.
>
> Owned by `EPIC-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY01`
> (open alongside this ACT in the next deferred-work entry).
>
> **Note:** `FRESH_POST_REPAIR_LIVE` does NOT gate this ACT; the
> two lanes are independent. Dogfood qualification for the Q5
> repair runs in parallel.

## 0. Mission (per Factory reviewer C1: GO_FILE_TOOL_SECURITY_RECON)

Determine whether the **file-mutation API surface** that the
model can drive through gRPC / SDK provides a **containment-boundary
guarantee** between:

  - paths inside the configured workspace, and
  - paths outside the workspace (global rules/skills/hooks
    directories, `$HOME`-rooted paths, `/Projects/Runtime/...`,
    `/tmp`, etc.).

The candidate violation class is: **a model-supplied name or path
component is concatenated to a base directory without an authoritative
workspace-bounded realpath check, allowing writes outside the
workspace via path traversal or absolute-path substitution.**

This ACT scopes a bounded recon cycle analogous to the umbrella
ACT's Q1–Q5 cycle, but applied to the file-tool surface:

  - **Q1**: enumerate every controller endpoint under
    `apps/vscode/src/core/controller/file/` that takes a
    model-controlled name/path and writes to disk.
  - **Q2**: identify the sanitization regime at each call site
    (regex strip, basename, path.join, fs.realpathSync, none).
  - **Q3**: identify the **base-directory authority** at each call
    site — is the base directory itself workspace-bounded, or
    is it a global config path that lets the model write to
    `$HOME/.cline/...` / `/Projects/Runtime/...`?
  - **Q4**: identify the lowest already-authoritative seam that
    could enforce a workspace-bounded realpath containment check
    for ALL file-mutation paths.
  - **Q5**: only then, formulate the actual RED with
    controls/ablations.

## 1. Live-evidence anchor (NOT yet TRIAGE_BIND)

```text
Candidate symptom (NOT yet a TRIAGE_BIND specimen):
  /Projects/Runtime/... was created by a model-controlled host file
  mutation while the workspace was elsewhere.
  Shell-side deletion later hit Seatbelt denial.

This is the reviewer's evidence pointer for opening this lane.
The candidate symptom has not been bound to a TSWPD record,
a real-shell run, or a model transcript. The recon is
read-only; no symptom is yet tied to a concrete code path.
```

## 2. Initial scan (already in progress)

```text
apps/vscode/src/core/controller/file/  (29 .ts files)
  - createSkillFile.ts          : skillName -> sanitizedName -> path.join(skillsDir, sanitizedName) -> fs.writeFile
                                  sanitization: /[^a-zA-Z0-9_-]/g stripped
                                  but base directory (globalSkillsDir / localSkillsDir)
                                  may be `$HOME`-rooted, NOT workspace-bounded
  - createHook.ts               : hookName -> fs.writeFile (validated against VALID_HOOK_TYPES;
                                  not string-stripped, but limited by enumeration)
  - createRuleFile.ts           : (to be read)
  - deleteSkillFile.ts          : (to be read)
  - deleteRuleFile.ts           : (to be read)
  - openFile.ts                 : writes a temp file (domain: tempdir)
  - writeFile paths from the    : (to be enumerated)
    CLI/Hook handlers

Tools that may bypass the controller layer:
  - hostbridge-tool wrappers under apps/vscode/src/hosts/vscode/...
  - direct `fs.writeFile` callers in any non-controller path

Sandbox-policy authority:
  - CommandJobManager.start refuses host-shell fallback when
    mandatorySeatbeltExecution=true (per ACT-CLINEMM-SEATBELT-...)
  - File-tool authority is a SEPARATE question from shell authority;
    Seatbelt denies SHELL deletion of the same file the FILE-TOOL
    wrote. This is the containment-boundary candidate.
```

## 3. Reconnaissance plan (Q1–Q5)

The recon is bounded. The scope is intentionally narrow: read the
file-tool surface; do NOT yet change code; do NOT yet bind a RED
to a real live symptom.

### Q1: endpoint enumeration

Enumerate every controller endpoint (gRPC handler, SDK
executor, hostbridge-tool wrapper) that:

  - accepts a model-controlled name/path component, AND
  - calls `fs.writeFile`, `fs.appendFile`, `fs.mkdir`,
    `fs.symlink`, `fs.rename`, `fs.copyFile`, `fs.unlink`,
    or any vscode.workspace.fs write, AND
  - is reachable from a tool-call prompt response.

Deliverable: a table in
`.factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/01-endpoint-enumeration.md`.

### Q2: sanitization regime

For each Q1 endpoint, record:

  - input string (model-controlled)
  - sanitization transform (regex / basename / none)
  - base-directory source (workspace-resolved / global config / tempdir)
  - containment authority check (fs.realpathSync startsWith /
    workspaceResolver.resolveWorkspacePath / none)

Deliverable: a table in
`.factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/02-sanitization-regime.md`.

### Q3: base-directory authority

For each Q1 endpoint, answer:

  - Is the base directory workspace-bounded (cannot escape via `..`)?
  - If global: is the absolute path `realpath`-checked before write?
  - Does the file-tool path differ from the shell-tool Seatbelt
    policy?

Deliverable: a section in
`.factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/02-sanitization-regime.md`.

### Q4: lowest composition seam

Identify the lowest already-authoritative seam where a
workspace-bounded realpath containment check could be inserted
ONCE (e.g., a wrapper over `fs.writeFile` that requires
workspace-resolved paths; OR a new option on
`WorkspaceResolver.resolveWorkspacePath` that fails closed when
the resolved path escapes the configured roots).

Deliverable: a section in
`.factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/03-composition-seam.md`.

### Q5: RED formulation

Only after Q1–Q4. Per the umbrella ACT's pattern, the RED
matrix is:

```text
A. model-supplied name contains path traversal ("..")
   with global base directory
   -> write target resolves OUTSIDE the workspace
   -> MUST be refused (RED)

B. model-supplied name is absolute (e.g. "/etc/passwd")
   -> write target resolved absolutely
   -> MUST be refused (RED)

C. model-supplied name is clean alphanumeric,
   global base directory
   -> write target stays inside the global config
   -> ALLOWED (control / no false positive)

D. model-supplied name is clean alphanumeric,
   workspace-resolved base directory
   -> write target stays inside the workspace
   -> ALLOWED (control / regression-preserving)
```

## 4. Conservation and stop rules

```text
PRODUCTION_FILES_CHANGED = 0 during the recon (Q1–Q5 read-only)
NO production repair until:
  - Q5 RED is authored
  - Factory reviewer authorizes the repair
  - Conservation proof (ACAS01-equivalent for the file-tool
    surface) is captured
```

## 5. Exit (one of three useful outcomes)

After Q5:

```text
1. CLOSED / RED_BOUND + REPAIR_AUTHORIZED
   the symptom is bound to a real call path; the lowest seam is
   identified; a narrow repair is authorized in a follow-up ACT.

2. NO_RED_FOUND
   the live evidence cannot be reproduced; the lane is closed
   pending fresh evidence.

3. SYMPTOM_REQUIRES_LIVE_BIND
   the recon identifies a candidate but cannot reproduce without
   a fresh live TSWPD capture; the lane is parked at
   FRESH_LIVE_BIND_PENDING and the umbrella ACT pivots.
```

## 6. Sequence after this ACT

This ACT opens the file-tool security lane. It does NOT modify
the umbrella ACT's Q5 work (which is implementation-closed).
`FRESH_POST_REPAIR_LIVE` for the Q5 repair runs in parallel and
does NOT gate this ACT.

If this ACT closes with REPAIR_AUTHORIZED, a bounded child ACT
implements the containment check at the seam identified in Q4.
That child ACT follows the same contract ACT / implementation ACT
/ Q5-RED matrix discipline used for
`BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01`.

## 7. Sign-off gate (per the umbrella ACT's discipline)

Before this ACT can close with REPAIR_AUTHORIZED:

```text
- typecheck apps/vscode        = clean
- ACAS01 vitest                = preserved (4/4 PASS)
- BHTD01 vitest                = preserved (6/6 PASS)
- Q5RR01 vitest                = preserved (6/6 PASS)
- Q1 endpoint enumeration      = AUTHORED
- Q2/Q3 sanitization + base    = AUTHORED
- Q4 composition seam          = AUTHORED
- Q5 RED matrix                = AUTHORED + EXECUTED
- necessity ablation           = REPRODUCED
- git diff --check             = silent
- working tree                 = clean
```
