# 00 — Identity, preflight and evidence inventory

**ACT:** `ACT-CLINEMM-WORKING-AFTER-COMPLETION-DISCRIMINATOR01`
**Type:** Evidence acquisition and reproduction · **Production change budget:** ZERO
**Collected:** 2026-11-16 (session local), read-only against the live installation.

---

## C0.1 — Repository identity

| Field | Value |
|---|---|
| Repository | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` |
| `HEAD` | `b1ad2a0de0a45ef184d8e836cc6d17bb422cf92e` |
| Branch | `main` |
| Tracked worktree state | **CLEAN** (`git status --short` → empty) |
| Untracked files | none |
| Protected stashes | **1 preserved** — `stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration` |
| Worktrees | **5 preserved, untouched** (`/private/tmp/clinemm-prebase`, `/private/tmp/worktree-bun.7ddCHQ`, `/private/var/…/worktree`, `clinemm-m31-action-first`, `clinemm-m31-bounded`) |

**No `HALT_UNEXPECTED_TRACKED_DIRT`.** The tree was pristine before and after this ACT; every
command run was read-only against the live installation and read-only against the repository
except for writing this evidence directory.

### Relevant integration ancestry (repo HEAD `b1ad2a0de`)

```
b1ad2a0de  fix(roundc-harness): ACT-CLINEMM-ROUND-C-HARNESS-03
1d9a37bcd  fix(control-seam): ACT-CLINEMM-MCP-OWNER-EXCLUSIVITY-CORR02
ef1ef40ab  fix(diagnostics): ACT-CLINEMM-DIAGNOSTIC-EXPORT-PRIVACY01 CORRECTION02
0b7da0cee  ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY
5a1c485cb  ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01 P1 fix: OFF conservation guard
363bdf7db  fix(aice01): evidence-provenance correction
4fe85071c  feat(observability): add BCB causal flight recorder + completion incident bundle
```

---

## C0.2 — Installed extension identity

| Field | Value |
|---|---|
| Operator data root | `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/` |
| Extension dir | `~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-1d9a37bcd/` |
| `package.json` version | `4.1.16-5a1c485cb-1d9a37bcd` |
| Repo `package.json` version | `4.1.16-5a1c485cb` (`apps/vscode/package.json:5`) |
| Bundle | `dist/extension.js`, 27 473 060 bytes |
| **Bundle SHA-256** | `f55400792f6bd035db76d791676002c7a693fc11150b4f47cfd4bf40e212ee9c` |
| Installed at | 2026-11-16 17:36 (local) |
| Elm runtime assets | **present** — `runtime-assets/completion-authority.js` (107 835 B), plus `task-header-orchestration.js`, `deferred-completion-barrier.js`, `completion-continuation-control.js`, `background-notify-authority.js` |

### Can the installed bundle bytes be tied to a specific source HEAD? — **YES**

The version suffix is **not** a single SHA: `5a1c485cb` is the *stale* `package.json` version
string (`4.1.16-5a1c485cb`), while `-1d9a37bcd` is the **actual build SHA**.

Marker discrimination against the installed `dist/extension.js`:

| Source marker | `5a1c485cb` source | `1d9a37bcd` source | installed bundle |
|---|---|---|---|
| `captureAutomaticIncident` (AICE01) | **0** | 7 | **2** ✅ |
| `isElmAuthorityEnabled` | present | absent (renamed `isElmAuthorityAvailable`) | **0** ✅ |
| `session-event-bcb-hold-resumable` | — | present | 1 ✅ |
| `session-event-pending-prompt-submitted` | — | present | 1 ✅ |
| `unresolvedContainmentFailuresAtCommitBoundary` | — | present | 1 ✅ |
| `task_completion_committed` | — | present | 3 ✅ |
| `completion_committed` | — | present | 4 ✅ |
| `holdReasons` / `completionAuthorized` | — | present | 1 / 1 ✅ |

**⇒ Installed bundle was built from source `1d9a37bcd`, which is `HEAD~1` of the repository
(`b1ad2a0de`).** The repository HEAD is exactly **one commit ahead** of the installed build
(`b1ad2a0de` = "ROUND-C-HARNESS-03 — `run_commands` normalizer"), a commit that does **not**
touch the completion-authority / turn-phase seam.

**Consequence:** the installed build and the repository HEAD carry **byte-identical**
completion-authority, BCB, turn-phase, Elm-authority and TaskHeader-projection sources. The

### Extension-host identity

| Field | Value |
|---|---|
| Extension-host PID | **98318** |
| Control-seam owner `instanceId` | `98318-49800609bcd187dae92f554228d093ea` |
| Control-seam owner `startedAt` | `1794839977145` (2026-11-16T14:39:37.145Z = 17:39:37+03:00) |
| Control-seam `tokenFingerprint` | `0a2411d00bcd8250` (fingerprint only — no secret read) |
| Control-seam enabled | `{"enabled":true}` |
| Runtime-diag instance | `clinemm-v2-900dc427-mwjddpq6.jsonl` — suffix `mwjddpq6` matches the incident record's `extensionHostInstanceId: "extension-host-98318-mwjddpq6"` ✅ |

**The MCP bridge, the runtime-diag trace, and the incident store all resolve to the SAME
extension-host instance (PID 98318).** This forecloses class **E** (foreign-instance mismatch)
for the incident's own records. (The external Codex Desktop MCP client process is a *different*
process, but it is a **read-only proxy** over the control-seam socket — see §C2.1.)

### Extension-host environment (relevant subset)

```
CLINEMM_DIAG_ACTIVITY_STATE_V1=1      CLINEMM_PTAD=1
CLINEMM_DIAG_INPUT_SHAPE_V2=1        CLINEMM_RUNTIME_PROFILE=dogfood
CLINEMM_DIAG_TERMINATION_AUTHORITY=1  CLINE_DATA_DIR=.../.vscodium-clinemm/cline-data
CLINEMM_MYC_PRIME_DIAG=1
```

`CLINEMM_COMPLETION_AUTHORITY_ELM` is **absent** — but at the installed revision `1d9a37bcd` the
Elm completion authority is armed **unconditionally** by
`initializeElmAuthorityRuntime(elmAuthorityKernelPath)` (`apps/vscode/src/extension.ts:669`),
and the packaged kernel IS present, so **Elm authority was ENABLED** for the incident.
There is no env gate and no OFF mode at this revision: the production comment at
`sdk-session-event-coordinator.ts:3138–3144` states verbatim *"There is no OFF mode. The Elm
authority is the sole completion authority; the trigger always fires; the consult site
(`checkElmCompletionAuthority`) fail-closes on kernel miss / decode error."*
(See §C2.3.)

---

## C0.3 — Incident session artifacts (read-only)

| Artifact | Path | SHA-256 |
|---|---|---|
| Session metadata | `~/.vscodium-clinemm/cline-data/sessions/1794840293250_5ugld/1794840293250_5ugld.json` | `e1f157f6350a1e7bca630c481700609b127ec3bd5580b4daa4004ade85112363` |
| Session transcript (199 messages) | `…/1794840293250_5ugld.messages.json` | `0b9e7d7c638b4ea875cf9ea1baf76ee1dd81c6371c03367ac7be7ccd7b7e5e02` |
| Automatic incident (epoch 3) | `…/globalStorage/s1onique.clinemm/completion-incidents/incident-mwje4uxh-1-qgkl66/incident.json` | `4a87186f7353ebe8d67e189da0cd15745cba529de401e05e19d3148092d5b4c4` |
| Automatic incident (epoch 4) | `…/completion-incidents/incident-mwje9ozi-2-3xq4qi/incident.json` | `3c35f3e09fb5781668731626737db60963093c350b2eada7e1865f33bfbddcb6` |
| Incident store index | `…/completion-incidents/index.json` | — |
| Runtime-diag publication trace | `…/runtime-diag/clinemm-v2-900dc427-mwjddpq6.jsonl` | `7b67b4768237d68b30b8b5dee3b235c9f7fa79c7a7ab8155b934ca9cea17f165` |
| BCB flight-recorder checkpoint | `…/completion-incident-checkpoint.json` | — (savedAt `2026-11-16T12:37:50.009Z` — **pre-incident**) |

### Session metadata (authoritative, persisted)

```json
{
  "session_id": "1794840293250_5ugld", "source": "vscode", "pid": 98318,
  "started_at": "2026-11-16T14:44:53.726Z",
  "ended_at":   "2026-11-16T15:09:34.312Z",
  "exit_code": 0, "status": "completed",
  "provider": "minimax", "model": "MiniMax-M3"
}
```

**`status: "completed"` is persisted at 2026-11-16T15:09:34.312Z (18:09:34+03:00).**

### `run_rCw8nsup` — provenance

`run_rCw8nsup` appears in **exactly one** file on disk:
`~/.vscodium-clinemm/cline-data/sessions/1794842746174_ynfjm/1794842746174_ynfjm.messages.json`
— which is **this ACT's own session** (started 15:25:46Z), because the run id is quoted
verbatim in the ACT prompt text. It appears in **no** diagnostic artifact of the incident
session, and **nowhere** in `~/.vscodium-clinemm/cline-data/diagnostics/` or the incident store.

**⇒ `run_rCw8nsup` is an operator-reported identifier with NO on-disk provenance.**
Its absence from every host-side record means the incident's run identity cannot be
cross-checked against the transcript; the incident is instead identified by the
**session/task id `1794840293250_5ugld`** + the **extension-host instance `mwjddpq6`**, both of
which are corroborated across four independent artifacts.

### Existing relevant tests, traces and diagnostic facilities (inventory)

| Facility | Location | Status |
|---|---|---|
| Automatic incident store (AICE01) | `…/globalStorage/s1onique.clinemm/completion-incidents/` | **2 incident records for the incident session** (epoch 3, epoch 4) |
| BCB causal flight recorder | `…/completion-incident-checkpoint.json` | **pre-incident snapshot only** — incident capsule NOT captured |
| Runtime-diag publication trace | `…/runtime-diag/clinemm-v2-900dc427-mwjddpq6.jsonl` | **complete** — 1178 `activity.publication.v1` records, 540 for the incident task |
| CCARD (`task_completion_committed`) | `…/continuation-cardinality-authority.jsonl` | **stale** (Nov 3; sessions `1793665474622_blefp`, `1793667039534_l1917`) — **no incident-session records** |
| Elm authority counters | `…/completion-authority-elm-authority.counters.json` | **stale** (Nov 3) |
| Termination-authority capture | `…/diagnostics/termination-authority/capture-mwjddpqc-55527846f4168800/` | installed 14:39:37Z, `observedEventCount: 0` — **process-exit only, no phase data** |
| myc-evaluation | `…/diagnostics/myc-evaluation/1794840293250_5ugld/` | present; MCP/tool telemetry only, **no phase data** |
| Existing witnesses | `ptwcr01`, `ptwcr01c01`, `bcb01`, `bcb01-c{,2,3,4}`, `c9c10cdap01`, `c9c10scr01`, `c9c10scr01-cons`, `ccsa01`, `cpa01`, `ccard01`, `cfc10a01`, `cfc10ar01`, `ctca01`, `rearm01`, `ccsrl01`, `tpc01`, `taskHeaderTelemetryHelpers.test.ts`, `TaskHeaderTelemetry.test.tsx` | see §C6 |

---

## C0.4 — Repository-protection compliance

- ✅ No push, reset, rebase, checkout, reinstall, upgrade.
- ✅ No `git stash push` / `git stash pop` (the one protected stash is intact and untouched).
- ✅ No worktree removed or modified.
- ✅ The incident task and its history were **read only** — no write to
  `~/.vscodium-clinemm/cline-data/sessions/1794840293250_5ugld/`, no write to `db/sessions.db`.
- ✅ No live job cancelled or killed; no PID probed or signalled.
- ✅ The incident's original shell commands were **not** re-run.
- ✅ No credential read (only `tokenFingerprint` from `owner.json`; `secrets.json` untouched).
- ✅ No broad test sweep (see §C6 — 9 focused suites).
- ✅ No production change; no diagnostic probe was added.
