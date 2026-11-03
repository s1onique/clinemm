# ACT-CLINEMM-UPSTREAM-LIVE-HUB-CROSSCLIENT-QUALIFICATION01

**Status:** C0 + C1 executed; **C2–C5 NOT EXECUTED**.
**Verdict:** `PASS_PARTIAL_LIVE_PENDING` — with the explicit ACT-mandated label
**`VS_CODE_INTEROP_NOT_EXECUTED`**.

**Epic:** `EPIC-CLINEMM-UPSTREAM-AND-AGENT-CONTROL-01`
**Workstream:** U04 (successor of U03 `ACT-CLINEMM-UPSTREAM-VSCODE-PROVIDER-RECONCILE01`, whose parent
qualification was `ACT-CLINEMM-UPSTREAM-EXACT-HEAD-QUALIFICATION01` / C4).

**Source anchor:** the accepted U03 head `06076666e66ca5678e84be230d2310f60b819e3c`, branch
`integration/upstream-20261102`, worktree `/private/tmp/cline-int-worktree`. The **actual `ENTRY_HEAD` was
discovered**, not pre-baked: it is exactly `06076666e66ca5678e84be230d2310f60b819e3c` (tree
`7e0e9c29fecc85c8ba662a3e154b33398bd93c1e`). HEAD had not moved.

---

## 1. Epistemic purpose (as briefed)

Obtain LIVE evidence that two real clients can observe/control one running ClineMM Hub session without
duplicating its agent execution, losing events, or misreporting completion — verifying the upstream CLI
3.0.74 "attach to an already-running task in another Cline app without creating a second run" claim
**against this merged fork build**, not merely the existence of APIs.

## 2. What this ACT actually established (C0 + C1)

**The installed ClineMM VS Code extension is LOCAL-ONLY.** It runs an in-process `LocalRuntimeHost` and
never touches the Hub. Consequently:

* **VS Code ↔ CLI cross-client attachment is NOT supported** by the current production implementation.
* **No attachment was attempted.** No architecture was altered to make the experiment pass.
* The ACT-mandated label **`VS_CODE_INTEROP_NOT_EXECUTED`** is recorded, and **C2 was not entered**.

**The CLI↔CLI path IS supported**, and its attach semantics were traced end to end in production source:
`cline --id <sid>` → `session.create` → the Hub server's `LocalRuntimeHost.startSession` **reattach
branch** (`sdk/packages/core/src/runtime/host/local-runtime-host.ts:692-703`), which refuses to replace a
mid-run session. **A second run is structurally impossible on that path** (a prompt-bearing start is
rejected with *"already has a run in progress; queue the prompt instead."*).

This is recorded as **STRUCTURAL** — proven in production source, **not yet LIVE**. No label was promoted.

## 3. Evidence

| File | Content |
|---|---|
| `.factory/evidence/ACT-CLINEMM-UPSTREAM-LIVE-HUB-CROSSCLIENT-QUALIFICATION01/00-identity-and-isolation.md` | C0 — identity, ancestry, installed-extension attribution, CLI build identity, isolation proof, protected-state comparison, verbatim commands |
| `.factory/evidence/ACT-CLINEMM-UPSTREAM-LIVE-HUB-CROSSCLIENT-QUALIFICATION01/01-topology-discriminator.md` | C1 — production topology discriminator, supported/not-supported path, recommended next gate, C4-style gate accounting |
| `.factory/evidence/ACT-CLINEMM-UPSTREAM-LIVE-HUB-CROSSCLIENT-QUALIFICATION01/SHA256SUMS.txt` | checksums of both evidence files |

## 4. Constraints honoured

* No production file was created, modified or deleted. **PRODUCTION_DELTA = ZERO.**
* No Hub was started, stopped, drained or upgraded. **HUB_STARTED = NO.**
* Nothing installed; no provider invoked; no credential, token, signed URL or private transcript read or
  committed (`authToken` is recorded as **presence only**).
* Both protected stashes intact; `main` and `origin/main` unchanged; 5 worktrees unchanged; `bun.lock`
  unmodified (`bun install` NOT executed); no branch, push or release; the upstream merge `167f5ca8d` was not
  recreated, reset, rebased or re-merged.
* The user's live VSCodium, its `CLINE_DIR=~/.vscodium-clinemm/cline-data`, its PolyC task(s) and the
  personal `~/.cline` Hub were never addressed.

## 5. Exact recommended next executable gate

A successor ACT for **CLI ↔ CLI cross-client attach on ONE isolated Hub**, entering C2 while retaining
`VS_CODE_INTEROP_NOT_EXECUTED`:

* `CLINE_DIR=$ISO/cline-dir`, `CLINE_HUB_DISCOVERY_PATH=$ISO/hub-discovery.json`, and a **single pinned**
  `CLINE_HUB_BUILD_ID` shared by the daemon and **both** clients (the source CLI resolves to `source-0.2.0`
  unless pinned, and a mismatch is rejected on `build_mismatch`).
* Both clients built from **this** worktree; **no** `--data-dir` (it forces a local backend and would
  isolate *away* from the Hub), **no** `--yolo`, **no** `--zen`; explicit tool approvals only.
* A starts exactly one bounded run in a disposable fixture; B attaches with `cline --id <session-id>`
  **and no prompt**; B observes read-only via `HubSessionClient.getSession` / `readMessages` /
  `streamEvents`.
* `hub stop` / `hub drain` / `hub upgrade` are forbidden; the personal `~/.cline` Hub and the live VSCodium
  are never addressed.

The **single missing observation** to promote the STRUCTURAL findings to LIVE is: *the actual `session_id`,
`client_id`, `hubId`, `buildId` and the `session.attached` / `run.*` event window observed from two distinct
CLI processes against one isolated Hub, with proof that B's join created no second run.*

Full recipe and safety argument: `01-topology-discriminator.md` §5.

## 6. Successor chain

This ACT resolves the U04 interop question as `VS_CODE_INTEROP_NOT_EXECUTED` and hands off to
`ACT-CLINEMM-UPSTREAM-LIVE-PROVIDER-WIRE-QUALIFICATION01` (installed-runtime provider/model, MiniMax M3.1
reasoning requested→wire, and a real tool/terminal lifecycle on the installed runtime), which — unlike
this ACT — requires the operator's provider credential. The external MCP adapter (A01/A02) remains gated
on runtime-authority qualification and was **not** started.
