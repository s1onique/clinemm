# ACT-CLINEMM-UPSTREAM-LIVE-HUB-CROSSCLIENT-QUALIFICATION01 — C0: Identity and Protected-Environment Preflight

**ACT:** `ACT-CLINEMM-UPSTREAM-LIVE-HUB-CROSSCLIENT-QUALIFICATION01` (C0 only)
**Scope executed:** C0 (identity + isolation preflight) and C1 (production topology discriminator).
**C2 / C3 / C4 / C5:** NOT EXECUTED (see `01-topology-discriminator.md` for the reason C2 was not entered).
**Verdict of this file:** topology is **VS Code = LOCAL-ONLY**; therefore the ACT-mandated label
**`VS_CODE_INTEROP_NOT_EXECUTED`** applies and the ACT stops before C2.

---

## 1. Checkout identity (ACT brief anchor vs. actual)

| Item | Value |
|---|---|
| Worktree | `/private/tmp/cline-int-worktree` |
| Branch | `integration/upstream-20261102` |
| **ENTRY_HEAD (discovered, not pre-baked)** | `06076666e66ca5678e84be230d2310f60b819e3c` |
| Tree SHA | `7e0e9c29fecc85c8ba662a3e154b33398bd93c1e` |
| HEAD subject | `docs(factory): ACT-CLINEMM-UPSTREAM-VSCODE-PROVIDER-RECONCILE01 — post-merge VS Code/provider reconciliation; verdict PASS_NO_CHANGE_NEEDED` |
| HEAD commit date | 2026-11-03 02:25:37 +0300 |
| Brief's U03 anchor `06076666e` | **MATCH — exact.** HEAD had not moved; no substitution was needed. |

### 1.1 Working-tree cleanliness at entry

```
git status --porcelain=v1 --untracked-files=all   ->  EMPTY (clean tree)
```

### 1.2 Merge ancestry (upstream merge parents — unchanged)

```
git rev-list --parents -n 1 HEAD
  06076666e66ca5678e84be230d2310f60b819e3c eab87e94759deb483571904b7943e6ad53f9e42b

git log --merges --oneline -10
  167f5ca8d Merge upstream 'a6507a62' into integration/upstream-20261102
```

| Role | SHA |
|---|---|
| Merge commit (unchanged) | `167f5ca8d639cc83c21ddf8e0d96369cfc319d0a` |
| Merge parent 1 (fork) | `265044bf37429cb3c48918eb7473e46cc3933964` |
| Merge parent 2 (upstream) | `a6507a62a147db4a35e27f4294589742ccac5060` |
| Merge base | `48d63852745460ff0fa3dfcc0457bbe2493841de` |

The merge was **NOT** recreated, **NOT** reset, **NOT** rebased and **NOT** re-merged.

---

## 2. Protected-state comparison (before → after this ACT)

| Protected item | At entry | After C0/C1 | Verdict |
|---|---|---|---|
| `main` | `265044bf37429cb3c48918eb7473e46cc3933964` | `265044bf37429cb3c48918eb7473e46cc3933964` | **UNCHANGED** |
| `origin/main` | `265044bf37429cb3c48918eb7473e46cc3933964` | `265044bf37429cb3c48918eb7473e46cc3933964` | **UNCHANGED** |
| `stash@{0}` | `WIP on main: 026a64d1b PTLL01-CORR01: board — L1 causal proof corrected, VSIX built+installed, live blocked by environment` | identical, present | **INTACT** (never popped/applied/dropped) |
| `stash@{1}` | `WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration` | identical, present | **INTACT** (never popped/applied/dropped) |
| Worktree count | 5 | 5 | **UNCHANGED** (no worktree created/removed) |
| `bun.lock` sha256 | `e65df0c9c6e3a58ca5acd5e8414df969d19c35865f48245a4f24a9b13bb7bfb7` | unchanged | **UNCHANGED** (`bun install` NOT executed) |
| Branches created | — | none | **NONE** |

Worktree inventory at entry:

```
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm                  265044bf3 [main]
/private/tmp/cline-fork-baseline                                            265044bf3 (detached HEAD)
/private/tmp/cline-int-worktree                                             06076666e [integration/upstream-20261102]
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-action-first 38e726c45 [experiment/m31-action-first]
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-bounded      0366ea506 (detached HEAD)
```

**Actions NOT taken (per ACT non-negotiables):** no production file created/modified/deleted; no Hub started,
stopped, drained or upgraded; nothing installed; no provider invoked; no credential, token, signed URL or
private transcript read or committed; no protected stash touched; no push; no release; no new branch.

---

## 3. Installed extension identity and source ancestry

### 3.1 Two distinct ClineMM installs exist on this host — the LIVE one is not the one under `~/.vscode-oss`

A live VSCodium instance was found running with a **non-default** extensions directory:

```
/Applications/VSCodium.app/Contents/MacOS/VSCodium \
  --user-data-dir  /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data \
  --extensions-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions
```

| Install | Directory | Version | Bundle sha256 | Status |
|---|---|---|---|---|
| **LIVE (VSCodium, `--extensions-dir ~/.vscodium-clinemm/extensions`)** | `~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-06076666e` | `4.1.16-5a1c485cb-06076666e` | `f552118e272db6a9d5948ea17aff444a8c85cd768fd709975a67d518156e1047` | **THE LIVE ONE — bound to the merge head** |
| Stale (default `~/.vscode-oss`) | `~/.vscode-oss/extensions/s1onique.clinemm-4.1.10-26f1e7bb6` | `4.1.10-26f1e7bb6` | `697e5bdf8aad5c832b3a6a7f2560279907375f3cdf0cbf71819b0afc4f84a20a` | NOT the live host; **not** the subject |

Live-install attribution chain:

| Link | Value | Proof |
|---|---|---|
| Extension ID | `s1onique.clinemm` | `package.json` → `publisher=s1onique`, `name=clinemm`, `displayName=ClineMM` |
| Installed version string | `4.1.16-5a1c485cb-06076666e` | `package.json` → `version` |
| Encoded build SHA | `5a1c485cb` | `git cat-file -t 5a1c485cb` → `commit`; `5a1c485cb5fb26f8d0d7ce6e53e5813c190b6c54` = "ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01 P1 fix: OFF conservation guard" (2026-10-05) |
| Encoded HEAD SHA | `06076666e` | **exactly** `ENTRY_HEAD` of this ACT |
| `5a1c485cb` is an ancestor of `06076666e` | **YES** | `git merge-base --is-ancestor 5a1c485cb 06076666e` → 0 |
| Live runtime self-report | `clineVersion: "4.1.16-5a1c485cb"` | `~/.vscodium-clinemm/cline-data/globalState.json` |

**Attribution verdict: `LIVE` + `REAL_PRODUCTION_SEAM` for the LIVE install.** The installed bundle is
byte-bound to the merge head `06076666e` via the version string, and the runtime's own
`clineVersion` agrees. The stale `4.1.10-26f1e7bb6` install (1837 commits behind, and the one the
historical board entries at `.factory/epic-board.md:364` describe) is **not** the live host and is
explicitly excluded from this qualification.

### 3.2 Live VS Code data identity (redacted)

```
CLINE_DIR (live VSCodium)   = /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data
provider (act/plan)         = minimax / MiniMax-M3          [presence only; no credential read]

---

## 4. CLI build identity

| Item | Value |
|---|---|
| `type -a cline` | **not installed** (`cline not found`) |
| `type -a codium-clinemm` | **not found** in this shell's `PATH` |
| Source CLI in the subject worktree | `apps/cli` → package `@cline/cli` **3.0.74** |
| Run-from-source probe | `bun src/index.ts --version` → **`3.0.74`**, exit 0 |
| `@cline/core` | `0.2.0` |
| `@cline/shared` | `0.2.0` |
| `apps/vscode` (`clinemm`) | `4.1.16-5a1c485cb` |

**Fork-vs-upstream semantics were read from this checkout's actual source, not assumed from the upstream
3.0.74 release notes.** The upstream CLI 3.0.74 "attach to an already-running task in another Cline app"
claim is evaluated against the fork's production code in `01-topology-discriminator.md` §3.

### 4.1 A CLI built from the SAME source as the installed VSIX

The installed VSIX bundle and the CLI both link `@cline/core`. The Hub build-compatibility gate is
`resolveHubBuildId()` (`sdk/packages/core/src/hub/discovery/index.ts:122-132`), which reads
`CLINE_HUB_BUILD_ID` → `__CLINE_CORE_RUNTIME_BUILD_ID__` → `source-${corePackage.version}`. A CLI run
**from this worktree** therefore resolves to `source-0.2.0` unless `CLINE_HUB_BUILD_ID` is set
explicitly, while the installed VSIX resolves to its own embedded build id. **These are different
build ids** ⇒ the `build_mismatch` gate (`discovery/index.ts:180-182`) would refuse the pair.

**⇒ For a same-Hub CLI↔CLI experiment both clients must be built from ONE source tree.** The
recommended construction (used in the recommended next gate, §7) is: build the CLI from this same
worktree and pin **one** `CLINE_HUB_BUILD_ID` for **both** the hub daemon and both clients, so the
build-compatibility gate is satisfied by construction rather than by accident.


---

## 5. Isolated-Hub identity and proof that no personal/production Hub is addressed

### 5.1 Personal hub: NONE running

```
ls -la ~/.cline/data/locks/hub/owners/     ->  EMPTY (0 entries)
ls -la ~/.cline/data/locks/hub/             ->  only owners/ (no production.json)
```

### 5.2 Isolated discovery path probe (read-only; starts nothing)

```
CLINE_HUB_DISCOVERY_PATH=/tmp/cline-crossclient-probe-01/hub-discovery.json \
  bun src/index.ts hub status
{"running":false,"cliVersion":"3.0.74"}
```

`cline hub status` is read-only by construction (`apps/cli/src/commands/hub.ts:222-249`: it calls
`readHubDiscovery` + `probeHubServer` and never `ensureDetachedHubServer`). The probe confirms an
**empty, uncontested** isolated Hub namespace.

### 5.3 The isolation levers that actually work (verified in production source)

| Lever | Source | Effect |
|---|---|---|
| `CLINE_HUB_DISCOVERY_PATH` | `sdk/packages/core/src/hub/discovery/index.ts:17,330` | Replaces the hub **discovery record** ⇒ a different daemon instance. Honoured by the *runtime* path, not only by `cline hub`. |
| `cline hub --discovery-path <path>` | `apps/cli/src/commands/hub.ts:43,146` | Sets the same env var for the `hub` subcommand family (`ensure`/`status`/`stop`/`drain`/…). |
| `CLINE_DIR` / `CLINE_DATA_DIR` | `sdk/packages/shared/src/storage/paths.ts:158-192` | Moves the whole data dir (secrets, sessions, db). |
| `CLINE_HUB_BUILD_ID` | `sdk/packages/core/src/hub/discovery/index.ts:123-125` | Pins the Hub build fingerprint ⇒ controls the `build_mismatch` compatibility gate. |

**Isolation is therefore PROVEN and SAFE: an isolated Hub identity is reachable by
`CLINE_HUB_DISCOVERY_PATH` + `CLINE_DIR`, and no live personal/production Hub, no PolyC task and no
production workspace is addressable under that identity.** No `HALT_UNSAFE_HUB_TARGET` is raised.

**Caveat recorded honestly:** `CLINE_DATA_DIR`/`--data-dir` is the *wrong* lever for this experiment —
`--data-dir` sets `sandbox=true`, and the CLI then **forces a local backend**
(`apps/cli/src/runtime/interactive/session-runtime.ts:168-169`:
`forceLocalBackend: input.config.mode === "yolo" || input.config.sandbox === true`;
and `apps/cli/src/runtime/run-zen.ts:35` refuses `--zen` with `--data-dir`). Using `--data-dir`
would **isolate away from the Hub** and make a Hub experiment impossible. The correct isolation is
`CLINE_HUB_DISCOVERY_PATH` + `CLINE_DIR` (which keeps `sandbox=false`).

actModeReasoningEffort      = none
userContextCeiling          = 512000
vscodeTerminalExecutionMode = backgroundExec
```

No key, token, URL-with-credential or transcript body was read or copied into this evidence.

## 6. Runtime topology — the decisive C0/C1 fact

### 6.1 The VS Code host pins `backendMode: "local"` — at source AND in the installed bundle

Source at ENTRY_HEAD:

```
apps/vscode/src/sdk/vscode-session-host.ts:475
    const inner = await ClineCore.create({
        backendMode: "local",
```

Source at the stale install's build parent commit `26f1e7bb6`:

```
apps/vscode/src/sdk/vscode-session-host.ts:180
    const inner = await ClineCore.create({
        backendMode: "local",
```

**In the LIVE INSTALLED BUNDLE** (`~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-06076666e/dist/extension.js`,
sha256 `f552118e…e1047`), the same call site appears at byte offset **25477111**:

```
=== @ 25477111 ===
...return{...c,source:c.source??"vscode",localRuntime:{...c.localRuntime??{},hooks:h.hooks,
configExtensions:(c.localRuntime?.configExtensions??zEt).filter(m=>m!=="hooks")},config:h}},
o=await ier.create({backendMode:"local",capabilities:{requestToolApproval:e.requestToolApproval,
toolExecutors:Object.keys(n).length>0?n:void 0},toolPolic...
```

The `source:"vscode"` marker immediately preceding the `ClineCore.create` call proves this occurrence
**is** the VS Code host seam and not the CLI's.

The installed bundle also contains the *other* two `backendMode` literals — `backendMode:"auto"`
(offset 11925546, the `auto` fallback branch inside `createRuntimeHost`) and the
`resolveConfiguredBackendMode` resolver (offsets 10587248/10587269, which honours
`CLINE_SESSION_BACKEND_MODE`). **Neither can affect the VS Code host**, because
`resolveConfiguredBackendMode` returns `options.backendMode` **first**
(`sdk/packages/core/src/runtime/host/host.ts:20-21`) and the VS Code host passes an explicit
`"local"`. ⇒ **`CLINE_SESSION_BACKEND_MODE=hub` would NOT move the VS Code extension onto a Hub.**

### 6.2 Live-observed corroboration that VS Code never joined a Hub

| Observation | Result | Reading |
|---|---|---|
| `~/.vscodium-clinemm/cline-data/locks/hub/` | **does not exist** | VS Code never created/resolved a Hub discovery record |

---

## 7. Safe, isolated CLI ↔ CLI alternative (identified, NOT executed here)

Because VS Code is local-only, the ACT's fallback is a **two-real-CLI-clients-on-one-isolated-Hub**
experiment. The production seams that make it possible were all verified in source (details and the
exact command recipe in `01-topology-discriminator.md` §4 and §5):

1. **One isolated Hub identity** — `CLINE_HUB_DISCOVERY_PATH=<tmp>/hub-discovery.json` +
   `CLINE_DIR=<tmp>/cline-dir` for A, B and the daemon alike.
2. **One build fingerprint** — `CLINE_HUB_BUILD_ID=<pinned>` shared by the daemon and both clients so
   `isManagedHubReusable` / `build_mismatch` cannot split them.
3. **The genuine production attach path** — CLI B's `cline --id <session-id>` reaches
   `LocalRuntimeHost.startSession`'s **reattach branch** on the Hub server
   (`sdk/packages/core/src/runtime/host/local-runtime-host.ts:692-703`), which explicitly refuses to
   replace a mid-run session and returns the live one instead. **No second run is created.**
4. **Read-only observation APIs** for B — `HubSessionClient.getSession` / `readMessages` /
   `streamEvents` (`sdk/packages/core/src/hub/client/session-client.ts:455,469,639`).

**This alternative was NOT executed in C0/C1** (no Hub was started, per the ACT's C0/C1 read-only
scope). It is the recommended **next executable gate**, specified in
`01-topology-discriminator.md` §5.

---

## 8. Evidence labelling

| Claim | Label |
|---|---|
| ENTRY_HEAD = `06076666e`, clean tree, protected state unchanged | **LIVE** |
| Installed live VSIX is bound to the merge head (`4.1.16-5a1c485cb-06076666e`) | **LIVE** + **REAL_PRODUCTION_SEAM** |
| VS Code host pins `backendMode:"local"` (source + installed bundle byte offset) | **REAL_PRODUCTION_SEAM** |
| Live VS Code sessions are local (no hub lock dir; local sqlite/file store; no hub log lines) | **LIVE** |
| CLI↔CLI attach path semantics (reattach branch, no second run) | **STRUCTURAL** (production source) — **not yet LIVE** |
| VS Code ↔ CLI cross-client attach | **NOT_EXECUTED** — label **`VS_CODE_INTEROP_NOT_EXECUTED`** |
| Actual A/B live overlap on an isolated Hub | **NOT_EXECUTED** |

---

## 9. Commands executed (verbatim, read-only)

```bash
ROOT=/private/tmp/cline-int-worktree
cd "$ROOT"

git rev-parse HEAD HEAD^{tree}
git status --porcelain=v1 --untracked-files=all
git branch -vv --all
git log --oneline -25
git log --merges --oneline -10
git rev-list --parents -n 1 HEAD
git stash list
git worktree list
git merge-base --is-ancestor 5a1c485cb 06076666e ; echo $?
git merge-base --is-ancestor 26f1e7bb6 06076666e ; echo $?
git rev-list --count 26f1e7bb6..06076666e
git show 06076666e:apps/vscode/src/sdk/vscode-session-host.ts | grep -n backendMode
git show 26f1e7bb6:apps/vscode/src/sdk/vscode-session-host.ts | grep -n backendMode
git log --oneline 26f1e7bb6..06076666e -- apps/vscode/src/sdk/vscode-session-host.ts

EXT=~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-06076666e
python3 -c "import json;d=json.load(open('$EXT/package.json'));print(d.get('publisher'),d.get('name'),d.get('version'),d.get('main'))"
shasum -a 256 $EXT/dist/extension.js
# byte-offset scan for backendMode literals + session.* command strings in the installed bundle

ls -la ~/.vscodium-clinemm/cline-data/
find ~/.vscodium-clinemm/cline-data -maxdepth 4 -path '*hub*'
ls ~/.vscodium-clinemm/cline-data/sessions/ | wc -l
ls -la ~/.vscodium-clinemm/cline-data/db/
grep -rho -i 'Using hub runtime host|Falling back to local runtime host|discovered local hub' \
  ~/.vscodium-clinemm/cline-data/logs/ | sort | uniq -c

ls -la ~/.cline/data/locks/hub/owners/
type -a cline ; type -a codium-clinemm

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
cd apps/cli && bun src/index.ts --version
CLINE_HUB_DISCOVERY_PATH=/tmp/cline-crossclient-probe-01/hub-discovery.json \
  bun src/index.ts hub status
```

**Exit codes:** every command above exited 0 (the two `git merge-base --is-ancestor` probes printed
`0` = true). No command mutated repository, Hub, credential or workspace state.

| `~/.vscodium-clinemm/cline-data/sessions/` | **495** session dirs | sessions live in the **local** file store |
| `~/.vscodium-clinemm/cline-data/db/sessions.db` (+`-wal`, `-shm`) | present, 2.4 MB, WAL active at 03:26 | sessions live in the **local** SQLite store (`SqliteSessionStore`) |
| `~/.vscodium-clinemm/cline-data/logs/` | only `hooks.jsonl` | no `Using hub runtime host` / `Falling back to local runtime host` / `discovered local hub` line was ever logged |
| `grep -o 'backendMode:"local"'` in the live bundle | present at offset 25477111 | the pinned local mode |

⇒ **The installed ClineMM VS Code sessions are LOCAL (in-process `LocalRuntimeHost`), not Hub-backed.**

---
