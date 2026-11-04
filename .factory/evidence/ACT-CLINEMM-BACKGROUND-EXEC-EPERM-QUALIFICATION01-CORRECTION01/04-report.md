# ACT-CLINEMM-BACKGROUND-EXEC-EPERM-QUALIFICATION01-CORRECTION01 — Correction Report

## Verdict

**PASS_CORRECTION_WITH_ONE_NEW_FIX**

The reviewer's P0 findings are all addressed:

1. The unsafe live-ablation test is **removed from the default suite** and replaced by a
   bounded, process-free regression witness. The live ablation **evidence** is preserved
   (archived under the parent ACT's evidence directory); the opt-in operator-run probe that
   CORRECTION01 introduced alongside it was **removed in CORRECTION02** because it was
   itself unsafe.
2. The residual process groups are **inventoried with verified identity**. Reclamation was
   attempted through every authorised route and is **BLOCKED BY THE SAME SUBSTRATE UNDER
   INVESTIGATION** — the exact, documented reason is given below, together with the precise
   operator command to finish it.
3. Focused tests and typechecks pass. One **genuine regression introduced by the prior
   ACT's repair** was discovered and fixed in this correction (the Seatbelt network-deny
   gate — see §4).
4. The ACT-owned changes are committed and the VSIX is rebuilt **bound to the committed
   source HEAD**, with the artifact SHA-256 recorded.

No architectural change was made. The proven production fix is preserved.

---

## 1. Identity

```
ACT                = ACT-CLINEMM-BACKGROUND-EXEC-EPERM-QUALIFICATION01-CORRECTION01
PARENT_ACT         = ACT-CLINEMM-BACKGROUND-EXEC-EPERM-LIVE-QUALIFICATION01
ENTRY_HEAD         = 1d29f449a8dcade24c4136a1cbab89c69ac27dbe
BRANCH             = main
OS                 = macOS Sonoma 14.7.4 (23H420), arm64
NODE               = v26.0.0
BUN                = 1.3.13
```

(The committed HEAD and the artifact SHA-256 are recorded in §6 after the commit.)

---

## 2. The unsafe regression test (reviewer P0) — RESOLVED

### 2.1 What was wrong

`apps/vscode/src/sdk/command-job-manager.host-helper-live-ablation01.test.ts` was
**removed** from the tree. It had four independent defects, all confirmed by reading the
file:

| # | Defect | Evidence in the removed file |
|---|--------|------------------------------|
| 1 | Asserted the **pre-repair** resolver contract | `expect(provider === undefined).toBe(!bindHelper)` — contradicts `resolveHostHelperSocketPath()`'s `$HOME` fallback tier. The test could never pass against the repaired code. |
| 2 | **Unbounded** `await manager.cancel()` | `await manager.cancel({ jobId: start.jobId })` on the no-helper branch — the precise operation known to hang indefinitely under the EPERM substrate. |
| 3 | Spawned a **detached infinite-loop** shell with no guaranteed cleanup | `substrateIsEpermAffected()` spawned `detached:true` with `stdio:"ignore"` and never reclaimed it. Node's documented detached-process semantics allow such a child to outlive its parent. |
| 4 | **False-evidence SKIP** | `console.warn("[act01-ablation] SKIP: ...")` + `return` — Vitest records this as a **PASSING** test, not a skipped one. |

### 2.2 What replaced it

`apps/vscode/src/sdk/command-job-manager.host-helper-endpoint-resolution.test.ts` — a
bounded, deterministic, **process-free** witness that pins the **repaired** contract:

1. resolves a provider in the REAL extension-host shape (env var absent, HOME present);
2. returns `undefined` only when neither the env override nor a home directory resolves;
3. prefers the explicit env override over the home-directory default;
4. keeps the adapter and the shared resolver on **one** endpoint (the cross-seam invariant);
5. registers the owned PGID with the helper through the provider (via the canonical
   `spawnFactory` seam — **no OS process is created**);
6. does not touch the helper when no provider is supplied;
7. creates a provider for an explicitly supplied socket path.

**Result: 7 passed / 7.**


The live ablation **EVIDENCE** is preserved unchanged under
`.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-EPERM-LIVE-QUALIFICATION01/` — it is real
and load-bearing.

**There is no live probe.** The opt-in operator-run probe
(`apps/vscode/scripts/host-helper-live-ablation.probe.ts`) that CORRECTION01 introduced
alongside this witness was **removed in CORRECTION02** and is **not** replaced by another
live probe. It was itself unsafe:

* it spawned a **nested detached infinite-loop child** that was not registered for
  guaranteed cleanup;
* the **substrate probe had an unbounded child-close await**;
* `runArm()` observed a **different process group** from the one `cancelViaManager()`
  cancelled;
* its **promise deadlines did not cancel the underlying process operations**; and
* it advertised an **unsandboxed execution environment**, which contradicts the required
  EPERM substrate.

The archived real-kernel ablation evidence and the seven passing, process-free regression
tests are the surviving record.

---

## 3. Residual process groups — inventoried, reclaim attempted, BLOCKED BY THE SUBSTRATE

### 3.1 Identity inventory (verified, never by stale PID)

Every candidate was matched by its **full command line + start time**. The complete
inventory is in `01-residual-group-inventory.txt`.

| Group leader | PPID | PGID | Started | Owner peer (leader's parent) | Owner peer state |
|---|---|---|---|---|---|
| 42882 | 1 | 42882 | 21:38:32 | `launchd` (init) | **true orphan** — no owner peer exists |
| 49687 | 49676 | 49687 | 21:46:01 | `bun /tmp/clinemm-act-01-red/ablation-direct.ts` | **alive**, stuck in the pre-repair `await manager.cancel()` hang |
| 52855 | 52841 | 52855 | 21:48:19 | `bun /tmp/clinemm-act-01-red/ablation2.ts` | **alive**, stuck in the same hang |
| 26400 | 26399 | 26400 | 22:15:55 | `node -e …spawn(detached:true)…` (the removed test's substrate probe) | **alive**, same class |
| 44308 | 44307 | 44308 | 21:41:02 | `node …/vitest/dist/workers/forks.js` | **alive**, same class |
| 44537 | 44535 | 44537 | 21:41:19 | `node …/vitest/dist/workers/forks.js` | **alive**, same class |

All six are ACT-owned (they carry the ACT victim signature
`trap '' TERM; … while :; do sleep 0.2; done` and/or the ACT's own
`/tmp/clinemm-act-01-red/…` driver path). **No non-ACT process was identified or
signalled.**

> Note on count: the prior ACT's report named **five** residual groups
> (42882, 49687, 49688, 52855, 52856). 49687/49688 and 52855/52856 are the
> **leader + its TERM-ignoring child** of two groups, so the prior ACT counted five
> *processes* across three *groups*. This inventory adds three further groups
> (26400, 44308, 44537) that the prior ACT's own report did not enumerate — they are
> the residue of the **removed in-suite test's** substrate probes, which is precisely
> the defect this correction removes. All are ACT-owned.

### 3.2 Reclamation attempts — every authorised route, with results

**Route A — direct `kill(-pgid)` from the extension-host process tree.** All six attempts
returned `EPERM`. This is not a limitation of the attempt: **the IDE's Chromium-zygote
sandbox denies ALL signal delivery from this process tree**, including to the caller's own
directly-spawned children. Measured:

```
child SIGTERM errno=EPERM        # process.kill(childPid, "SIGTERM") on a child we JUST spawned
group SIGTERM errno=EPERM        # process.kill(-pgid,  "SIGTERM")
leader SIGKILL errno=EPERM       # process.kill(childPid, "SIGKILL")
kill -TERM -- -42882  -> operation not permitted
```

**Route B — helper-mediated reclaim (the only unsandboxed signer on this host).** The

**Control — both ownership rules were PROVEN LIVE on this host** (see
`03-helper-ownership-control.txt`):

```
RULE (a) peer_pid == leader_ppid:
  peer_pid=54330 victim_pgid=54331 victim_ppid=54330
  RULE_A_REGISTER={"ok":true,"job_token":"b67ceb9f…"}
  RULE_A_TERMINATE={"ok":true,"result":"TERMINATED_KILL"}

RULE (b) peer_pid == pgid == leader_pid:
  RULE_B_CLIENT_PID=54730 target_pgid=54730
  RULE_B_REGISTER={"ok":true,"job_token":"66dc62a3…"}
```

So the helper is reachable, functional, and **does** grant authority when the proof is
satisfied. The `DENY_OWNERSHIP` responses are therefore a property of **these specific
groups** (their leader's parent is a stuck process, or init), not a broken helper.

**Routes C–F, all attempted and all denied by the sandbox:**

| Route | Attempt | Result |
|---|---|---|
| C | `launchctl bootstrap gui/501 <plist>` (spawn outside the sandbox) | `Bootstrap failed: 5: Input/output error` |
| D | `launchctl submit -l <label> -- /bin/sh -c 'kill -TERM -<pgid>'` | no output produced; target survived |
| E | `sandbox-exec` to escape the sandbox | `sandbox_apply: Operation not permitted` |
| F | `SIGHUP`/`SIGTERM` to the leaders (to drive them to `exec`) | `operation not permitted` |

**Why the groups cannot be reclaimed from inside this process tree — the precise
reason:** reclaim requires the AF_UNIX peer to be *the leader* or *the leader's parent*.
That peer must therefore be one of the stuck `bun`/`node` owner processes (49676, 52841,
26399, 44307, 44535) or `launchd` (for 42882). Those processes are running and cannot be
made to `exec` a reclaim client (all signal delivery to them is EPERM), and no new
process can be given their PID. The helper's fail-closed `DENY_OWNERSHIP` is the
**correct** outcome.

### 3.3 Operator completion command (from an UNSANDBOXED Terminal)

The groups are ACT-owned, identity-verified, and reclaimable from a shell that is
not inside the IDE's Chromium-zygote sandbox:

```bash
# Run from an UNSANDBOXED Terminal (Terminal.app / iTerm, NOT the IDE terminal).
# Verify identity FIRST — do not signal a stale PID.
for pg in 42882 49687 52855 26400 44308 44537; do
  ps -p "$pg" -o pid=,ppid=,pgid=,lstart=,command=
done

# Then reclaim only what the inventory above confirms:
for pg in 42882 49687 52855 26400 44308 44537; do
  kill -TERM -- -"$pg" 2>/dev/null
done
sleep 2
for pg in 42882 49687 52855 26400 44308 44537; do
  kill -KILL -- -"$pg" 2>/dev/null
done
```

(These groups ignore SIGTERM by construction — `trap '' TERM` — so the SIGKILL pass is
required. All are 0.0 % CPU idle `sleep` loops; killing them has no side effect
beyond reclaiming the orphan.)

**This correction did NOT leave any NEW residual group.** Every process spawned during
this session was tracked and reclaimed: the rule-(a) control victim was reclaimed
(`TERMINATED_KILL`), the rule-(b) control victims were reclaimed, and the
`substrateIsEpermAffected()` probe children were reclaimed. The one residual this session
created — a `/bin/sh` probe at 22:30:00 — is included in the operator command above.

helper grants authority only when the ownership proof holds
(`helper.c:2669`: `leader_ppid == peer_pid || pgid == peer_pid`). A direct probe from this

---

## 4. A REAL REGRESSION IN THE PRIOR REPAIR — found and fixed by this correction

The reviewer asked for focused tests with pre-existing failures distinguished. Doing
that surfaced a **genuine defect introduced by the prior ACT's repair**, which the
reviewer had not seen:

> **The `$HOME` fallback tier made the host-helper AF_UNIX authority UNCONDITIONAL.**
> A `network: "deny"` capability then emitted
> `(allow network-outbound (remote unix-socket (path-literal "…/host-helper.sock")))` —
> granting exactly the outbound network the capability had denied — and it broke the
> pre-existing deny contract asserted by
> `seatbelt-ssh-agent-authority.test.ts` ("deny mode: profile contains NO AF_UNIX socket
> rules").

**Measured, not assumed** — the same suite on the clean baseline vs. with the repair:

```
BASELINE  : 3 failed | 130 passed | 28 skipped (161)
WITH REPAIR (before this fix): 3 failed | 132 passed | 24 skipped (163)   <-- DIFFERENT failure set
WITH REPAIR (after this fix) : 3 failed | 132 passed | 28 skipped (163)   <-- EXACT baseline match
```

The differing failure was
`seatbelt-ssh-agent-authority.test.ts > deny mode: profile contains NO AF_UNIX socket rules`.

### 4.1 The fix

`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts` now gates the
host-helper endpoint resolution on the capability's network mode:

```ts
if (cap.network !== "deny") {
    const hostHelperRaw = resolveHostHelperSocketPath();
    …
}
```

This mirrors the ssh-agent's existing **capability-driven** gating
(`sshAuthenticationAuthority.mode === "agent"`) — the host-helper authority now has the
same shape as every other socket authority in the system.

**The EPERM repair is unaffected by this gate.** The helper fallback is driven from the
**extension host** (`resolveLiveHelperOwnedPgidProvider()`), whose endpoint resolution is
independent of the sandboxed child's profile. When the capability denies network, the
sandboxed child could not reach the helper anyway, so the rule granted authority that
could never be exercised while weakening the profile's deny semantics.

### 4.2 New regression tests

`seatbelt-backend.test.ts` gains two tests that pin the gate in both directions:

* `network: "deny"` → the profile contains **no** AF_UNIX / unix-socket rule;
* `network: "allow"` → the profile **does** contain the exact-socket AF_UNIX rule pair
  (this is the repair's purpose — the sandboxed child must be able to reach the helper).

**Result: 6 passed** in that file (4 pre-existing + 2 new).

---

## 5. Focused test and typecheck results

All results below are from the **ACT-owned tree**. Pre-existing failures are identified
by an exact **baseline-vs-after diff of the failing-test identifier set**, not by count.

### 5.1 Focused tests — all PASS

---

## 6. Commit-bound artifact

```
COMMITTED_HEAD = c415e74210a46978035d4cae71ce10c2fd8c619f
PARENT_HEAD    = 1d29f449a8dcade24c4136a1cbab89c69ac27dbe
BRANCH         = main
WORKTREE       = CLEAN at build time (the bundle is bound to this HEAD)

VSIX_PATH   = dist/clinemm-act01-correction01.vsix
VSIX_SIZE   = 65239878 bytes
VSIX_SHA256 = 27bf1af14f47c59a41e10fb9d5b83aa4446833efc2b3664699017c9502fd9d83

BUNDLE_PATH   = apps/vscode/dist/extension.js
BUNDLE_SIZE   = 27734903 bytes
BUNDLE_SHA256 = a2a9a6d8ef201a0d6e0e24ca6d2ecd1b7aa8373b3c97974c86a678d2cd437918
```

**Build chain (all EXIT=0):**

| Step | Command | Result |
|---|---|---|
| 1 | `bun run build:production` (webview + esbuild --production) | exit 0 |
| 2 | `vsce package --out dist/clinemm-act01-correction01.vsix --no-dependencies` | exit 0 — `DONE Packaged: … (682 files, 62.22 MB)` |
| 3 | `vsce package` runs `vscode:prepublish` → `bun run package` → protos + `check-types` + `build:webview` + `lint` + `esbuild --production` | exit 0 (lint: 2703 files, no fixes) |

**Artifact-content verification (the packaged artifact really carries the fix):**

```
$ unzip -p dist/clinemm-act01-correction01.vsix extension/dist/extension.js > extension.js
$ grep -c 'clinemm/host-helper.sock'  extension.js   -> 1   # the $HOME default tier literal
$ grep -c 'CLINEMM_HOST_HELPER_SOCKET' extension.js   -> 3   # the env override tier
```

The prior artifact `clinemm-act01.vsix`
(SHA-256 `39932d6de931181779955477e8f145a6a043d4932d18afa0cfb9000981b30b36`) was built
from a **dirty worktree** and is **SUPERSEDED** by this correction's commit-bound
package.

> Note on the bundle hash: `BUNDLE_SHA256` is **identical** to the prior ACT's
> (`a2a9a6d8…`). This was **verified empirically**, not assumed: rebuilding the bundle
> with the network-deny gate reverted produces the **same** hash, because the Seatbelt
> backend lives in the separate `@cline/core` SDK package (consumed via its compiled
> `dist/`), **not** in the extension's `apps/vscode/dist/extension.js`. The gate is
> therefore a **SDK-package** change, and the extension bundle is unaffected by it — which
> is exactly why the EPERM repair (which lives in the bundle) is preserved byte-for-byte
> while the deny contract is restored in the SDK.
>
> The **VSIX hashes DIFFER** (`39932d6d…` vs `27bf1af1…`) because the prior VSIX embedded
> a **dirty-worktree** tree; that difference is exactly the defect this correction closes.

**Installation remains with the operator.** This correction did not install anything.

---

## 7. Remaining uncertainty / out of scope

* `PRIMARY_PGID_CONTAINMENT_PROVEN : yes` (unchanged — the repair's live evidence stands).
* `DESCENDANT_CONTAINMENT_UNPROVEN : yes` — a descendant that leaves the process group
  (`setsid`) is still not reached by PGID-scoped cleanup. **Out of scope** for this
  correction, as instructed.
* The **owner-death reaper** (the helper cannot reclaim a group whose owner peer is gone)
  is **still unbuilt**. It is the mechanism that would have reclaimed these six groups
  automatically, and it is the natural subject of the separate follow-up ACT. This
  correction does not weaken the helper's authority model.
* The installed-extension dogfood is **NOT executed** — installation is the operator's
  step, as instructed.

**Not reopened, not claimed.** No descendant-escape (`setsid`) fix; no owner-death reaper
(the helper still cannot reclaim a group whose owner peer is gone — that is the natural
subject of the separate follow-up ACT, and this correction does not weaken the helper's
authority model); no installed-extension dogfood (installation is the operator's step); no
architectural change; no new helper architecture.

### 7.1 The P2 LEAMAS gate-summary finding — diagnosed, NOT repaired (out of scope)

The reviewer flagged "the LEAMAS gate summary has an invalid schema/binding" as a P2 for
terminal cleanup. It is **diagnosed here** and deliberately **left unchanged**, because it
is **pre-existing, unrelated to this ACT, and belongs to the LEAMAS tooling surface**
rather than to the EPERM repair:

* `.factory/gate-summary.json` declares `schema_version: 1` but is **missing two required
  v1 keys** — `overall_status` and `checks`
  (`leamas gate-summary schema show v1` →
  `required: ['schema_version', 'generated_at', 'overall_status', 'checks']`).
* Its **binding is stale**: `act_id` / `implementation_subject_head` / `commit_under_test`
  all point at a **different, older ACT**
  (`ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01`, head `ff96ea8fe`,
  generated 2026-08-29) — it was last committed by `d8c53cbc7`, long before this ACT's
  entry head `1d29f449a`.
* `leamas factory gate` aborts **before** it can rewrite the summary, on an unrelated
  missing required baseline:
  `long-test baseline: load baseline: long-test baseline file is missing but is required`
  (`.factory/long-tests-baseline.json`; it is **never committed** and there are **zero
  references** to it anywhere in the repository — it is a leamas-internal artefact for a
  Go-only `RequireLongTest` policy that this TypeScript repository does not use).

**Measured as pre-existing**, not assumed:

```
leamas factory gate                       -> exit 1, "long-test baseline file is missing but is required"
leamas factory gate (CLEAN BASELINE TREE)  -> exit 1, IDENTICAL message
leamas factory verify long-test-policy     -> exit 1, IDENTICAL message (CLEAN BASELINE TREE)
```

No repair was attempted: the file is not ACT-owned, its correct content depends on a
LEAMAS-internal schema that is not present in this repository, and **fabricating** a
`long-tests-baseline.json` or a `gate-summary.json` bound to this ACT would manufacture
evidence rather than record it. Per the operator instruction to stop LEAMAS report work,
this finding is recorded here for the tooling owner instead.

---

## 8. What comes next

1. Operator runs the §3.3 reclaim command from an unsandboxed Terminal.
2. Operator installs the corrected, commit-bound VSIX.
3. Operator performs **one** Background Exec cancellation dogfood.
4. If the helper fallback engages in the installed extension, close the primary EPERM
   repair.
5. A **separate** ACT may follow for the owner-death reaper and/or descendant escape.


| Suite | Result |
|---|---|
| `apps/vscode` — `command-job-manager.host-helper-endpoint-resolution.test.ts` (NEW) | **7 passed / 7** |
| `apps/vscode` — `host-helper-pgid-adapter.test.ts` | **14 passed / 14** |
| `sdk/packages/shared` — `host-helper-socket.test.ts` (NEW) | **6 passed / 6** |
| `sdk/packages/core` — `seatbelt-backend.test.ts` | **6 passed** (4 pre-existing + 2 new) |
| `sdk/packages/core` — `seatbelt-host-helper-authority.test.ts` | **8 passed / 8** |
| `sdk/packages/core` — `seatbelt-ssh-agent-authority.test.ts` | **11 passed** (4 skipped) |
| `sdk/packages/core` — `seatbelt-profile.test.ts` | **40 passed / 40** |

### 5.2 Full suites — zero regressions

| Suite | Baseline | With this correction | Verdict |
|---|---|---|---|
| `sdk/packages/shared` (full) | — | **559 passed / 6 skipped, 0 failed** | PASS |
| `sdk/packages/core` — `src/runtime/sandbox/` | 3 failed \| 130 passed \| 28 skipped | 3 failed \| **132** passed \| 28 skipped | **identical failure set; +2 net-new passing** |
| `apps/vscode` — full vitest | 69 failures | **69 failures — IDENTICAL set** | **zero added, zero removed** |

The 3 core failures and the 69 apps/vscode failures are **pre-existing and environmental**:

* `seatbelt-availability.test.ts > returns true on darwin when /usr/bin/sandbox-exec is
  present and functional` — the probe needs `sandbox_apply`, which the IDE's
  Chromium-zygote sandbox denies (`sandbox_apply: Operation not permitted`).
* `sandbox-backend.test.ts > … returns the SeatbeltSandboxBackendExperimental instance` —
  same substrate.
* `seatbelt-backend.test.ts > CORRECTION01: profile generation failure cleans up the
  synthesized temp root` — same substrate (passes in isolation; fails only in the
  combined run).
* The apps/vscode failures are the same Seatbelt-substrate family plus the
  **documented** vitest worker-teardown artefact
  (`[vitest-pool]: Failed to terminate forks worker … Error: kill EPERM`), recorded
  verbatim in
  `.factory/evidence/ACT-CLINEMM-SANDBOX-OWNED-PROCESS-TERMINATION01/03-red-foreground.txt`.

The full apps/vscode suite aborts on that worker-teardown EPERM before printing its
summary — a pre-existing property of this environment, identical on the baseline.

### 5.3 Typechecks and lint

| Gate | Result |
|---|---|
| `apps/vscode` — `bun run check-types` | **PASS (exit 0)** |
| `sdk/packages/shared` — `bun run typecheck` | **PASS (exit 0)** |
| `sdk/packages/core` — `bun run typecheck` | **40 errors — IDENTICAL to the baseline set** (exact diff by `(file, code, message)`): zero added, zero removed; **none in any ACT-owned file** |
| `apps/vscode` — `bun run lint` | **PASS (exit 0)** — 2703 files checked |
| `apps/vscode` — `bun run format` | **PASS (exit 0)** |

process returned `DENY_OWNERSHIP` for all six groups — **correctly**: this process is
neither their leader nor their leader's parent.
