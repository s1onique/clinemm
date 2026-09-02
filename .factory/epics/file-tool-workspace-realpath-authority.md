# EPIC-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY01

> Status: **OPEN / RECON_LANE_AUTHORIZED / NO_LIVE_FAIL_BIND_YET**.
> Owned ACT: `ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01`.

## Mission

Determine whether the **file-mutation API surface** that the
model can drive through gRPC / SDK provides a
**containment-boundary guarantee** between:

  - paths inside the configured workspace, and
  - paths outside the workspace (global rules/skills/hooks
    directories, `$HOME`-rooted paths, `/Projects/Runtime/...`,
    `/tmp`, etc.).

The candidate violation class is: **a model-supplied name or path
component is concatenated to a base directory without an authoritative
workspace-bounded realpath check, allowing writes outside the
workspace via path traversal or absolute-path substitution.**

## Live-evidence anchor (NOT yet TRIAGE_BIND)

```text
Candidate symptom (NOT yet a TRIAGE_BIND specimen):
  /Projects/Runtime/... was created by a model-controlled host file
  mutation while the workspace was elsewhere.
  Shell-side deletion later hit Seatbelt denial.

Source: Factory causal reviewer verdict on commit 217e7f53c
("live evidence already suggests a model-controlled host file
mutation created /Projects/Runtime/... outside the workspace
while shell-side deletion later hit Seatbelt denial").

NOT yet bound to:
  - a real-shell run
  - a TSWPD capture
  - a model transcript
  - a specific controller endpoint
```

## Initial scan (already in progress at the umbrella ACT level)

```text
apps/vscode/src/core/controller/file/  (29 .ts files)
  - createSkillFile.ts          : skillName -> sanitizedName -> path.join(skillsDir, sanitizedName) -> fs.writeFile
                                  sanitization: /[^a-zA-Z0-9_-]/g stripped
                                  but base directory (globalSkillsDir / localSkillsDir)
                                  may be $HOME-rooted, NOT workspace-bounded
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

## Q1-Q5 bounded recon cycle

Follows the same discipline as the umbrella ACT's Q1-Q5 cycle:

  - **Q1**: enumerate every controller endpoint under
    `apps/vscode/src/core/controller/file/` that takes a
    model-controlled name/path and writes to disk.
  - **Q2**: identify the sanitization regime at each call site
    (regex strip, basename, path.join, fs.realpathSync, none).
  - **Q3**: identify the **base-directory authority** at each call
    site - is the base directory itself workspace-bounded, or
    is it a global config path that lets the model write to
    `$HOME/.cline/...` / `/Projects/Runtime/...`?
  - **Q4**: identify the lowest already-authoritative seam that
    could enforce a workspace-bounded realpath containment check
    for ALL file-mutation paths.
  - **Q5**: only then, formulate the actual RED with
    controls/ablations.

## Q5 RED matrix (target)

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

## Conservation and stop rules

```text
PRODUCTION_FILES_CHANGED = 0 during the recon (Q1-Q5 read-only)
NO production repair until:
  - Q5 RED is authored
  - Factory reviewer authorizes the repair
  - Conservation proof (ACAS01-equivalent for the file-tool
    surface) is captured
```

## Conservation at ENTRY (preliminary)

```text
typecheck apps/vscode = clean (0 errors) at ENTRY 217e7f53c
ACAS01 vitest          = 4/4 PASS preserved at b072d9807
BHTD01 vitest          = 6/6 PASS
Q5RR01 vitest          = 6/6 PASS new this turn
git diff --check       = silent
working tree           = clean
```

## Exit (one of three useful outcomes)

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

## Sequence after this EPIC

This EPIC opens the file-tool security lane. It does NOT modify
the umbrella ACT's Q5 work (which is implementation-closed at
`217e7f53c` with `WAITING_Q5_IMPLEMENTATION = CLOSED` and
`FRESH_POST_REPAIR_LIVE = PENDING / NON-BLOCKING`; the dogfood
qualification runs in parallel and does NOT gate this ACT).

If this EPIC closes with REPAIR_AUTHORIZED, a bounded child ACT
implements the containment check at the seam identified in Q4.
That child ACT follows the same contract ACT / implementation ACT
/ Q5-RED matrix discipline used for
`BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01`.
