# 04 — Source revision resolver and session secret storage (G3, G4)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
**Classification:** STRUCTURAL

## G3 — The trusted source revision resolver

### The adapter

`apps/vscode/src/sdk/adjudication-source-revision-resolver.ts` implements the
SDK's existing `SourceRevisionResolver` contract. It establishes the five
facts the SDK's `SourceRevision` requires:

| Fact | How it is established | Non-disclosure |
|---|---|---|
| `repositoryIdentity` | `git remote get-url origin`, credential-stripped, SHA-256 digested. Falls back to a digest of the workspace identity when there is no `origin`. | A digest — never the URL itself, and never the embedded token. |
| `workspaceRootIdentity` | SHA-256 of the REALPATH of the workspace root. | The ABSOLUTE PATH is never carried (it would disclose the operator's home directory). |
| `revision` | `git rev-parse HEAD`. | A commit sha — not sensitive. |
| `contentIdentity` | SHA-256 of the file's CURRENT bytes. | A digest. |
| `clean` | `git status --porcelain` is empty. | A boolean. |

### No second Git abstraction

The adapter uses `node:child_process`'s `execFile` directly rather than
adding a new git wrapper, because the existing `apps/vscode/src/utils/git.ts`
helpers do NOT expose the full fact set the contract needs (remote URL,
porcelain status, and a per-file content digest) and are shaped for UI
queries rather than for an identity resolver. The adapter therefore makes
exactly FOUR git invocations (`rev-parse HEAD`, `remote get-url origin`,
`status --porcelain`) and one file read, and it owns no repository model of
its own.

### The source boundary — every rule fails CLOSED

| Rule | Behaviour | Witness |
|---|---|---|
| Path outside the authorized workspace | `undefined` | RED-3: "fails closed for a source path OUTSIDE the authorized workspace" |
| Symlink escape | `undefined` (the RESOLVED candidate must still be under the RESOLVED root) | lexical + symlink containment |
| Path does not exist | `undefined` | — |
| Path is not a regular file | `undefined` | — |
| Workspace is not a git repository / has no commit | `undefined` | — |
| NUL byte in the path | `undefined` | — |
| **Tool is not a source-observing tool** | `undefined` | RED-3: "captures NO acquisition for a run_commands result (evidence class gate)" |

### G3.2 — Acquisition-time semantics

The resolver is invoked **once, at acquisition**, by the SDK's
`captureAcquisitionEvidence`. The resulting record rides ON the canonical
tool-result block (`attachAcquisitionToToolResult`), so it is part of the
DURABLE canonical history and is restored with it.

Candidate evaluation READS the stored record. It never asks the workspace
what the file looks like now. This is the SDK's existing behaviour, and the
ACT did not change it.

The acquisition-time binding is witnessed by the runtime-chain suite: the
acquisition record carries the resolver's revision, and the same record is
rebuilt from the canonical history after a host recreation
(`buildAcquisitionEvidenceLedger`), so the evidence identity survives without
a workspace re-read.

### G3.4 — The mandatory evidence-class discriminator

**The implementation recognizes `read_files`, NOT arbitrary shell commands.**
This is inherited from the SDK's existing closed set
(`SOURCE_OBSERVING_TOOL_NAMES = { "read_files" }`) and is NOT widened by this
ACT. The adapter mirrors the same closed set, so the resolver cannot establish
a source identity for a `run_commands` result even if the SDK's own set were
widened without the adapter being updated.

Witnessed twice:
- the adapter's own tool gate (RED-2 in the producer suite);
- the SDK's acquisition seam gate (RED-3 in the runtime-chain suite).

## G4 — The restorable session secret provider

### The adapter

`apps/vscode/src/sdk/adjudication-session-secret.ts` implements the SDK's
`secretProvider?: (sessionId: string) => string | Promise<string>`.

### The trusted storage

The secret is stored in the extension's TRUSTED secret store: the
file-backed `secrets.json` (mode 0o600) behind `StateManager`. The key
`adjudicationSessionSecrets` was added to `SECRETS_KEYS` in
`apps/vscode/src/shared/storage/state-keys.ts`.

The store is a JSON object keyed by session id:

```
{ "<sessionId>": "<32 hex chars>" }
```

The secret is NOT stored in:
- workspace settings,
- a repository file,
- a task prompt,
- a provider request,
- a debug log,
- the committed evidence package.

The OPAQUE evidence handle is model-visible; the secret is not.

### The three-mode contract

| Mode | Factory | Behaviour |
|---|---|---|
| START | `createSessionSecretProviderForStart()` | A session with no stored secret gets a fresh secret, which is PERSISTED. A session with a stored secret gets THAT secret (so a REBUILD keeps its handles). |
| RESTORE | `createSessionSecretProviderForRestore()` | NEVER persists. A session with a stored secret gets THAT secret. A session with NO stored secret gets a fresh IN-MEMORY-ONLY secret — which the SDK registry reports as `isRestorable() === false`. |
| Generic | `createSessionSecretProvider({ allowCreate })` | The two above are thin wrappers over this. |

### Session scoping

- The same session + the same secret ⇒ the SAME evidence handle (a pure
  function of `(secret, sessionId, toolUseId)`).
- A different session ⇒ a DIFFERENT secret and therefore a DIFFERENT handle.
- There is NO cross-session lookup.

Both directions are witnessed in the runtime-chain suite:
- RED-6 "re-derives the SAME evidence handle after a host recreation":
  `secretB === secretA` and `handleB === handleA`, and the restored
  acquisition ledger still carries the original record.
- RED-6 "FAILS CLOSED for a DIFFERENT session (no cross-session handle
  reuse)": `secretB !== secretA`, `handleB !== handleA`, and a handle minted
  in session A does not resolve in session B
  (`canonical_refs_resolved === false`, `candidate_accepted === false`).

### The fail-closed rule for a missing secret

When the secret for a session cannot be recovered, the provider hands back a
fresh, IN-MEMORY-ONLY secret rather than persisting a new one. The SDK's
registry then reports `isRestorable() === false` and the runtime reports the
degradation instead of claiming a restoration it cannot perform.

This is the load-bearing detail: persisting a NEW secret for a session whose
historical handles exist would make those handles resolve to nothing while
LOOKING like a successful restore — the exact fail-open the SDK contract
forbids.
