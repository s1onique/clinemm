# ACT-CLINEMM-LAUNCHAGENT-OWNED-PGID-LIVE-QUALIFICATION01-CORRECTION01

> Status: **PASS** (per §16 outcome A).
> Two bounded corrections to the parent ACT
> `ACT-CLINEMM-LAUNCHAGENT-OWNED-PGID-LIVE-QUALIFICATION01` at
> commit `47ca5add2903339a5f6280fcafdd6122d404c265`.
> No helper redesign. No sandbox redesign. No production code change.

## Question

The parent ACT established that the production `CommandJobManager`
seam, the real launchd-managed helper, and the real kernel signaling
authority all work together to terminate owned process groups even
when this IDE sandboxed shell cannot signal its own groups. The
parent ACT also claimed `CLIENT_ISOLATION = LIVE PASS` based on its
§12 cross-client test, and its seam labels implicitly claimed
`REAL_EXTENSION_HOST_END_TO_END`.

Two of those claims exceed the evidence:

- **P0-A:** The parent §12 test used client A's `client_token` as if
  it were a `job_token`. The helper returned `DENY_UNKNOWN_JOB`
  because no job was ever registered under that 32-hex string — the
  response is structurally indistinguishable from ordinary
  unknown-job rejection and does not prove foreign-ownership
  enforcement.
- **P0-B:** The driver is a standalone Bun harness that directly
  imports production modules and forces `CLINEMM_EXPERIMENTAL_SANDBOX`
  to `"off"` before instantiating `CommandJobManager`. It is not the
  extension-host lifecycle (`codium-clinemm` → `vscode-session-host`
  → task creation → `CommandJobManager`).

## Answer

**P0-A FIXED — corrected discriminator passes live.**
The new discriminator uses a real A-owned `job_token` issued by the
helper via the production wire provider, and a separate Bun subprocess
for client B with a distinct kernel peer PID. The load-bearing result:

```text
B + JA_real → DENY_FOREIGN_JOB
A + JA_real → ALLOW (TERMINATED_TERM)
PGID_A after B's rejected attempt = ALIVE
PGID_A after A's positive control  = GONE
```

The helper's `DENY_FOREIGN_JOB` is the canonical cross-ownership
denial code (helper.c:1694). It is the only error code that proves
foreign-ownership enforcement — it can only be returned when:

1. `find_client(client_token)` resolves to a real client slot,
2. `find_job(job_token)` resolves to a real active job slot,
3. `strcmp(job->owner_client_token, cl->client_token) != 0`.

The prior §12 test could not reach this branch because step 3 was
trivially true for a `client_token` that was never registered as a
job — the denial was generated at step 2 (`DENY_UNKNOWN_JOB`) before
step 3 could fire.

**P0-B FIXED — seam labels rebound honestly per §10:**

```text
COMMANDJOBMANAGER_CODE     = REAL_PRODUCTION_FUNCTION
HELPER_ADAPTER             = REAL_PRODUCTION_FUNCTION
LAUNCHAGENT                = REAL | LIVE
KERNEL_SIGNALING           = REAL | LIVE
DRIVER                     = SYNTHETIC_REAL
REAL_EXTENSION_HOST_END_TO_END = NOT_EXECUTED
```

`REAL_EXTENSION_HOST_WIRING = LIVE_UNOBSERVABLE` for this run.
Per §11, this is acceptable when obtaining the real extension-host
witness requires intrusive instrumentation forbidden by that
section. The narrower classification is honestly bound to evidence.

## Live driver evidence

Full driver: `.factory/evidence/ACT-CLINEMM-LAUNCHAGENT-OWNED-PGID-LIVE-QUALIFICATION01-CORRECTION01/live-driver-full.log`.

Key gates:

```text
GATE 2.A_REGISTRATION=PASS        state=running pgid=25214 pid=25214
GATE 2.detached_leader=PASS       pid==pgid (POSIX detached leader convention)
GATE 2.A_JOB_TOKEN_REAL=PASS      helper issued a 32-hex-char job_token
GATE 2.client_token_present=PASS
GATE 2.job_token_present=PASS
GATE 2.tokens_distinct=PASS       client_token != job_token
GATE 2.peer_pid_match=PASS        wire.peer_pid == harness.pid

GATE 3.peer_pids_differ=PASS      peer_pid_B=25243 != peer_pid_A=24876
GATE 3.B_USING_A_REAL_JOB_TOKEN=PASS b's terminate(CB, JA_real) was denied
GATE 3.B_ERROR=DENY_FOREIGN_JOB   (canonical cross-ownership denial code)

GATE 4.A_GROUP_AFTER_B_ATTEMPT=ALIVE   no signal reached A's group

GATE 5.A_OWN_TERMINATION=PASS     A's terminate(CA, JA_real) returned TERMINATED_TERM
GATE 6.PGA_FINAL=GONE             A's PGID is gone after owner terminate
GATE 6.A_SECRET_REMOVED=true      /tmp secret file removed (no raw tokens leaked)
```

## Honest seam classification (per §10)

| Seam | Status |
|------|--------|
| Helper discovery (production factory resolves) | REAL | LIVE |
| Kernel peer identity (getpeereid + LOCAL_PEERPID) | REAL | LIVE |
| `CommandJobManager` start + register via provider | REAL_PRODUCTION_FUNCTION | LIVE |
| Helper ownership registration | REAL | LIVE |
| `process-group.terminate-owned` wire dispatch | REAL | LIVE |
| Helper SIGTERM/SIGKILL escalation | REAL | LIVE |
| Cross-client isolation enforcement | REAL | LIVE |
| Helper self-restart via launchd | REAL | LIVE |
| Extension-host lifecycle (`vscode-session-host` → task flow → `CommandJobManager`) | LIVE_UNOBSERVABLE |

Driver shape: standalone Bun harness that imports the production
`CommandJobManager` class and the production
`createHelperWireClient` wire provider. The driver instantiates
`new CommandJobManager(...)` exactly as production code does, calls
`.start({...})` exactly as production code does, and uses the wire
client to register the same PGID via a second `client.open` so the
resulting `job_token` is fully under our control.

This is NOT a synthetic test against a fake helper. The launchd-managed
`io.clinemm.host-helper` binary (build_id
`c5f3ea0322ae92a6ea5378577e39fef95696057b8ad6fba63a1fce57f80b74b9`)
is the real signal authority end-to-end.

## Why the prior §12 test was structurally invalid

The prior driver (line 237 of `live-driver-2.mjs`):

```javascript
const bTermA = await helperRoundTrip({
  version: 1, request_id: `bTermA-${Date.now()}`,
  method: "process-group.terminate-owned",
  client_token: coB.client_token,
  job_token: coA.client_token,   // <-- THE DEFECT
})
```

`coA.client_token` is a 32-hex-char **client** token issued by
`client.open`. The helper's job table is keyed by `job_token`
(also 32-hex chars) — a completely independent namespace. There is
no job registered under `coA.client_token`, so the helper's
`resolve_owned_job()` (helper.c:1686) hits:

```c
job_record_t *job = find_job(jt_kv->val);
if (!job || !job->active) { respond_err(cfd, "DENY_UNKNOWN_JOB"); return 0; }
```

before reaching the `strcmp(job->owner_client_token, cl->client_token)`
check that would discriminate foreign ownership. The denial is
structurally indistinguishable from "no job with that token exists"
— a response the helper would give to ANY client trying to use a
random 32-hex string as a `job_token`.

This ACT's corrected test uses a real `job_token` that was issued to
client A by `registerOwned()` against A's actually-owned PGID. Now
`find_job(jt_kv->val)` succeeds, and the discriminator
`strcmp(job->owner_client_token, cl->client_token) != 0` fires —
returning the canonical `DENY_FOREIGN_JOB` code that proves
foreign-ownership enforcement.

## Cross-client discriminator (corrected shape)

The corrected test composition:

```text
HARNESS (peer_pid = A, opens helper client, gets CA)
  ↓
CommandJobManager.start()        // real production class
  ↓ spawns detached sh -c 'sleep 60; ...'
GROUP G with leader_pid == pgid, leader_ppid == A
  ↓
wire.registerOwned(clientToken=CA, pgid=G)
  ↓ helper issues job_token JA (length 32 hex)
  ↓ JA.owner_client_token = CA

SUBPROCESS B (peer_pid = B, B != A kernel PID)
  ↓
client.open                      // helper allocates new slot
  ↓ gets CB (CB != CA, distinct token)
  ↓
terminate-owned(client_token=CB, job_token=JA)
  ↓ helper.c:resolve_owned_job()
    find_client(CB)         → real client slot
    find_job(JA)            → real active job slot
    strcmp(JA.owner, CB)    → MISMATCH
    → DENY_FOREIGN_JOB      ← the load-bearing code

HARNESS verifies: PGID_G still alive (ps probe, helper active_job_count >= 1)

HARNESS calls: terminate-owned(client_token=CA, job_token=JA)
  ↓ helper.c:resolve_owned_job()
    find_client(CA)         → real client slot
    find_job(JA)            → real active job slot
    strcmp(JA.owner, CA)    → EQUAL
    peer_matches(CA, pi)    → OK
    → helper executes SIGTERM (grace) → SIGKILL escalation
    → group gone
    → job slot cleared, returns TERMINATED_TERM

HARNESS verifies: PGID_G gone (ps probe fails)
```

## Frozen claims that were NOT reopened

These remain accepted from the parent ACT (commit `47ca5add2`):

```text
HELPER_DISCOVERY                  = PASS
KERNEL_PEER_UID                   = PASS
KERNEL_PEER_PID                   = PASS
REAL_COMMANDJOBMANAGER_FUNCTION   = PASS
OWNERSHIP_REGISTRATION            = PASS
DIRECT_SUBSTRATE_EPERM            = PASS
HELPER_FALLBACK                   = PASS
GROUP_GONE                        = PASS
JOB_RELEASE                       = PASS
TERM_TO_KILL_ESCALATION           = PASS
HELPER_SELF_RESTART               = PASS
LAUNCHD_REGISTRATION_CONSERVED    = PASS
PRODUCT_RESTART_LAUNCHCTL_CALLS   = 0
SANDBOX_INSTALL_PATH_WRITE        = HALT_SANDBOX_CANNOT_INSTALL_HELPER_BINARY
```

## Production code delta

**NONE.** The corrected discriminator works against the existing
production helper binary and existing production
`CommandJobManager` / provider modules. The defect was in the test,
not in the production code.

## Outcome (per §16)

```text
ACT                          = PASS
CLIENT_ISOLATION             = LIVE PASS  (corrected discriminator with real JA)
PARENT_QUALIFICATION         = PASS_WITH_BOUNDED_INSTALL_PATH_HALT
                              (with corrected seam labels)
PRODUCTION_CODE_DELTA        = NONE
REAL_EXTENSION_HOST_WIRING   = LIVE_UNOBSERVABLE
                              (acceptable per §11; not HALT)
```

## Next ACT (per §22)

`ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01` —
resume from `HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND` and obtain
the operator TSWPD live capture. The helper termination repair is
already proven live; the background handoff bug is actively
degrading long-running tasks.

Do **not** prioritize `SANDBOX-INSTALL-PATH-WRITABLE01` ahead of that
unless the helper-update path becomes an immediate operational
blocker.

## STOP rule (per §21)

After this ACT: **NO MORE HOST-HELPER PRE-REVIEW** unless a new P0
appears. The host-helper work is done.

## Evidence

`.factory/evidence/ACT-CLINEMM-LAUNCHAGENT-OWNED-PGID-LIVE-QUALIFICATION01-CORRECTION01/`:

- `00-entry.txt` — entry freeze (HEAD, launchctl, pgrep, single permanent helper)
- `01-old-discriminator-red.mjs`, `01-old-discriminator-red.txt` — RED proof of the prior §12 structural invalidity
- `02-client-a-registration.txt` — real A-owned job registered via CommandJobManager + wire
- `03-client-b-distinct-peer.mjs`, `03-client-b-identity.txt` — subprocess B with distinct kernel peer PID
- `04-cross-client-deny.txt` — B's terminate(CB, JA_real) returns DENY_FOREIGN_JOB; A's PGID still alive
- `05-owner-positive-control.txt` — A's terminate(CA, JA_real) returns TERMINATED_TERM
- `06-cleanup.txt` — PGID_A gone; /tmp secret file removed (no raw tokens in durable evidence)
- `07-extension-host-witness.txt` — LIVE_UNOBSERVABLE per §11
- `08-classification-rebind.txt` — honest seam labels per §10
- `09-gates.txt` — gate-by-gate results
- `live-driver-correction.mjs` — driver source
- `live-driver-full.log` — full driver output
- `result.json` — machine-readable outcome
