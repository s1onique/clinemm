# ACT-CLINEMM-UPSTREAM-LIVE-HUB-CROSSCLIENT-QUALIFICATION01 — C1: Production Topology Discriminator

**Answers are given from ACTUAL RUNTIME TRACES and PRODUCTION SOURCE, not architecture diagrams.**

## VERDICT (one line)

> **VS Code = LOCAL-ONLY (`backendMode:"local"` → in-process `LocalRuntimeHost`).**
> **CLI = hub-capable (`backendMode:"auto"` → `HubRuntimeHost` when a compatible hub exists).**
> **⇒ `VS_CODE_INTEROP_NOT_EXECUTED`. C2 was NOT entered. The ACT stops here.**
> The supported alternative is **CLI ↔ CLI on one isolated Hub**, whose production attach path is
> **STRUCTURALLY PROVEN** but **NOT YET LIVE-EXERCISED**.

---

## 1. Is the installed `codium-clinemm` extension using the Hub-backed runtime, or a local in-process `LocalRuntimeHost`?

**ANSWER: LOCAL in-process `LocalRuntimeHost`. The installed VS Code extension never uses the Hub.**

### 1.1 Three independent lines of evidence, all pointing to LOCAL

**(a) Source seam at ENTRY_HEAD — `REAL_PRODUCTION_SEAM`**

`apps/vscode/src/sdk/vscode-session-host.ts:474-475`

```ts
const inner = await ClineCore.create({
    backendMode: "local",
```

`VscodeSessionHost.create()` is the ONLY `ClineCore.create()` mode decision in `apps/vscode/src/`:

```
$ grep -rn 'backendMode' apps/vscode/src/ --include='*.ts'
apps/vscode/src//sdk/vscode-session-host.ts:475:			backendMode: "local",
```

(One match. One host. One mode.)

**(b) The installed bundle — byte-level proof in the LIVE artifact — `REAL_PRODUCTION_SEAM`**

The live installed bundle
`~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-06076666e/dist/extension.js`
(sha256 `f552118e272db6a9d5948ea17aff444a8c85cd768fd709975a67d518156e1047`) contains the
`ClineCore.create({backendMode:"local", …})` call at byte offset **25477111**, immediately preceded by
the `source:"vscode"` marker — proving it is the VS Code seam, not the CLI's. The bundle also contains
`backendMode:"auto"` at offset 11925546 (the `auto` fallback branch of `createRuntimeHost`) and the
`resolveConfiguredBackendMode` resolver at offsets 10587248/10587269.

**Why the env override cannot rescue it:** `resolveConfiguredBackendMode` checks
`options.backendMode` **before** `CLINE_SESSION_BACKEND_MODE`
(`sdk/packages/core/src/runtime/host/host.ts:20-30`):

```ts
if (options.backendMode) {
    return options.backendMode;      // ← VS Code passes "local"; the env var is never consulted
}
...
const raw = process.env.CLINE_SESSION_BACKEND_MODE?.trim().toLowerCase();
```

⇒ Setting `CLINE_SESSION_BACKEND_MODE=hub` for the extension host has **no effect** on the VS Code
runtime selection. There is **no supported configuration knob** that moves the VS Code extension onto
a Hub.

**(c) Live filesystem/runtime traces of the running VSCodium — `LIVE`**

| Trace | Result | Discriminator |
|---|---|---|
| `~/.vscodium-clinemm/cline-data/locks/hub/` | **absent** | VS Code never wrote a Hub discovery record ⇒ it never resolved or started a Hub |
| `~/.vscodium-clinemm/cline-data/sessions/` | **495** session directories | sessions are in the **local** file store |

### 1.2 Why the hub-capable code in the VS Code bundle is irrelevant

The bundle contains `session.attach`, `session.create`, `CLINE_SESSION_BACKEND_MODE` and the full
`createRuntimeHost` resolver because the **SDK core** (`@cline/core`) is bundled wholesale into the
extension. The VS Code **host seam** selects `local`; the hub-capable machinery is present but
**unreachable from VS Code**. Presence of an API in the bundle is **not** reachability.

---

## 2. Does client B discover the same daemon instance/session as A? Which `session_id`, `client_id`, build fingerprint and discovery record are actually observable?

**ANSWER for VS Code (A) → CLI (B): NO. The two clients are in different runtimes and never share a
daemon instance, because A has no daemon instance at all.**

**ANSWER for CLI (A) → CLI (B): YES, and the identity fields are fully observable. Details in §2.2.**

### 2.1 VS Code ↔ CLI — the daemon-instance discriminator

| Identity field | VS Code (A) | CLI (B) | Same? |
|---|---|---|---|
| Runtime host | `LocalRuntimeHost` (in-process) | `HubRuntimeHost` (when a hub exists) | **NO** |
| Daemon instance | **none** — VS Code starts no Hub | one shared Hub daemon | **NO** |
| Hub discovery record | **absent** (`cline-data/locks/hub/` does not exist) | `<CLINE_DIR>/data/locks/hub/owners/<owner>.json` | **NO** |
| Build fingerprint (`resolveHubBuildId()`) | VSIX-embedded build id | `source-0.2.0` (source build) — **different** | **NO** |
| `session_id` | local sqlite/file store ids | Hub session ids | **NO** (different id spaces) |
| `client_id` | local, never registered with a Hub | registered on `client.register` with the Hub | **NO** |
| Session visibility | n/a | B can only see Hub-owned sessions | — |

**Two independent disqualifiers, either one sufficient:**
1. **Runtime split** — A has no Hub to attach to (C1 §1).
2. **Build-fingerprint split** — even if A were Hub-backed, the VSIX's embedded build id differs from
   the source CLI's `source-0.2.0`, and `isManagedHubReusable` rejects on `build_mismatch`
   (`sdk/packages/core/src/hub/discovery/index.ts:178-183`).

⇒ **No VS Code ↔ CLI attachment is possible with the current production implementation, and none was
attempted.** The ACT label is **`VS_CODE_INTEROP_NOT_EXECUTED`**.

### 2.2 CLI ↔ CLI — the observable identity fields (STRUCTURAL; to be observed LIVE in the next gate)

| Field | Where it comes from | Observable? |
|---|---|---|
| Hub `hubId` | `HubServerDiscoveryRecord.hubId` (`discovery/index.ts:26`) | **YES** — written into the discovery record |
| Hub `url` (ws://host:port/pathname) | `HubServerDiscoveryRecord.url` | **YES** — in the discovery record; printed by `cline hub status` |
| Hub `pid` | `HubServerDiscoveryRecord.pid` | **YES** — same record |
| `authToken` | `HubServerDiscoveryRecord.authToken` | **YES but REDACTED** — presence only in evidence; the value must never be committed |
| `protocolVersion`, `minClientProtocolVersion`, `maxClientProtocolVersion` | discovery record | **YES** — protocol compatibility identity |
| `buildId`, `buildEpochMs` | discovery record / `resolveHubBuildId()` | **YES** — the build fingerprint |
| `coreVersion` | discovery record | **YES** |
| `capabilities[]` | discovery record | **YES** — e.g. `connector.start`, `connector.supervised` |
| `session_id` | `HubSessionRow.sessionId` via `session.get` | **YES** |
| `client_id` | `client.register` reply; echoed in `session.attached` events | **YES** |
| `startedAt`, `updatedAt` | discovery record / session row | **YES** |


---

## 3. Can B read session/status/events through `HubSessionClient.getSession`, `readMessages`, `streamEvents` or documented CLI `--id`/history **without starting a new session**?

**ANSWER: YES for `getSession` / `readMessages` / `streamEvents` (read-only, and they do NOT start a
session). The CLI `--id` path is a genuine REATTACH — but it travels over `session.create`, and the
no-second-run guarantee is enforced server-side by the reattach branch. See §3.2.**

### 3.1 The read-only observation APIs (no session start)

`sdk/packages/core/src/hub/client/session-client.ts`:

| API | Line | Hub command | Starts a session? |
|---|---|---|---|
| `getSession(sessionId)` | 455 | `session.get` | **NO** — pure read; returns `undefined` on `session_not_found` |
| `readMessages(sessionId)` | 469 | `session.messages` | **NO** — pure read |
| `streamEvents({clientId, sessionIds}, handlers)` | 639 | event subscription | **NO** — subscribes to the Hub event bus; filterable by `sessionIds` |
| `listSessions({limit})` | 587 | `session.list` | **NO** |
| `abortRuntimeSession(sessionId)` | 433 | `run.abort` | **NO** (but mutating — reserved for C3) |

### 3.2 The CLI `--id` attach path — traced end to end (STRUCTURAL)

```
cline --id <session-id>
  → apps/cli/src/main.ts:728-741
        resumeSessionId = sessionId
        startupTarget = "chat"
        args = { ...args, interactive: true, prompt: undefined }     ← NO PROMPT
  → apps/cli/src/main.ts:1209  runInteractive(config, …, resumeSessionId, …)
  → apps/cli/src/runtime/interactive/session-runtime.ts:302-317
        manager = createCliCore({ backendMode: "auto", forceLocalBackend: false })   ← hub-capable
        startResumedSession(resumeSessionId, initialMessages)
  → apps/cli/src/runtime/interactive/session-runtime.ts:272-296
        manager.start({ source: CLI, config: { …, sessionId: resumeId },
                        interactive: true, initialMessages, NO prompt })
  → HubRuntimeHost.startSession  (hub-runtime-host.ts:949-1026)
        this.client.command("session.create", { sessionConfig: { sessionId: resumeId, … } })
  → server handleSessionCreate   (session-handlers.ts:326+)
        sessionId = sessionConfig.sessionId  (the requested id)
        ctx.sessionHost.startSession({ config: { …, sessionId } })
  → LocalRuntimeHost.startSession (local-runtime-host.ts:689-703)   ← THE DECISIVE BRANCH
```

```ts
// sdk/packages/core/src/runtime/host/local-runtime-host.ts:692-703
// Starting a session that is mid-run must not replace it: the replaced
// run keeps going unreachable (no abort, no queue) and its transcript
// writes resolve to the replacement's stale snapshot. Reattach instead.
const live = this.sessions.get(sessionId);
if (live && !live.agent.canStartRun()) {
    if (input.prompt?.trim()) {
        throw new Error(
            `Session ${sessionId} already has a run in progress; queue the prompt instead.`,
        );

### 3.3 What C1 could NOT observe, and why

`session_id`, `client_id`, build fingerprint and discovery record are **NOT** observable LIVE for a
**running** session in this ACT, because no Hub was started (C0/C1 scope) and the VS Code side has no
Hub at all. They are therefore recorded above as **STRUCTURAL** (production source), **not** promoted
to LIVE. The single missing observation to promote them is named in §6.

**Both clients reach the same daemon** iff they resolve the same `CLINE_HUB_DISCOVERY_PATH` record AND
the record's `buildId` equals their own `resolveHubBuildId()`. Both conditions are controllable by env
(`CLINE_HUB_DISCOVERY_PATH`, `CLINE_HUB_BUILD_ID`) — see §5.

| `~/.vscodium-clinemm/cline-data/db/sessions.db` (+`-wal`, `-shm`) | 2.4 MB, **WAL active at 03:26** | the **local** `SqliteSessionStore` is the live session store |
| `~/.vscodium-clinemm/cline-data/logs/` | only `hooks.jsonl` | **zero** occurrences of `Using hub runtime host` / `Falling back to local runtime host` / `discovered local hub runtime host` ⇒ the `auto`/`hub` branches were never entered |
| `globalState.json → clineVersion` | `4.1.16-5a1c485cb` | matches the installed VSIX ⇒ the traces belong to the installed build |

A Hub-backed VS Code would have produced a `locks/hub/owners/*.json` discovery record and a
`Using hub runtime host` log line. Neither exists. **The traces are negative evidence that is
consistent, reproducible and directly observable.**

---

## 4. Supported / NOT-supported test path (clear statement)

| Path | Supported by the current production implementation? | Evidence |
|---|---|---|
| **VS Code (installed) ↔ CLI, same session** | **NOT SUPPORTED** | VS Code pins `backendMode:"local"` (source + live bundle bytes + live FS traces). VS Code has no Hub daemon to attach to. Different build fingerprint. |
| **VS Code (installed) ↔ VS Code (installed)** | **NOT SUPPORTED** for cross-process attach | Both are local in-process runtimes with independent local session stores; no shared daemon exists to broker attachment. |
| **CLI ↔ CLI, same isolated Hub, same build fingerprint** | **SUPPORTED (STRUCTURALLY PROVEN)** | `cline --id <sid>` → `session.create` → server `LocalRuntimeHost.startSession` reattach branch (no second run). Read-only observation via `HubSessionClient.getSession` / `readMessages` / `streamEvents`. |
| **CLI ↔ CLI, `--data-dir` / sandbox mode** | **NOT SUPPORTED** (forces local) | `session-runtime.ts:168-169` forces `local` when `sandbox === true`; `run-zen.ts:35` refuses `--zen` with `--data-dir`. |
| **CLI ↔ CLI, different `CLINE_HUB_DISCOVERY_PATH`** | **NOT SUPPORTED** (intentionally isolated) | Different discovery record ⇒ different daemon instance. This is the isolation lever, used deliberately in the next gate. |

**⇒ The only supported cross-client live path in this build is CLI ↔ CLI on ONE isolated Hub.**

---

## 5. Recommended next executable gate (exact, isolated, safe)

**Gate name:** a successor ACT for CLI↔CLI cross-client attach, entering **C2** with
`VS_CODE_INTEROP_NOT_EXECUTED` retained.

### 5.1 Preconditions (all already proven satisfiable by C0)

1. Build the CLI from the **same worktree** (`/private/tmp/cline-int-worktree/apps/cli`) so the
   daemon and both clients share one `@cline/core` build.
2. Pin **one** build fingerprint for daemon + client A + client B:
   `CLINE_HUB_BUILD_ID=<pinned>` (otherwise the source build resolves to `source-0.2.0` while a bundled
   daemon resolves to its embedded id ⇒ `build_mismatch`).
3. Isolate the Hub identity — **not** `--data-dir`:
   `CLINE_HUB_DISCOVERY_PATH=<tmp>/hub-discovery.json` and `CLINE_DIR=<tmp>/cline-dir`.
   `CLINE_DIR` moves secrets/sessions/db; `CLINE_HUB_DISCOVERY_PATH` moves the daemon record.
   Keep `sandbox=false` (do **not** pass `--data-dir`).
4. Disposable fixture workspace; **explicit tool approvals only** — never `--yolo`, never `--zen`
   (and `--zen` would also force full tool auto-approval, which this ACT forbids).
5. Low-cost configured provider; the operator supplies the credential. **No credential is read, copied
   or committed by the agent.**

### 5.2 The recipe (shape, not executed here)

```bash
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
ROOT=/private/tmp/cline-int-worktree
ISO=$(mktemp -d /tmp/cline-xclient-XXXX)
export CLINE_DIR="$ISO/cline-dir"
export CLINE_HUB_DISCOVERY_PATH="$ISO/hub-discovery.json"
export CLINE_HUB_BUILD_ID="cline-xclient-01"

cd "$ROOT/apps/cli"

# A: start the isolated Hub (the ONLY Hub this ACT may ever start) and record its identity
bun src/index.ts hub ensure --json          # → {url, authToken, cwd, platform, arch}
bun src/index.ts hub status                  # → {running, url, pid, startedAt, cliVersion, coreVersion}

# A: start exactly ONE bounded run in the disposable fixture, with explicit approvals
bun src/index.ts -c "$ISO/fixture" "<bounded task>" --auto-approve false

# B: attach to A's session WITHOUT a prompt (the proven reattach path)
bun src/index.ts --id "$SESSION_ID" -c "$ISO/fixture"


### 5.3 Why this gate is safe

* The isolated Hub lives under `mktemp -d` with its own `CLINE_DIR` ⇒ the user's `~/.cline`
  credentials, sessions and Hub are untouched.
* The live VSCodium keeps running on its own `CLINE_DIR=~/.vscodium-clinemm/cline-data` and its own
  local runtime ⇒ it cannot be addressed by, and cannot address, the isolated Hub.
* `~/.cline/data/locks/hub/owners/` is empty ⇒ there is **no** personal Hub to collide with, so
  `HALT_UNSAFE_HUB_TARGET` does not apply.

    }
    return await this.liveSessionStartResult(live);   // ← REATTACH: returns the LIVE session
}
```

**This is the production no-duplicate-run guarantee, and it is enforced by the Hub server itself**, not
by a client convention:

* B sends **no prompt** ⇒ B takes the **reattach** branch ⇒ B receives the *same* `sessionId`, the
  *same* manifest, and **no new run is created**.
* If B had supplied a prompt, the server would have **rejected** it with
  `Session <id> already has a run in progress; queue the prompt instead.` — a second run is
  structurally impossible on this path.

**The upstream CLI 3.0.74 "attach to an already-running task in another Cline app without creating a
second run" claim IS substantiated for this fork's production code** — on the CLI↔CLI Hub path.
(The separate `session.attach` / `session.detach` command pair exists in the Hub transport,
`hub-server-transport.ts:955` and `session-handlers.ts:945-980`, but in this fork it is invoked by the
**desktop-app example** only — `apps/examples/desktop-app/sidecar/chat-session.ts:1160` — **not** by the
CLI and **not** by VS Code. It is therefore **not** the path the CLI uses; the reattach branch above
is.)

---

## 6. The single missing observation (for `CAPTURE_INSUFFICIENT` avoidance)

**Missing observation:** *the actual `session_id`, `client_id`, `hubId`, `buildId` and
`session.attached`/`run.*` event window observed LIVE from two distinct CLI processes against ONE
isolated Hub, together with proof that B's join created no second run.*

Everything else needed for C2 is already established:
* the attach path exists and is reattach-not-recreate (STRUCTURAL, §3.2);
* the read-only observation APIs exist (STRUCTURAL, §3.1);
* the isolation levers are proven to work (LIVE, `00-identity-and-isolation.md` §5);
* the identity fields are enumerable (STRUCTURAL, §2.2).

---

## 7. C4-style gate accounting (requested vs. observed) — C0/C1 only

| Gate | Minimum requirement | Requested | Observed | Label |
|---|---|---|---|---|
| Source/build identity | Exact actual source, installed bundle, CLI and daemon compatibility recorded | yes | ENTRY_HEAD `06076666e`; live VSIX `4.1.16-5a1c485cb-06076666e` sha256 `f552118e…`; CLI `3.0.74` from the same tree; build-fingerprint mismatch **identified** | **LIVE** |
| Isolation | No shared live Hub, PolyC task, production workspace, protected stash or credential modification | yes | No personal hub running; isolated discovery path yields `running:false`; `main`/`origin/main`/2 stashes/5 worktrees/`bun.lock` unchanged; no credential read | **LIVE** |
| A/B concurrent attach | Two distinct clients; one canonical session AND one real active execution | yes | **NOT REACHED** — VS Code cannot be A (local-only) | **`VS_CODE_INTEROP_NOT_EXECUTED`** |
| No duplicate run | No extra runtime start or second tool execution caused by B joining | yes | Server-side reattach branch proven in production source | **STRUCTURAL** |
| Event stream | Same observed causal identity, ordered delivery/replay; count missing fields honestly | yes | **NOT EXECUTED** (no Hub was started) | **NOT_EXECUTED** |
| Disconnect/reconnect | Runtime survives B exit; B reattaches with consistent state | yes | **NOT EXECUTED** | **NOT_EXECUTED** |
| Feedback/approval | One effect, if scenario triggers, with real attribution | yes | **NOT EXECUTED** | **NOT_EXECUTED** |
| Cancellation | One abort result, if safely executed; otherwise explicit pending gate | yes | **NOT EXECUTED** — C3 requires a C2 pass first | **NOT_EXECUTED** |
| Completion authority | Runtime state/event evidence distinct from user-visible message | yes | **NOT EXECUTED** | **NOT_EXECUTED** |

---

## 8. Labels used in this file

| Statement | Label |
|---|---|
| VS Code runtime is local-only (source + installed bundle bytes + live FS/log traces) | **LIVE** + **REAL_PRODUCTION_SEAM** |
| VS Code ↔ CLI cross-client attach | **`VS_CODE_INTEROP_NOT_EXECUTED`** (i.e. NOT_EXECUTED) |
| CLI `--id` reattach semantics, no-second-run guarantee | **STRUCTURAL** |
| Read-only observation API surface | **STRUCTURAL** |
| CLI↔CLI live overlap on an isolated Hub | **NOT_EXECUTED** |
| Personal-hub absence + isolated discovery path clean | **LIVE** |

No label was promoted into another. No live result was inferred from a diagram, an API's existence or
a completion card.

# B: read-only observation (starts nothing):
#    HubSessionClient.getSession / readMessages / streamEvents
```

**Hard rules for that gate:** `hub stop` / `hub drain` / `hub upgrade` are **forbidden**; the isolated
Hub is left running only until the gate ends and is then stopped by the operator; the personal
`~/.cline` Hub and the live VSCodium are never addressed; `authToken` is recorded as **presence
only**; no transcript body is committed — only event names, ids, counts and orderings.

