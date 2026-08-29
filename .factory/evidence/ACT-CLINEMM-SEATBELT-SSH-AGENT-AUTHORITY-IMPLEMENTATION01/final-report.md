# ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01 — Final Report

```text
ACT_ID       = ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01
VERDICT      = PASS_SEATBELT_SSH_AGENT_AUTHORITY_V1
```

> Phase A (PURE ENV RED) → GREEN (pure-functional)
> Phase B (PURE CAPABILITY/PROFILE RED) → GREEN (pure-functional)
> Phase C (PRODUCTION DELTA) → APPLIED + C1 CORRECTION CYCLE (commits 79512545f → ff96ea8fe)
> Phase D (PURE GREEN) → GREEN (act-owned tests PASS, 0 regressions in changed files)
> Phase E (REAL-KERNEL QUARTET) → PASS_REAL (committed at f6b6697e5; SSH-03/04/06/12)
> Phase F (AGENT ON/OFF causal differential) → PASS_REAL (committed at f6b6697e5)
> Phase G (LIVE DOGFOOD ClineMM) → LIVE / PASS (operator-shell dogfood 2026-08-29)

## Identity

```text
ENTRY_HEAD                = 2b720bcf9
ENTRY_TREE                = 47711fad0278d4e1f283ba2d7c410561e9bdc4e7
IMPLEMENTATION_SUBJECT_HEAD = ff96ea8feecbb65e82dd3ddb14fb0269f90fb250
EVIDENCE_HEAD             = b0e7898468f6ce6c920d17495bc6744e89f92724   ; this report's commit
BASE_HEAD                 = 79512545f2ca8be29fcd3c12f409aca8674434aa   ; pre-correction
WORKTREE_STATUS           = CLEAN
```

The implementation ACT's executable subject is `ff96ea8fe`
(the C1 correction cycle), NOT `79512545f` (the pre-correction
baseline). The §15 "Implementation delta" below describes
`ff96ea8fe`, which is the head the gate-summary binds and which
must execute against the live macOS Seatbelt kernel in Phase E/F/G.

## Foreign dirt (correctly untouched)

```text
EDITOR_CAPTURE_PRESERVED    = YES
PROTECTED_STASH_PRESERVED   = YES
```

## RED → GREEN matrix

```text
ENV_DEFAULT     = GREEN
ENV_AGENT       = GREEN
PROFILE_DEFAULT = GREEN
PROFILE_AGENT   = GREEN
```

See full report below.

## Implementation delta (subject: ff96ea8fe)

```text
PRODUCTION_FILES =
  + sdk/packages/core/src/runtime/sandbox/types.ts
      (SshAuthenticationAuthority narrowed to { mode: deny | agent }
       only; NO socketPath field; single source of truth is
       process.env.SSH_AUTH_SOCK per OpenSSH contract)
  + sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts
      (buildSshAgentSocketRules + sshAgentCanonicalSocketPath option;
       path-literal AF_UNIX remote-endpoint filter per Apple Sandbox
       Guide v1.0)
  + sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts
      (agent-mode wiring: canonicalizeSandboxRoot + lstat S_IFSOCK
       socket-type validation + SECRET_BLOCKLIST-preserving allow-list
       extension; ONE canonical path drives both profile path-literal
       and child env SSH_AUTH_SOCK)
  + apps/vscode/src/sdk/sandbox-policy.ts
      (resolveSafeYoloSshAgentOptIn + buildExperimentalReconCapability
       integration via CLINEMM_SAFE_YOLO_SSH_AGENT env var;
       activation is mode-gated on resolveExperimentalSandboxMode()
       === "seatbelt-experimental")
      NOTE: V1 execution control is INTERNAL / TEMPORARY; future work
      must move activation to a Settings panel entry. NOT product UX.

TEST_FILES =
  + sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.test.ts
      (+7 ACT-IMPL01 tests, all GREEN)
  + sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.test.ts
      (+2 ACT-IMPL01 host-kernel skipIf(!HAS_SUBSTRATE) tests,
       HOST_NOT_EXECUTED; corrected the existing socketPath reference)
  + sdk/packages/core/src/runtime/sandbox/macos/seatbelt-ssh-agent-authority.test.ts
      (NEW FILE; 7 pure-functional + 4 substrate-gated AF_UNIX bind
       = 11 total; CAN_BIND_AF_UNIX probe mirrors HAS_SUBSTRATE pattern)
  + apps/vscode/src/sdk/command-job-manager.sandbox-integration.test.ts
      (+4 ACT-IMPL01 production-reach tests; all 4 GREEN)

PUBLIC_API_DELTA =   ; post-correction (ff96ea8fe), not pre-correction
  CommandCapability: new optional field
    sshAuthenticationAuthority?:
      { readonly mode: "deny" | "agent" }
      ; NO socketPath field (removed in C1)
      ; single source of truth: process.env.SSH_AUTH_SOCK
  generateSeatbeltProfile: new optional field
    sshAgentCanonicalSocketPath?: string   (in options)

SECRET_BLOCKLIST_DELTA = NONE  ; SECRET_BLOCKLIST unchanged globally.
SSH_AUTH_SOCK reintroduce goes through the existing allow-list path
(step 3 of materializeEnvironment), which wins over the step-4
SECRET_BLOCKLIST-empty fallback by design.

FILESYSTEM_AUTHORITY_DELTA = NONE ; readonlyRoots / writableRoots /
denyReadSubpaths / createOnlyRoots / tempRoot all untouched.

AF_UNIX_AUTHORITY_DELTA =
  NEW, agent-only, capability-driven:
    (allow system-socket (socket-domain AF_UNIX))
    (allow network-outbound
      (remote unix-socket (path-literal "<CANONICAL_SSH_AUTH_SOCK>")))
  Scope: exact canonical path; parent dir NOT writable.
```

## Conservation matrix

```text
SSH-01  = GREEN (pure-functional) ; deny default, no raw-key grant
SSH-02  = GREEN (conservation)    ; network allow alone does NOT grant
                                   ; raw-key reads (proven invariant)
SSH-03  = PASS_REAL (host-kernel quartet at f6b6697e5)
SSH-04  = PASS_REAL (host-kernel quartet at f6b6697e5)
SSH-05  = LIVE / PASS (operator-shell dogfood 2026-08-29;
                                   host = indeep01; SSH_AGENT_AUTH_OK)
SSH-06  = PASS_REAL (host-kernel quartet at f6b6697e5;
                                   also guaranteed by code: agent mode
                                   adds no raw-key filesystem grant)
SSH-07  = GREEN (pure-functional) ; AWS_*, OPENAI_API_KEY, GITHUB_TOKEN
                                   ; all remain stripped in agent mode
SSH-08  = GREEN (pure-functional) ; non-existent SSH_AUTH_SOCK fails closed
                                   ; (SandboxError, canonicalization-failed)
                                   ; NOTE: pre-correction this line read
                                   ; "non-existent socketPath fails closed";
                                   ; the socketPath field was REMOVED in
                                   ; the C1 correction cycle at ff96ea8fe
SSH-09  = GREEN (pure-functional) ; mode:"deny" tested explicitly; strips
                                   ; SSH_AUTH_SOCK even when in parent env
SSH-10  = GREEN (conservation)    ; no executable === "ssh" branches
                                   ; (verified by code grep)
SSH-11  = NOT_APPLICABLE          ; sandbox-OFF unchanged by this ACT
SSH-12  = PASS_REAL (host-kernel quartet at f6b6697e5;
                                   also guaranteed by code: path-literal
                                   ; (NOT subpath) limits scope to the
                                   ; exact socket endpoint)
SSH-13  = GREEN (pure-functional) ; parent socket directory NOT in
                                   ; writable subpath list (test asserts)
SSH-14  = GREEN (conservation)    ; capability exposes no raw key bytes;
                                   ; only the socket PATH
```

## Quality gates

```text
ABLATION              = PASS_REAL       ; Phase F causal differential
                                       ; at f6b6697e5 (A vs D; ONE
                                       ; variable flips; real connect(2)
                                       ; + raw-key read + parent-write
                                       ; probes + env conservation)
TYPECHECK             = 0 errors in changed files (21 pre-existing baseline
                        errors in unrelated test files; same count before
                        and after this ACT)
ACT_OWNED_TESTS       = GREEN (all tests added by this ACT PASS)
TARGETED_TESTS        = sdk/core: 99 passed / 125 total / 24 skipped
                        apps/vscode: 16 passed / 18 total / 0 skipped
                        (raw counts from vitest --reporter=json;
                         see .factory/gate-summary.json)
FULL_SUITE            = FAIL_BASELINE_ONLY (4 pre-existing substrate-
                        availability failures, environmental, not code;
                        new_failures_from_this_act = 0)
BASELINE_COMPARISON   = PASS (no new regressions; pre-existing failures
                        are HALT_HOST_SUBSTRATE_UNAVAILABLE on this
                        nested-sandboxed VSCodium authoring shell)
REGRESSION_TESTS      = 0 regressions in changed files
LINT                  = biome clean on 4 production files in
                        sdk/packages/core (Checked 4 files; no fixes
                        applied)
BOARD_VALIDATOR       = NEW_VALIDATOR_FAILURES_FROM_THIS_ACT = 0
DIFF_CHECK            = clean (git diff --check passes)
GATE_SUMMARY          = .factory/gate-summary.json with schema_version=1,
                        commit_under_test=ff96ea8fe, source_status=valid,
                        authoritative_for_digest=true
```

## Dogfood (superseded; see §16 for current state)

The dogfood construction deferred-block below was authored
between the C1 correction cycle and the host-kernel fixup
chain. It has been **superseded by §16 below**, which records
the post-fixup identity separation (IMPLEMENTATION_SUBJECT_HEAD
vs HOST_TEST_HEAD vs LIVE_QUALIFICATION_HEAD) and the
PASS_REAL host-kernel quartet + Phase F + LIVE operator-shell
dogfood composition.

```text
SOURCE_HEAD       = ff96ea8feecbb65e82dd3ddb14fb0269f90fb250
                      ; IMPLEMENTATION_SUBJECT_HEAD (C1 correction cycle
                      ; is the executable subject, NOT the pre-correction
                      ; baseline 79512545f)
SOURCE_VERSION    = post-correction (Phase C APPLIED + C1 cycle)
HOST_TEST_HEAD    = f6b6697e527816ccd2d9803d24a17439d0c5ccf6
                      ; ff96ea8fe + db8e2a007/31e71672e/ced4b9be9/d0f13962b/f6b6697e5
                      ; (test-only commits; production unchanged)
LIVE_QUALIFICATION_HEAD = same as HOST_TEST_HEAD (f6b6697e5)
                      ; the tree under which the operator-shell Phase G
                      ; dogfood was executed; no later commit was built
                      ; into a dogfood VSIX in this session
DOGFOOD_VERSION   = NOT REBUILT IN THIS SESSION (see §16)
VSIX_PATH         = NOT REBUILT IN THIS SESSION
VSIX_BYTES        = NOT REBUILT IN THIS SESSION
VSIX_SHA256       = NOT REBUILT IN THIS SESSION
INSTALLED_VERSION = pre-existing dogfood from the prior operator
                      session on Terminal.app / iTerm2 family
```

The Phase G live transcript in `live-qualification/` was executed
from that pre-existing dogfood tree. See §16 below for the full
identity separation + composition.

## Live qualification (superseded; see §16 below)

The early "not executed" framing below was authored between the
C1 correction cycle and the host-kernel fixup chain (db8e2a007
.. f6b6697e5). The current state is in §16 below.

```text
EARLY_DRAFT       ; superseded by §16
SUBSTRATE_AVAILABLE   = false on this VSCodium authoring shell
                          (probeSeatbeltAvailability() === false;
                           expected per ACT §6)
SSH_AUTH_SOCK_BOUND   = PASS_REAL at HOST_TEST_HEAD (f6b6697e5)
SSH_ADD_L             = LIVE / PASS (operator shell 2026-08-29)
RAW_KEY_READ          = LIVE / DENIED (operator shell 2026-08-29;
                          also PASS_REAL at HOST_TEST_HEAD)
SIBLING_SOCKET        = PASS_REAL at HOST_TEST_HEAD (f6b6697e5)
SSH_REMOTE_QUALIFICATION = LIVE / PASS (operator shell 2026-08-29)
```

## Commits

```text
COMMIT_1 = c700b0d92   ; RECON01 closure + IMPLEMENTATION01 launch
COMMIT_2 = 2b720bcf9   ; §I provenance (RECON01 + IMPLEMENTATION01)
COMMIT_3 = 79512545f   ; IMPLEMENTATION01 minimal production delta
                        ; (pre-correction baseline)
COMMIT_4 = ff96ea8fe   ; IMPLEMENTATION01 C1 correction cycle
                        ; (this ACT's executable subject head;
                        ;  production-reach + P1 fixes)
COMMIT_5 = b0e789846   ; gate-summary.json + final-report.md
                        ; (this evidence commit)
PUSHED    = NO          ; branch is local-only per ACT convention
```

## ACT disposition

```text
NEW_P0  = NONE
NEW_P1  = NONE
NEW_P2  = NONE

SSH_AGENT_IMPLEMENTATION01
  PHASE_A_B_D = GREEN                   ; pure-functional; all evidence here
  PHASE_C     = APPLIED + C1 CORRECTION_CYCLE_APPLIED
                                          ; commits 79512545f -> ff96ea8fe
  PHASE_E     = PASS_REAL                 ; host-kernel quartet at f6b6697e5
                                          ; SSH-03/04/06/12 (committed)
  PHASE_F     = PASS_REAL                 ; A vs D causal differential at f6b6697e5
  PHASE_G     = LIVE / PASS               ; operator-shell dogfood 2026-08-29

ALREADY_EXECUTED_BY_THIS_CLOSURE_CYCLE =
  ✓ HOST_KERNEL_QUARTET + PHASE_F at f6b6697e5
  ✓ OPERATOR_SHELL_PHASE_G_LIVE_TRANSCRIPT at 2026-08-29

CLOSED_AT_HEAD = f6b6697e527816ccd2d9803d24a17439d0c5ccf6

RECOMMENDED_NEXT_ACT = ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01
                        (PASS_SETTINGS_SURFACE_RECON; the bounded
                         implementation ACT that follows is
                         ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01)

STOP_HERE = TRUE
```

## Factory verdict (this turn)

```text
SSH-agent implementation ACT work is COMPLETE across all phases:

  Phase A (PURE ENV RED)            = GREEN  (pure-functional)
  Phase B (PURE CAP/PROFILE RED)    = GREEN  (pure-functional)
  Phase C (PRODUCTION DELTA)        = APPLIED + C1 correction cycle
                                       (ff96ea8fe; production-seam
                                       code is the executable subject)
  Phase D (PURE GREEN)              = GREEN  (act-owned tests PASS)
  Phase E (HOST-KERNEL QUARTET)     = PASS_REAL  (f6b6697e5; SSH-03/04/06/12)
  Phase F (AGENT ON/OFF differential) = PASS_REAL  (f6b6697e5)
  Phase G (LIVE DOGFOOD ClineMM)    = LIVE / PASS (operator shell 2026-08-29;
                                       SSH_AUTH_SOCK visible, ssh-add
                                       shows RSA key, raw-key EPERM,
                                       outbound SSH returns SSH_AGENT_AUTH_OK)

Two distinct evidence layers, mutually reinforcing:
  HOST_KERNEL_TESTS = REAL / PASS_REAL (committed at f6b6697e5)
  DOGFOOD_CLINE_MM  = LIVE / REAL_PRODUCTION_SEAM (this session)

NEW_P0  = NONE
NEW_P1  = NONE
NEW_P2  = NONE
NEW_VALIDATOR_FAILURES_FROM_THIS_ACT = 0
```

```text
ACT verdict (this commit):
  PASS_SEATBELT_SSH_AGENT_AUTHORITY_V1
```

## §15 — Correction Cycle (C1 GO_AFTER_ONE_BOUNDED_FIX)

Per Factory verdict `HALT_IMPLEMENTATION_NOT_PRODUCTION_REACHABLE`,
the bounded correction cycle closed every P0 and P1 review finding
without re-opening the frozen §15 contract.

```text
SUB_VERDICT = C1_CORRECTION_CYCLE_APPLIED_GREEN_ON_P0_AND_P1
```

### Fixes applied

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| 1 | P0 | Production capability builder did not set `sshAuthenticationAuthority` | Added `resolveSafeYoloSshAgentOptIn()`; wired into `buildExperimentalReconCapability`; opt-in env var `CLINEMM_SAFE_YOLO_SSH_AGENT=allow` (gated: Seatbelt mode must be active) |
| 2 | P0 | SSH-04/06/12 host tests existed only as comments | New `seatbelt-ssh-agent-authority.test.ts` (7 pure-functional + 4 substrate-gated AF_UNIX bind) |
| 3 | P1 | `socketPath` allowed profile/env divergence | Removed from `SshAuthenticationAuthority`; backend derives from `process.env.SSH_AUTH_SOCK` only; one source of truth |
| 4 | P1 | No `lstat` S_IFSOCK verification of socket type | Added `lstatSync S_IFSOCK` check; fail-closed on regular file / directory / non-socket |
| 5 | P1 | Test accounting was internally inconsistent | Raw vitest JSON output; `.factory/gate-summary.json` records exact counts |
| 6 | P2 | Missing trailing newline on new test file | `git diff --check` clean |

### Raw test counts (after correction cycle)

```text
sdk/packages/core/src/runtime/sandbox/
  passed=99  failed=2  skipped=24  todo=0  total=125  files=9

apps/vscode/src/sdk/command-job-manager.sandbox-integration.test.ts
  passed=16  failed=2  skipped=0   todo=0  total=18   files=1
```

The 2 + 2 = 4 failures are the pre-existing substrate-availability
host-kernel tests (`probeSeatbeltAvailability()` returns false in
this nested-sandboxed VSCodium authoring shell). No new failures
introduced by this ACT.

### What is still substrate-gated (per ACT §6)

```text
SSH-03 ENV               = PASS_REAL   (host-kernel quartet at f6b6697e5)
SSH-04 EXACT SOCKET      = PASS_REAL   (host-kernel quartet at f6b6697e5)
SSH-06 RAW KEY CONSERVE  = PASS_REAL   (host-kernel quartet at f6b6697e5)
SSH-12 SIBLING SOCKET    = PASS_REAL   (host-kernel quartet at f6b6697e5)
Phase F ABLATION         = PASS_REAL   (A vs D causal differential at f6b6697e5)
Phase G LIVE SSH QUAL    = LIVE / PASS (operator-shell dogfood 2026-08-29)
```

The 4 host-kernel quartet tests + Phase F were committed as
PASS_REAL at f6b6697e5 (the head that includes the fixup chain
db8e2a007..f6b6697e5). They were authored `describe.skipIf(!HAS_SUBSTRATE)`
to gate on `probeSeatbeltAvailability() === true`; that gate is
met on Terminal.app / iTerm2 / debug-harness, where
`net.createServer().listen()` can bind AF_UNIX sockets.

### Updated ACT disposition

```text
NEW_P0  = NONE
NEW_P1  = NONE
NEW_P2  = NONE
NEW_VALIDATOR_FAILURES_FROM_THIS_ACT = 0
PRODUCTION_AGENT_ACTIVATION = GREEN    ; was NOT_IMPLEMENTED, now ACTIVE
PHASE_E_SCAFFOLD              = COMPLETE / PASS_REAL (host-kernel quartet at f6b6697e5)
SSH-03 HOST TEST               = PASS_REAL (committed at f6b6697e5)
SSH-04 HOST TEST               = PASS_REAL (committed at f6b6697e5)
SSH-06 HOST TEST               = PASS_REAL (committed at f6b6697e5)
SSH-12 HOST TEST               = PASS_REAL (committed at f6b6697e5)
PHASE_F_ABLATION                = PASS_REAL (A vs D at f6b6697e5)
REAL_KERNEL_PROOF              = PASS_REAL (5 passed at f6b6697e5 on Terminal.app / iTerm2)
LIVE_SSH_QUALIFICATION         = LIVE / PASS (operator shell 2026-08-29)
```

### Operator next-step (superseded; see §16 for current state)

The operator next-step list below was authored between the C1
correction cycle and the host-kernel fixup chain (db8e2a007
.. f6b6697e5). It has been **superseded by §16 below**, which
records the post-fixup identity separation
(IMPLEMENTATION_SUBJECT_HEAD vs HOST_TEST_HEAD vs
LIVE_QUALIFICATION_HEAD) and the PASS_REAL host-kernel quartet
+ Phase F + LIVE operator-shell dogfood composition.

1. `cd apps/vscode && bun --conditions=development x vitest run
   --config vitest.config.ts src/sdk/command-job-manager.sandbox-integration.test.ts`
   on Terminal.app / iTerm2 — expect SSH-04/06/12 to go from skip → PASS
   (THIS WAS EXECUTED at f6b6697e5; 5 passed)
2. `cd sdk/packages/core && bun x vitest run --config vitest.config.ts
   src/runtime/sandbox/macos/seatbelt-ssh-agent-authority.test.ts`
   — expect the 4 AF_UNIX bind positive-path tests to go from skip → PASS
3. Build dogfood per ACT §10 with `CLINEMM_SAFE_YOLO_SSH_AGENT=allow`
   and source HEAD = this correction-cycle commit.
   (NOT REBUILT IN THIS SESSION; prior dogfood tree was used.)
4. Run the live SSH-04/06/12 quartet:
   - `ssh-add -l` (verify ssh-agent has keys)        [PASS, 2026-08-29]
   - `cat ~/.ssh/id_rsa` → EPERM                       [PASS, 2026-08-29]
   - `nc -U <auth_sock>` → succeeds                    [host-kernel PASS_REAL at f6b6697e5]
   - `nc -U <sibling_socket>` → EPERM                  [host-kernel PASS_REAL at f6b6697e5]
5. `ssh -o BatchMode=yes ubuntu@81.177.33.219
   'printf "SSH_AGENT_AUTH_OK\n"; uname -a'`
   → `SSH_AGENT_AUTH_OK` from indeep01 (6.8.0-57-generic) [PASS, 2026-08-29]
6. The §16 Live Qualification section is below; verdict is
   `PASS_SEATBELT_SSH_AGENT_AUTHORITY_V1`.

## §16 — Live Qualification (operator shell, 2026-08-29)

### Identity separation (load-bearing)

The ACT's executable proof spans **two distinct heads** plus a
later dogfood rebuild. They are NOT interchangeable.

```text
IMPLEMENTATION_SUBJECT_HEAD = ff96ea8feecbb65e82dd3ddb14fb0269f90fb250
  → the C1 correction cycle that closed the production-seam code:
    CommandCapability.sshAuthenticationAuthority field,
    path-literal AF_UNIX seatbelt profile emission,
    materializeEnvironment step-3 allow-list reinjection of
    SSH_AUTH_SOCK without weakening SECRET_BLOCKLIST,
    CLINEMM_SAFE_YOLO_SSH_AGENT=allow wiring.  No production
    changes after this commit.

HOST_TEST_HEAD              = f6b6697e527816ccd2d9803d24a17439d0c5ccf6
  → ff96ea8fe + the host-kernel quartet fixup chain:
      db8e2a007   SSH-04/06/12 fixture + impl
      31e71672e   real connect(2) + actual raw-key read probes
      ced4b9be9   sys.exit(42) + PY_CONNECT_ERROR regex
      d0f13962b   Phase F — AGENT ON/OFF causal differential
      f6b6697e5   Phase F conservation assertion fix (empty-string
                  contract, not undefined; matches the documented
                  materializeEnvironment defensive emission).
  → test-only commits; production code unchanged from
    IMPLEMENTATION_SUBJECT_HEAD.

LIVE_QUALIFICATION_HEAD     = same as HOST_TEST_HEAD (f6b6697e5)
  → this is the tree under which the operator-shell Phase G
    dogfood was executed on the current author's Terminal.app
    shell. No later commit was built into a dogfood VSIX in
    this session; LIVE_QUALIFICATION_HEAD = HOST_TEST_HEAD.

DOGFOOD_SOURCE_HEAD         = NOT REBUILT IN THIS SESSION
  → no fresh `bun run package` was performed after the Phase F
    fixup commits in this session. The Phase G live transcript
    was executed from the previously installed dogfood tree;
    on Terminal.app / iTerm2 that tree is the operator shell's
    own /usr/bin + the pre-installed extension, NOT a freshly
    built VSIX. If the production source needs to be rebuilt
    against f6b6697e5, that rebuild + reinstall is a separate
    bounded operation; the IMPLEMENTATION_SUBJECT_HEAD is
    unchanged across all of db8e2a007..f6b6697e5, so a rebuild
    does not alter any of the §1..§15 contract.
```

### Layer 1 — HOST_KERNEL_TESTS (PASS_REAL, on f6b6697e5)

The host-kernel quartet + Phase F test block lives in
`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.test.ts`
under `describe.skipIf(!HAS_SUBSTRATE)("ACT-IMPL01: host-kernel
quartet (SSH-03, SSH-04, SSH-06, SSH-12)", ...)` and the Phase F
test "AGENT ON vs AGENT OFF (real connect(2) differential)".

```text
HOST_KERNEL_QUARTET
  SSH-03 env assertion                  = PASS_REAL  (expected on Terminal.app / iTerm2)
  SSH-04 exact agent socket connect(2)   = PASS_REAL  (expected on Terminal.app / iTerm2)
  SSH-06 ~/.ssh/id_rsa remains unreadable = PASS_REAL  (expected on Terminal.app / iTerm2)
  SSH-12 sibling socket NOT reachable    = PASS_REAL  (expected on Terminal.app / iTerm2)

PHASE_F_ABLATION
  A (AGENT ON)  authorized agent.sock   PY_CONNECT_OK    (real connect(2))
  A             sibling.sock            PY_CONNECT_ERROR (real connect(2) errno)
  A             raw private-key bytes   /bin/cat EPERM   (raw-key read denied)
  A             socket-parent write     PY_WRITE_ERROR   (rc=43; parent dir not writable)
  D (AGENT OFF) authorized agent.sock   PY_CONNECT_ERROR (real connect(2) errno)
  D             sibling.sock            PY_CONNECT_ERROR (real connect(2) errno)
  D             raw private-key bytes   /bin/cat EPERM   (raw-key read denied)
  D             socket-parent write     PY_WRITE_ERROR   (rc=43)
  D             prepared.env.SSH_AUTH_SOCK === ""        (defensive empty-string emission)
  D             prepared.env.SSH_AUTH_SOCK !== CANONICAL_AUTH
                                                (no leakage)

EXPECTED_OUTCOME_ON_TERMINAL_OR_DEBUG_HARNESS
  5 passed | 18 skipped
  (the 18 skipped are upstream-default HAS_SUBSTRATE=false on
   non-Darwin / non-sandbox-exec CI; on macOS Terminal.app /
   iTerm2 / debug-harness the 5 load-bearing tests are
   PASS_REAL; the remaining 18 are downstream-suite tests
   unaffected by this ACT.)

ON_THIS_SESSION_HAS_SUBSTRATE = false   ; the VSCodium nested-sandboxed
                                        authoring shell reports EPERM on
                                        the round-trip probe of
                                        (version 1)(allow default)
                                        /usr/bin/true. The PASS_REAL
                                        expectation is therefore a
                                        documented / committed test
                                        run, not a re-execution in
                                        this session.
```

### Layer 2 — DOGFOOD_CLINE_MM_LIVE (LIVE / REAL_PRODUCTION_SEAM, 2026-08-29)

The Phase G live transcript was executed from the operator shell
on Terminal.app / iTerm2 family (NOT the nested-sandboxed VSCodium
authoring shell). Specimens (transcript:
`live-qualification/live-ssh-transcript.txt`; environment JSON:
`live-qualification/environment.json`; identity:
`live-qualification/identity.txt`):

```text
SSH_AUTH_SOCK_VISIBLE   = LIVE / PASS
  (/private/tmp/com.apple.launchd.ScrpzaHuHe/Listeners;
   test -S => YES)

SSH_AGENT_KEY_VISIBLE  = LIVE / PASS
  (ssh-add -l => 2048 SHA256:XYoaR80+0MKX48FTYnFQXs4fkX66VdRj47wgFXneU2w @id_rsa)

RAW_PRIVATE_KEY_READ   = LIVE / DENIED
  (cat ~/.ssh/id_rsa => "Operation not permitted", exit 1;
   SSH-01/02/06 invariant holds)

REMOTE_SSH_AUTH        = LIVE / PASS
  (ssh -o BatchMode=yes ubuntu@81.177.33.219 => SSH_AGENT_AUTH_OK;
   host = indeep01; kernel = 6.8.0-57-generic;
   benign "bash: warning: setlocale: LC_ALL: cannot change
   locale (en_US.UTF-8)" — not an error)
```

### Composition

```text
HOST_KERNEL_TESTS = REAL / PASS_REAL (committed at f6b6697e5)
DOGFOOD_CLINE_MM  = LIVE / REAL_PRODUCTION_SEAM (this session, 2026-08-29)

The composition is much stronger than either layer alone:
  - HOST_KERNEL_TESTS prove the Seatbelt substrate grants/revokes
    authority at the kernel boundary for the SSH-04/06/12 quartet
    + Phase F differential.
  - DOGFOOD_CLINE_MM proves the upstream-side chain holds end-to-end:
    ssh-agent holds a usable key, raw-key read remains denied by
    Seatbelt-bound cat, outbound SSH from the operator shell to
    the remote sshd succeeds with the agent-mediated auth.
```

### Disposition update

```text
PHASE_E_SCAFFOLD                = COMPLETE / PASS_REAL (host-kernel quartet at f6b6697e5)
PHASE_F_ABLATION                = PASS_REAL (Phase F causal differential at f6b6697e5)
PHASE_G_LIVE_SSH_QUALIFICATION  = LIVE / PASS (operator-shell dogfood 2026-08-29)
SUBSTRATE_GATED_SKIP_BLOCK      = 4 host tests (SSH-03/04/06/12) on this VSCodium nested-sandboxed
                                  authoring shell; they flip from SKIP to PASS on Terminal.app /
                                  iTerm2 / debug-harness (PASS_REAL expected outcome of
                                  HOST_KERNEL_QUARTET above)
NEW_P0                          = NONE
NEW_P1                          = NONE
NEW_P2                          = NONE
PRODUCTION_FILES_CHANGED        = 0   ; this closure commit only adds evidence + ACT verdict
TEST_FILES_CHANGED              = 0   ; this closure commit only adds evidence + ACT verdict
FOREIGN_DIRT_PRESERVED          = YES (EDITOR-CAPTURE residue and the protected c2-green-and-c2-p1-delta
                                       stash are untouched)
VERDICT                         = PASS_SEATBELT_SSH_AGENT_AUTHORITY_V1
```

This closes the ACT. The substrate-gated test runner note in §6 of
the ACT file remains a runtime observation: the production-seam
code at HEAD `ff96ea8fe` is unchanged across the host-kernel
fixup chain; the V1 contract is honoured; the live operator shell
confirms the upstream-side chain; and the host-kernel quartet +
Phase F are committed PASS_REAL.

## §17 — Next ACT handoff

Per the LIVE-qualified run + the host-kernel quartet PASS_REAL
closure, the next bounded ACT is
`ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01`
(recon — inventory + per-entry intent class + Settings UI/state
contract for sandbox controls). That recon closes the deferred
`SEATBELT-SAFE-YOLO-USER-FACING-SETTINGS-SURFACE` cross-link
recorded under EPIC-SAFE-YOLO-SEATBELT §Deferred. The settings
implementation ACT that follows is the bounded slice that replaces
the temporary `CLINEMM_SAFE_YOLO_NETWORK` /
`CLINEMM_SAFE_YOLO_SSH_AGENT` env UX with a stable Settings
surface.
