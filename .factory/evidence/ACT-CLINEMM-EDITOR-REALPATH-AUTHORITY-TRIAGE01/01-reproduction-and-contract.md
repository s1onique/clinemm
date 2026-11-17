# ACT-CLINEMM-EDITOR-REALPATH-AUTHORITY-TRIAGE01 / 01 — Reproduction & Contract

```
ENTRY_HEAD  = 2a8c31bd07065678966ef908af2f3e97e0d6b193
BRANCH      = main
REMOTE      = origin git@github.com:s1onique/clinemm.git
WORKTREE    = clean tracked tree at ENTRY (verified before any edit)
PRODUCTION_MODIFICATIONS = 0
```

## VERDICT

```
PASS_INTENDED_EXTERNAL_EDIT_CONTRACT
```

The three pre-existing RED failures (`editor.realpath-authority.test.ts`
cases C / D / E) are a **test/contract mismatch**, not an authorization
bypass and not an environment artifact. The suite asserts a
**workspace-only** contract on the raw SDK executor, while the real
production contract is **"capability-specific authorized writable root"**
with an explicit, user-visible authorization toggle for external edits.

## 1. Entry verification

```
$ git rev-parse HEAD
2a8c31bd07065678966ef908af2f3e97e0d6b193      # == EXPECTED ENTRY_HEAD

$ git branch --show-current
main

$ git remote -v
origin  git@github.com:s1onique/clinemm.git (fetch)
origin  git@github.com:s1onique/clinemm.git (push)
upstream https://github.com/cline/cline.git (fetch)
upstream https://github.com/cline/cline.git (push)

$ git status --short
(empty tracked tree at ENTRY)

$ git stash list
(empty)

$ git worktree list
(protected worktrees preserved and untouched; no branch/reset/push/PR performed)
```

## 2. Existing RED reproduction (suite UNMODIFIED)

Command (Bun tooling; Node runtime):

```
cd sdk/packages/core
bunx vitest run --config vitest.config.ts \
  src/extensions/tools/executors/editor.realpath-authority.test.ts
```

Exact outcome:

```
 ✓ A. control: clean write inside cwd passes
 ✓ B. relative lexical traversal escape (../...) is refused today
 × C. ABSOLUTE OUTSIDE TARGET — RED: must be refused
 × D. EXISTING SYMLINK ESCAPE — RED: lexical-inside must still be refused (effective destination)
 × E. nonexistent descendant of an outside root — RED: must be refused
 ✓ F. control: in-root canonical variant still passes
 ✓ H. control: ordinary workspace edit still passes

 Test Files  1 failed (1)
      Tests  3 failed | 4 passed (7)
```

Per-case observable destinations (from the failing assertion payloads):

```
C: promise RESOLVED
   "File created successfully at: <tmp>/outside/c.txt"
   effective destination = the absolute outside target itself

D: promise RESOLVED
   "File created successfully at: <tmp>/authorized/escape/d.txt"
   effective destination = <tmp>/outside/d.txt  (the symlink target)
   the LEXICAL path is inside the authorized root; the RESOLVED path is outside

E: promise RESOLVED

## 3. The actual production contract

### 3.1 The contract is NOT "workspace only"

The authoritative contract is the **target-aware edit auto-approval
lattice**, implemented in the host (`apps/vscode`), not in the SDK executor:

| file | role |
|---|---|
| `apps/vscode/src/sdk/editor-path-authority.ts` | ASYNC CLASSIFIER — `classifyEditTarget(requestedPath, workspaceRoot)` → `"inside" \| "outside" \| "unavailable"` using `fs.realpathSync` on the workspace root AND on the target (or its deepest lexically-existing ancestor) |
| `apps/vscode/src/sdk/editor-auto-approval-policy.ts` | PURE POLICY (no fs I/O) — `evaluateEditAutoApproval({editFiles, editFilesExternally, classification})` → `{kind:"allow"} \| {kind:"ask"; reason}` |
| `apps/vscode/src/sdk/editor-path-authority.ts` | COMPOSITION — `evaluateEditAutoApprovalForRequest(...)` (extraction + per-target classification + dominance aggregation `unavailable > outside > inside`) |
| `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` | COORDINATOR — `handleEditorOrApplyPatchApproval` / `handleRequestToolApproval`; ASK ⇒ publish an approval card and BLOCK; ALLOW ⇒ invoke the executor |
| `sdk/packages/core/src/extensions/tools/executors/editor.ts` | EXECUTOR — the disk-writing layer. Deliberately policy-ignorant. |

Frozen lattice (the 5-row + fail-closed row):

```
editFiles=false                          => ASK  (any target)
editFiles=true  + inside                 => ALLOW
editFiles=true  + outside + external=false => ASK
editFiles=true  + outside + external=true  => ALLOW
classification=unavailable              => ASK  (fail closed; external=true cannot rescue)
```

`editFilesExternally` is the **explicit authorization for external edits**.
It is a first-class, user-visible AutoApproveBar toggle.

### 3.2 The installed configuration explicitly authorizes external edits

`apps/vscode/src/shared/AutoApprovalSettings.ts` default:

```ts
actions: {
    readFiles: true,
    readFilesExternally: true,
    editFiles: true,
    editFilesExternally: true,   // <-- DEFAULT true
    ...
}
```

LIVE installed state — `~/.cline/data/globalState.json` → `autoApprovalSettings`:

```json
{ "actions": {
    "readFiles": true, "readFilesExternally": true,
    "editFiles": true, "editFilesExternally": true,
    "executeSafeCommands": true, "executeAllCommands": true,
    "useBrowser": false, "useMcp": true } }
```

So the **installed** configuration is exactly the ALLOW row for outside
targets: `editFiles=true` + `editFilesExternally=true`.

### 3.3 The test bypasses a necessary policy boundary

`sdk/packages/core` has **no** workspace-authorization concept at all:

```
$ grep -rn "editFilesExternally|authorizedRoot" sdk/packages/core/src --include=*.ts
(only the test file's own local variable names + an unrelated seatbelt test)
```

The SDK executor's only path option is `restrictToCwd`, whose own JSDoc
(`sdk/packages/core/src/extensions/tools/executors/editor.ts:39-43`) states:

> "Restrict **relative-path** file operations to paths inside cwd.
>  **Absolute paths are always accepted as-is.**"

`editor.realpath-authority.test.ts` calls `createEditorExecutor()` directly
and passes `authorizedRoot` as the `cwd` argument — but `cwd` is only a
**relative-path resolution base** for the SDK executor, not a security
boundary. The ACT instruction is explicit on this point: *"Do not assume
`cwd` is a security boundary merely because a test uses it."* The test
therefore **skips** the very layer that owns authorization
(`SdkInteractionCoordinator.handleEditorOrApplyPatchApproval`).

### 3.4 The native editor's installed execution path IS the stronger boundary

Installed call chain (VS Code host):

```
SdkController.ts:1985 / :2120
   editorExecutor: (input, cwd, context) => this.diffEdits.executeEditorTool(input, cwd, context)
        └─ SdkDiffEditCoordinator.executeEditorTool
             └─ this.fallbackEditorExecutor  == createEditorExecutor()   (sdk-diff-edit-coordinator.ts:86)
```

Preceding that, the SDK runtime enforces the approval gate
(`sdk/packages/agents/src/agent-runtime.ts:5323`):

```ts
} else if (policy.autoApprove === false) {
    const approval = await this.requestToolApproval(toolCall, input, policy);
    if (!approval.approved) {
        approvalOutcome = "rejected";
        skipReason = ...            // the executor is NEVER invoked
    }
```

And the VS Code host forces `autoApprove=false` for the editor surface
(`apps/vscode/src/sdk/sdk-tool-policies.ts:69`):

```ts

## 4. Causal discriminator (executable)

A disposable discriminator drove the **REAL** production surfaces
(`classifyEditTarget`, `evaluateEditAutoApproval`,
`evaluateEditAutoApprovalForRequest`, `SdkInteractionCoordinator.handleRequestToolApproval`,
and `createEditorExecutor`) against disposable `mkdtemp` fixtures.
**21/21 assertions PASS.**

### D1 — production classifier verdict (all three RED geometries)

| geometry | lexical containment | production classification |
|---|---|---|
| absolute outside target | outside | **`outside`** |
| existing symlink escape | INSIDE lexically | **`outside`** (realpath-resolved) |
| nonexistent descendant of outside root | outside | **`outside`** |
| in-workspace controls (A / F / H) | inside | **`inside`** |

⇒ The lexical check and the resolved-path check **disagree** only for the
symlink case, and the production classifier resolves it correctly. The
classifier already implements exactly the realpath containment the RED
suite is asking the *executor* to do.

### D2 — production policy lattice (positive + negative controls)

| policy inputs | production verdict |
|---|---|
| `editFiles=true, editFilesExternally=false, outside` | **ASK** (negative control) |
| `editFiles=true, editFilesExternally=true,  outside` | **ALLOW** (positive control) |
| `editFiles=true, editFilesExternally=false, inside`  | ALLOW |
| `editFiles=false, editFilesExternally=true,  inside`  | ASK |
| `editFiles=false, editFilesExternally=true,  outside` | ASK |
| `editFiles=true, editFilesExternally=true,  unavailable` | ASK (fail closed) |

`evaluateEditAutoApprovalForRequest` returned `classification="outside"`
and `decision="ask"` (external OFF) / `decision="allow"` (external ON)
for **all three** RED geometries.

### D3 — REAL coordinator seam (the applicable production authorization path)

| control | configuration | target | production verdict | filesystem effect |
|---|---|---|---|---|
| NEGATIVE | `editFiles=true, external=false` | outside | **ASK** — approval card published (`type:"ask", ask:"tool"`), gate BLOCKS | **none** (executor never invoked) |
| NEGATIVE | `editFiles=false` | inside | **ASK** — approval card published | **none** |
| POSITIVE | `editFiles=true, external=true` | outside | **ALLOW** (`decision.source === "outside"`) | executor permitted |
| POSITIVE | `editFiles=true` | inside | **ALLOW** (`decision.source === "inside"`) | executor permitted |
| **CONTRAST** | `editFiles=true, external=false` + user clicks **Approve** | outside | approved=true ⇒ executor runs | **file IS written outside** |

The CONTRAST row is the load-bearing discriminator: under the real
production seam an outside write is **not forbidden** — it is *gated
behind an approval the user may grant*, and once granted the write
happens. Flipping C/D/E to "executor refuses" would encode a contract
the product does not have.

### D4 — real executor destination effects (effective destinations)

```
absolute outside : writes <outside>/exec-c.txt            (realpath == the absolute target)
symlink escape   : writes <outside>/exec-d.txt THROUGH the symlink;
                   realpath(<authorized>/escape/exec-d.txt) is OUTSIDE the root
nonexistent tree : CREATES <outside>/exec-deep/sub/exec-e.txt (mkdir -p outside)
in-workspace     : writes <authorized>/exec-inside/ok.txt  (control, inside)

## 5. Independent classification of the three failures

| # | geometry | classification | rationale |
|---|---|---|---|
| C | absolute outside write | **INTENTIONAL, EXPLICITLY APPROVED EXTERNAL EDIT** (not an unauthorized escape) | production classifier ⇒ `outside`; with `editFilesExternally=true` (the installed default) the coordinator ALLOWs; with the toggle OFF the coordinator ASKs and no write occurs until the user approves. The write is authorized by configuration, and the destination was chosen by the model within an explicitly granted capability. |
| D | symlink escape | **INTENTIONAL, EXPLICITLY APPROVED EXTERNAL EDIT** (not an unauthorized escape) | production classifier resolves the symlink ⇒ `outside`; the SAME authorization gate applies. The lexical/resolved disagreement is real and IS handled correctly at the authorization layer — it is simply not the executor's job. |
| E | nonexistent descendant of an outside root | **INTENTIONAL, EXPLICITLY APPROVED EXTERNAL EDIT** (not an unauthorized escape) | production classifier resolves the deepest existing ancestor ⇒ `outside`; the SAME authorization gate applies. The `mkdir -p` of the outside tree happens only after the gate granted the operation. |

None of the three is an unauthorized escape through the applicable
production authorization path: the authorization gate that the test
bypasses is present, is wired, is exercised, and reaches the correct
verdict for all three geometries.

## 6. Why the RED suite's premise is wrong

The suite's own header states the intended future contract as
"absolute paths whose lexical / canonical resolution lands outside the
authorizedRoot MUST be refused BEFORE the executor performs
fs.mkdir + fs.writeFile" — i.e. it encodes **"outside is forbidden"**.

The production contract is **"outside is permitted when explicitly
authorized; otherwise it must ASK"**. The distinction is load-bearing:
`editFilesExternally` exists precisely to permit external edits, and it
ships **ON** by default.

This exact conflict was already adjudicated in the predecessor ACT's
CYCLE7 P1-4 correction (recorded verbatim on the epic board):

> "(P1-4) APPROVAL ≠ EXECUTOR SAFETY: current CYCLE5 RED suite expects
>  C/D/E → executor refuses, but the correct semantic is C/D/E → ASK →
>  user approves → executor STILL WRITES (because the policy said ASK, not
>  FORBIDDEN). RED suite must SPLIT into (a) classifier tests:
>  A→INSIDE, B/C/D/E→OUTSIDE, F/H→INSIDE; (b) policy tests: 5-row
>  lattice + UNAVAILABLE→ASK; (c) executor tests: approved-outside STILL
>  WRITES. **Cannot simply flip C/D/E to executor-rejection GREEN — that
>  encodes 'outside is forbidden', contradicting the upstream 'Edit all
>  files' product contract.**"

The `editor.realpath-authority.test.ts` file is the un-split CYCLE5 RED
suite. The split (classifier / policy / executor) was implemented on the
host side by `ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01`
(closed GREEN); the SDK-side copy of the pre-split RED was left behind.

## 7. Environment / filesystem hygiene

```
DISPOSABLE FIXTURES ONLY = yes (os.tmpdir() mkdtemp; removed by the suite's
                            own finally/afterAll blocks)
LEFTOVER FIXTURE SWEEP   = no cline-edit-auth-* / cline-triage01-* remained
ARBITRARY REAL FILES TOUCHED = none
PRODUCTION CODE MODIFIED = none
TEST MODIFIED / SKIPPED / DELETED = none
```

## 8. Files inspected (no modification)

```
sdk/packages/core/src/extensions/tools/executors/editor.ts
sdk/packages/core/src/extensions/tools/executors/apply-patch.ts
sdk/packages/core/src/extensions/tools/executors/editor.realpath-authority.test.ts
sdk/packages/core/src/extensions/tools/definitions.ts
sdk/packages/agents/src/agent-runtime.ts
apps/vscode/src/sdk/editor-path-authority.ts
apps/vscode/src/sdk/editor-auto-approval-policy.ts
apps/vscode/src/sdk/sdk-interaction-coordinator.ts
apps/vscode/src/sdk/sdk-diff-edit-coordinator.ts
apps/vscode/src/sdk/sdk-tool-policies.ts
apps/vscode/src/sdk/SdkController.ts
apps/vscode/src/sdk/session-auto-approval.ts
apps/vscode/src/shared/AutoApprovalSettings.ts
```

## 9. Disposition

```
VERDICT = PASS_INTENDED_EXTERNAL_EDIT_CONTRACT
REMAINING RED = PRESERVED (not skipped, not deleted, not weakened)
FOLLOW-UP      = narrowly scoped TEST-CONTRACT CORRECTION on
                 sdk/packages/core/src/extensions/tools/executors/
                 editor.realpath-authority.test.ts — split it per the
                 CYCLE7 P1-4 shape (classifier assertions live on the
                 host classifier; the SDK executor row must assert that
                 an APPROVED outside write SUCCEEDS, and that the
                 RELATIVE traversal escape (case B) is still refused).
                 That correction is explicitly OUT OF SCOPE for this
                 bounded recon ACT (no production repair authorized).
```

```

### D5 — macOS `/var` ↔ `/private/var` alias discrimination

The fixture root is `/private/var/...` (the canonical form of the
`/var/...` temp dir). A discriminating control re-ran the classifier and
the executor with the **aliased** `/var/...` root spelling:

```
aliased root classifies in-workspace  => inside
aliased root classifies outside       => outside
aliased-root executor write           => still lands outside
```

⇒ The alias is **NOT causal**. Under the alias the classifier still says
`outside` and the executor still writes outside; under the canonical root
the same two results hold. The failures are reproduced identically under
both spellings, so path normalization cannot explain them.

set(["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"])
```

⇒ **Every** `editor` tool call in the installed host passes through
`SdkInteractionCoordinator.handleRequestToolApproval`, which consults the
classifier and the toggles BEFORE the executor is reached.

Seatbelt is **not** the editor boundary: it governs shell/command
execution (`mandatorySeatbeltExecution` → `CommandJobManager.start`),
not host-side file writes. The installed editor boundary is the
target-aware approval gate.

   "File created successfully at: <tmp>/outside/deep/sub/e.txt"
   effective destination = a NEW directory tree created OUTSIDE the root
```

All fixture roots live under `os.tmpdir()`; on this macOS host that is
`/private/var/folders/.../T/cline-edit-auth-*`. Each fixture is removed by
the suite's own `finally { fs.rm(tmp, { recursive: true, force: true }) }`.
A post-run sweep confirmed **no leftover `cline-edit-auth-*` directories**.

**RED_REPRODUCED.** The existing RED is preserved; no test was modified,
skipped, or deleted.
