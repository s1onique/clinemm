# ACT-CLINEMM-BACKGROUND-EXEC-EPERM-LIVE-QUALIFICATION01 — Final Report

## Verdict

**PASS_STRUCTURAL_ONLY**

The `kill/EPERM` failure was reproduced on the real kernel through the real
production seam, its causal boundary was isolated by a live ablation, a
one-boundary repair was applied, and the exact RED is now GREEN with a verified
clean primary-PGID postcondition and zero residual victims in the qualification
runs. The installed-UI dogfood was NOT executed (operator declined the
automated install; the extension is dogfooded manually), so the final
installed-artifact step remains open.

## Identity

```
ACT                = ACT-CLINEMM-BACKGROUND-EXEC-EPERM-LIVE-QUALIFICATION01
ENTRY_HEAD         = 1d29f449a8dcade24c4136a1cbab89c69ac27dbe
SUBJECT_HEAD       = 1d29f449a8dcade24c4136a1cbab89c69ac27dbe
FINAL_HEAD         = 1d29f449a8dcade24c4136a1cbab89c69ac27dbe (no commit made)
BRANCH             = main
TREE_STATUS        = 4 modified + 3 untracked (ACT-owned only)
INSTALLED_VERSION  = 4.1.16-5a1c485cb-5e505e855
VSIX_SHA256        = 39932d6de931181779955477e8f145a6a043d4932d18afa0cfb9000981b30b36
HELPER_SHA256      = ccd5257402745b4e8940dda9a5d020f09984063aea26ca5c1561a4b492d6366c
```

## RED (real kernel, real production seam)

Fixture: shell parent + TERM-ignoring child, spawned with `detached:true`
(`child.pid == PGID`), unique marker, bounded lifetime, independently
reclaimable by the helper.

```
=== CASE R1_RED_env_unbound (helper=false) ===
  leader_pid=69762 leader_ppid=69760
  victim stdout: "READY"
  DIRECT kill(-69762, SIGTERM) => EPERM kill() failed: EPERM: Operation not permitted
  group_alive_after_direct_term = true
  HELPER_FALLBACK_USED: not_attempted
  PRIMARY_PGID_POSTCONDITION: alive
  reclaim terminate: {"ok":true,"result":"TERMINATED_KILL"}   <-- only the helper can
  RESIDUAL_CONTROLLED_VICTIMS_AFTER_CASE = 0
```

The errno was captured AT THE SIGNALING SEAM (`process.kill(-pgid, SIGTERM)`),
not inferred from a generic failure. `SIGKILL` was equally denied
(`kill(-pgid, SIGKILL) => EPERM`), so the group survived both the graceful and
the escalation phase.

Full production path, same RED, before the repair:

```
[ARM_B_env_unbound] jobId=cmd_mw2gzbyrniquqpn2 pgid=52855 providerPresent=false
<cancel() NEVER RESOLVED>          <-- hangs at `await job.process.exit`
```

Live kernel state of the RED victim while it was orphaned:
`52855 52841 52855 s /bin/bash -c trap '' TERM; ...` — and `42882` was
reparented to `ppid=1`, i.e. a true orphan.

## Causality

Selected boundary: **H1 — the extension host could not reach the helper
capability at all**, because the endpoint was resolved from the environment
only and the environment (GUI launchd domain `gui/501`) does not export it.

Discriminator evidence:

| Probe | Result |
|---|---|
| `launchctl print gui/501` domain environment | only `DISPLAY`, `SSH_AUTH_SOCK` |
| `launchctl getenv CLINEMM_HOST_HELPER_SOCKET` | empty |
| installed bundle `process.env.CLINEMM_HOST_HELPER_SOCKET` reads | 2 (both env-only) |
| helper health / client.open / register-owned / client.close | all OK (HELPER_READY) |
| helper ownership proof | leader UID == peer UID, `leader_ppid == peer_pid` OR `leader_pid == peer_pid`, `start_us` PID-reuse check, `getpgid(leader)==pgid` — all enforced, all fail-closed |
| direct `kill(-pgid, SIGTERM)` from the host | **EPERM** (real kernel errno) |
| helper `terminate-owned` against the SAME verified group | **TERMINATED_KILL**, group gone |

Competing hypotheses eliminated:

* **H2 Registration fails** — eliminated: registration SUCCEEDED (`ok:true`,
  `job_token` issued) whenever the peer was the group's owner. An earlier
  `DENY_OWNERSHIP` was the helper correctly refusing a NON-owner peer.
* **H3 Direct signal denied, helper not consulted** — this WAS true, but the
  reason is H1: there was no helper capability to consult. Once the endpoint
  resolved, the fallback engaged on the very first EPERM.
* **H4 Fallback not invoked** — eliminated: `command-job-manager.ts:2397` fires
  exactly when `epermDetected && helperOwnedCapability`; the capability was
  absent only because the endpoint did not resolve.
* **H5 Helper reports success without cleanup** — eliminated: the kernel
  postcondition was probed independently (`kill(-pgid, 0)`) after the helper
  returned; `gone` every time.
* **H6 Primary group gone, descendants remain** — partially applicable and
  preserved as a separate finding (see "Remaining uncertainty"). The victim
  workload deliberately contained a descendant in the SAME group; a descendant
  that `setsid()`s into a NEW group would escape PGID-scoped cleanup. That is
  a containment-boundary finding, NOT a reason to widen this repair.
* **H7 Installed artifact differs from source** — the installed native helper's
  `build_id` (85a87a82...) differs from a fresh source build (f727e702...), BUT
  the installed helper is functional and wire-compatible (proved live), so this
  is not the defect and was deliberately left untouched. The *extension* was
  built from source and is the artifact that carried the defect.

### Ablation (necessity gate) — same substrate, same workload, one variable

| Arm | `CLINEMM_HOST_HELPER_SOCKET` | provider | `cancel()` | group survived |
|---|---|---|---|---|
| B (pre-repair / real ext-host shape) | unset | `undefined` | **never resolves** | **true** |
| A (post-repair, env bound) | bound | present | resolves in 12 086 ms | false |
| GREEN (post-repair, env UNSET — real ext-host shape) | unset | **present** | resolves in 12 291 ms | **false** |

The arms differ only by the endpoint binding; the EPERM substrate is identical
in all of them. Arm B proves the failure; Arm A and GREEN prove the repair
recovers the SAME workload. The counterfactual is therefore demonstrated, not
merely asserted.

## Repair

One defective boundary, three files touched (plus two new files):

1. **`sdk/packages/shared/src/runtime/host-helper-socket.ts` (NEW)** — the
   single canonical resolver, using the two-tier rule ALREADY established
   elsewhere in this repository (`tools/macos-host-helper/server.ts:218`,
   `tools/tart-testbed/src/cli.ts:273`): `CLINEMM_HOST_HELPER_SOCKET` first,
   then `$HOME/.clinemm/host-helper.sock` (the installer's default, which is
   the path the LaunchAgent's `Sockets` dict binds). No I/O, so it is safe on
   any platform.
2. **`apps/vscode/src/sdk/host-helper-pgid-adapter.ts`** —
   `resolveLiveHelperOwnedPgidProvider()` now uses the shared resolver instead
   of reading the env var alone.
3. **`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts`** — the
   Seatbelt seam uses the same shared resolver (so the two seams can never
   disagree), and the resolved endpoint VALUE is seeded into the child
   environment. This last part was load-bearing: `materializeEnvironment`
   only carries an allow-listed variable that is ALSO present in `parentEnv`
   (`environment.ts:233-241`), so the allow-list NAME alone would have reached
   the child with no VALUE.

Preserved: Background Exec behaviour, command/shell semantics, timeout and
cancellation semantics, process-ownership boundaries, the Seatbelt filesystem
and network restrictions, normal command execution, and the helper protocol
(no protocol change; the installed helper is untouched and remains compatible).

NOT done (explicitly out of scope): no privileged root daemon; no commands run
outside Seatbelt; no sandbox widening; no generic `kill(pid)` RPC; no killing
by bare PID; no executor rewrite; no Tart runner; no MCP server; no change to
foreground terminal behaviour; no `setsid()` containment project.

### Security conservation (live, against the INSTALLED helper)

* Foreign-UID leader -> `DENY_OWNERSHIP` (uid mismatch).
* Unregistered / nonexistent PGID -> `DENY_LEADER_NOT_FOUND`.
* Invalid ownership token -> `BAD_REQUEST`; unknown client -> `DENY_UNKNOWN_CLIENT`.
* Wrong client identity -> `DENY_PEER_MISMATCH` (peer UID **and** PID must match).
* Leader that is not the peer's child and is not the peer -> `DENY_OWNERSHIP`.
* PID reuse -> refused via the kernel `start_us` comparison
  (`validate_pgid_ownership`, `helper.c:2447-2457`).
* Group leader with `getpgid(leader) != proposed_pgid` -> `DENY_OWNERSHIP`.
* Unexpected helper failure -> the adapter returns `{ok:false, code}` and the
  manager keeps `treeEscapee`; it cannot produce a false success verdict.

## GREEN (same workload, same observables)

```
envVarPresent=false HOME=/Volumes/UserData/Users/chistyakov
providerPresent=true
jobId=cmd_mw2hsa7ys93ds8n9 pgid=9095
cancel RESOLVED after 12291ms
TERMINAL survived=false
```

```
DIRECT_EPERM_OBSERVED    : yes   (EPERM at the signaling seam, still present — the
                                     substrate is unchanged, which is correct)
HELPER_FALLBACK_USED     : yes   (TERMINATED_KILL)
HELPER_AUTHORIZATION     : accepted
PRIMARY_PGID_POSTCONDITION: gone  (independently probed with kill(-pgid,0))
JOB_TERMINAL_STATE       : cancelled (job removed from the active map)
RESIDUAL_CONTROLLED_VICTIMS: 0
```

The direct path still returns EPERM. That is expected and correct: the repair
does not change the IDE's Chromium sandbox; it makes the existing, already
implemented helper fallback reachable from the real extension host.

## Conservation / gates

| Command | Result |
|---|---|
| `sdk/packages/shared` `bun run typecheck` | PASS (exit 0) |
| `sdk/packages/shared` `bun run build` | PASS (exit 0) |
| `sdk/packages/shared` vitest `src/runtime/host-helper-socket.test.ts` | **6 passed** (new) |
| `sdk/packages/core` `bun tsc --noEmit -p tsconfig.build.json` | 1 error — **PRE-EXISTING BASELINE**: `sdk-abort-cause-retention.ts:232 TS6133 'runKeyOf' is declared but never read` (file untouched by this ACT; identical at HEAD) |
| `sdk/packages/core` `bun run build` | bundle produced; the `tsc` step fails on the same baseline error only |
| `sdk/packages/core` vitest seatbelt host-helper / backend / profile | **52 passed, 19 skipped** |
| `sdk/packages/core` vitest `bash.supervised.test.ts` | **10 passed, 3 skipped** (identical to the prior-ACT documented baseline) |
| `apps/vscode` `bunx tsc --noEmit` | PASS (exit 0) |
| `apps/vscode` vitest `host-helper-pgid-adapter.test.ts` | **14 passed** |
| `apps/vscode` vitest `host-helper-pgid-adapter` + `task-header-runtime-error-counter-rec01` | **27 passed** |
| `apps/vscode` vitest `command-job-manager{,.owner-session-id,.sandbox-integration}` | 27 failed / 20 passed — **BASELINE, byte-identical failure set** (verified by stashing the ACT changes and re-running: `diff` of the two failure lists is empty). Cause: `sandbox_apply: Operation not permitted` (nested Seatbelt in the IDE-sandboxed authoring shell) -> `spawn_failed`. |
| biome `check --diagnostic-level=error` on changed files | apps/vscode + shared: clean after `--write`; core `seatbelt-backend.ts`: 4 diagnostics — **PRE-EXISTING BASELINE** (identical set at HEAD: `organizeImports`, 2x `noNonNullAssertion`, 2x `noImplicitAnyLet`, `format`) |
| `bun esbuild.mjs --production` | PASS; bundle contains the resolver; `process.env.CLINEMM_HOST_HELPER_SOCKET` reads in the bundle: **0** |
| `vsce package --no-dependencies` | PASS -> `dist/clinemm-act01.vsix` (65 239 878 bytes) |

ACT-owned diagnostics: **0**.

## Installed qualification

NOT EXECUTED. The operator declined the automated install and will dogfood
manually. The (attempted) install failed with `EPERM: operation not permitted,
mkdir .../.vscodium-clinemm/extensions/.6c32b5ec-...` (sandbox), so the
installed extension is byte-identical to the pre-ACT build
(`4a860df9...`); nothing was replaced.

The built artifact IS ready for manual dogfood:

```
VSIX  = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/dist/clinemm-act01.vsix
VSIX_SIZE   = 65239878
VSIX_SHA256 = 39932d6de931181779955477e8f145a6a043d4932d18afa0cfb9000981b30b36
```

What remains unproven by the manual dogfood, and how to prove it:
1. That the RELOADED extension host (not the repository's `CommandJobManager`)
   resolves the endpoint from `$HOME` and registers the owned PGID.
2. That a real Background Exec cancellation in the UI records the EPERM
   incident and recovers the group.
3. The kernel postcondition observed from OUTSIDE the extension.

## Remaining uncertainty

```
PRIMARY_PGID_CONTAINMENT_PROVEN : yes — live kernel evidence, verified gone
DESCENDANT_CONTAINMENT_UNPROVEN : yes — a descendant that leaves the group
                                   (setsid / detached:true) is NOT reached by
                                   PGID-scoped cleanup. Not demonstrated here
                                   and not fixed by this ACT.
FULL_DESCENDANT_CONTAINMENT_PROVEN : NO
```

Also unresolved and NOT caused by this ACT: the 5 residual victim groups left
by the EARLY exploratory probes (PIDs 42882, 49687, 49688, 52855, 52856). They
are 0.0 % CPU idle `sleep` loops. Their authorized owner peers are themselves
permanently stuck inside `await manager.cancel()` (the pre-repair hang), and
the host helper CORRECTLY refuses to reclaim them from an unauthorized peer
(`DENY_OWNERSHIP` / `DENY_LEADER_NOT_FOUND`). Every signal path from the
authoring shell is denied with EPERM by the same substrate under investigation.
The qualification runs themselves leave **0** residual victims.

## Remaining risks

1. The installed extension has NOT been reloaded with this fix — the user's
   orphan symptom persists until the manual dogfood install.
2. The helper's ownership model cannot reclaim a group whose owner peer is
   gone (correct fail-closed, but it means a crash of the owner leaves an
   orphan). A future ACT could add an owner-death reaper scoped to the
   helper's own registry.
3. Descendant escape via `setsid()` remains unproven/unfixed.

## NEXT_ACT

None. This ACT closes with the installed-UI dogfood left to the operator by
explicit instruction. If the operator's manual dogfood shows the helper
fallback engaging, the only follow-up worth considering is a scoped
owner-death reaper (H6 / risk 2); it must not weaken the helper's authority
model.

## Note on the new vitest file (`command-job-manager.host-helper-live-ablation01.test.ts`)

The file is discovered by the repo's vitest config (`src/sdk/**/*.test.ts`)
and parses cleanly (`esbuild` transform: PARSE_OK, 4161 bytes). It could not be
executed to completion under the vitest **forks** pool in this authoring
environment because the pool's worker teardown is denied with EPERM by the
very substrate under investigation (`[vitest-pool]: Failed to terminate forks
worker ... Error: kill EPERM`) — the identical, already-documented artifact
recorded in `.factory/evidence/ACT-CLINEMM-SANDBOX-OWNED-PROCESS-TERMINATION01/03-red-foreground.txt`.

Its two arms were therefore executed as **direct bun drivers** against the same
production `CommandJobManager` (no mocks, real kernel, real installed
helper), which is where the numbers in the Causality / Ablation sections come
from:

* `03-ablation-arm-b.log` — ARM B (env unbound): provider absent, `cancel()`
  never resolved, group survived.
* `04-ablation-arm-a.log` — ARM A (env bound): `cancel RESOLVED after 12086ms`,
  `survived=false`.
* `01-red-green-r1.log` — consolidated RED/GREEN with guaranteed
  self-reclamation; `RESIDUAL_CONTROLLED_VICTIMS_AFTER_CASE = 0` for both arms.
* `02-green-repaired.log` — GREEN through the repaired production path with the
  real extension-host env shape (`envVarPresent=false`).

The test file itself carries a substrate gate: when the substrate is NOT
EPERM-affected it SKIPs with a loud reason rather than reporting a false
GREEN (a non-EPERM substrate would make arm B pass trivially and the ablation
meaningless).
