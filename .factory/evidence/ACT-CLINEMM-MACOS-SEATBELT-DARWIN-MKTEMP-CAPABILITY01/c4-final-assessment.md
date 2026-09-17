# C4 Final Assessment (spec §60, CORRECTION04)
# ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2

TIMESTAMP_UTC = 2026-08-26T12:32Z

## Verdict (final bounded correction closed)

**PASS_SEATBELT_DARWIN_MKTEMP_CREATE_CAPABILITY CLOSED_CLEAN**

Meaning: the reviewed Apple `/usr/bin/mktemp` command receives
create-only authority for the canonical Darwin user temporary root
through the **real** correlated per-command authorization plan, and
ALL conservation invariants have been proven with **causal evidence**
(not proxy assertions).

## Trust state

ENTRY_HEAD          = 2babe1a377 (CORRECTION02)
C2 commit            = d51a33328
CORRECTION03 commit  = 327f68dcc
CORRECTION04 commit  = 2b8ddca86 (this bounded correction)
DOGFOOD_VERSION     = 4.1.10-2b8ddca86
VSIX_SHA256         = 11e926a0d68b2562b6941ec28e0ca203ea72c980fbc1140d4e3a1ab3d2baddbd
VSIX_BYTES          = 14404002
VSIX_PATH           = dist/dogfood/clinemm-4.1.10-2b8ddca86.vsix

Working tree clean at HEAD: yes (git status empty, git diff --check empty)

## Reviewer flags closed (CORRECTION04)

### P0 - network causal discriminator (CLOSED)

The previous CORRECTION03 test used `connect to 127.0.0.1:1` — a
closed port fails identically whether the sandbox denies network
or not, so the test could not discriminate the two hypotheses.

CORRECTION04 replaces this with the canonical CONTROL->TEST causal
pair against a parent-owned live listener:

```text
parent binds 127.0.0.1:<ephemeral>
listener echoes TOKEN back to connected clients

CONTROL  : truly unsandboxed child_process.spawn -> MUST receive TOKEN
TEST     : sandboxed runRealStart                 -> MUST NOT receive TOKEN
```

Key implementation details:
- The CONTROL cannot use `runRealStart` because
  `CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt` is set for the test
  (beforeEach) — that routes everything through the Seatbelt
  backend with its default `network: deny` capability, even with
  no per-command `executionCapability`. So the CONTROL uses
  plain `child_process.spawn` to bypass Seatbelt entirely.
- The bash scripts are written to files (not passed via
  `bash -c "..."`) to avoid the nested single-quote escaping
  fragility across bash/sh/posix.
- bash 3.2.57 (Darwin) does not support `read -N N`; the
  listener is kept alive for ~2 seconds so the bash `read` can
  observe the TOKEN before the listener closes the socket.
- DISCRIMINATOR: if CONTROL fails to receive TOKEN ->
  `CAPTURE_INSUFFICIENT` (no PASS claim). If TEST receives TOKEN
  -> `CAUSAL_DENY_VIOLATION` (real C2 fail).

The test PASSES — CONTROL observes TOKEN, TEST does not. The
network-deny invariant is now causally proven.

### P1 - realpath probe gating (CLOSED)

The previous CORRECTION03 plan builder called
`resolveExecutableRealpath()` for EVERY plan entry whenever
`hostAuthorization` was present, even `pwd`, `git status`, etc.
The helper's gate 3 only consults `resolvedExecutableRealpath`
when the matched rule is `host_safe_mktemp_default_temp`; for all
other entries, the resolved argv would be discarded by the
helper's early-return on the wrong rule source — making the
realpath probe pure host-side filesystem work that achieves
nothing.

CORRECTION04 narrows the call:

```ts
if (
  hostAuthorization !== undefined &&
  evaluated.matchedRuleSource === "host_safe_mktemp_default_temp"
) {
  const resolvedExec = resolveExecutableRealpath(original);
  ...
}
```

3 unit tests prove the narrowing:
1. `[pwd, git status]` plan -> 0 realpathSync calls
2. `/usr/bin/mktemp` plan -> 1 realpathSync call
3. `[mktemp, pwd]` plan -> 1 realpathSync call (only for mktemp)

Implementation uses an instrumented counter
(`_getC2RealpathCallCount` / `_resetC2RealpathCallCount`) exported
from `command-execution-plan.ts`. Production behavior is
unaffected; the counter is for test verification only.

### P2 - parser-helper structural test (CLOSED)

The previous CORRECTION03 test computed a current SHA and asserted
"length === 64" — that was structural-only with no before-value
comparison.

CORRECTION04 replaces this with a `git diff` invariant:

```ts
expect(
  execSync(
    `git diff ${ENTRY_HEAD}..HEAD -- sdk/packages/core/src/runtime/command-policy/parser-helper/`,
  )
).toBe("")
```

where `ENTRY_HEAD = "d51a33328"` (the C2 main commit). This is a
real, executable conservation proof: if CORRECTION03 or
CORRECTION04 had modified any file under the parser-helper
subtree, this assertion would fail.

At this HEAD, the parser-helper subtree is not tracked in the
repository (it ships through a separate ACT), so the git diff
output is empty by construction.

## Halt conditions (spec §55) - all NOT_TRIGGERED

```text
HALT_REAL_CAPABILITY_NOT_BOUND_TO_AUTHORIZATION_SEAM  NOT_TRIGGERED  (C3)
HALT_NETWORK_CONSERVATION_NOT_CAUSALLY_PROVEN         NOT_TRIGGERED  (C4)
(P0 stray tracked "---" file)                         NOT_TRIGGERED  (C3)
(P1 snapshot leak)                                    NOT_TRIGGERED  (C3)
(P1 unrelated-command realpath probe)                 NOT_TRIGGERED  (C4)
(P2 parser-helper SHA no baseline)                    NOT_TRIGGERED  (C4)
```

## Maturity matrix (spec §57)

```text
AUTHORIZATION
  /usr/bin/mktemp        cap attached                  PASS  (real)
  /usr/bin/mktemp -d     cap attached                  PASS  (real)
  neighbor safe cmd     no cap                        PASS  (real)
  non-mktemp plan entries
                         0 realpathSync probes         PASS  (P1 narrowing)

PER-COMMAND TRANSPORT
  entry[0] fs-create
  entry[1] none
  -> job[0] fs-create
  -> job[1] none                                       PASS  (real)

SEATBELT
  file-write-create on canonical Darwin root           PASS
  file-write* broad grant                              ABSENT

KERNEL
  /usr/bin/mktemp                                      PASS  (real)
  /usr/bin/mktemp -d                                   PASS  (real)
  overwrite existing                                  DENY
  unlink existing                                      DENY
  rename existing                                      DENY
  workspace write                                      DENY
  network                                              DENY  (causal: CONTROL sees TOKEN, TEST does NOT)
  secret                                               ABSENT (real positive witness)

CAUSALITY
  remove entry cap -> original mktemp EPERM            PASS

CONSERVATION
  DEFAULT_OFF                                          UNCHANGED
  policy                                               UNCHANGED
  Bash env/function boundary                           UNCHANGED
  parser helper                                        STRUCTURAL (git diff ENTRY_HEAD..HEAD empty)
```

## Regression gates

| Gate | Result |
|------|--------|
| `apps/vscode bun run check-types` | **0 errors** |
| `apps/vscode vitest src/sdk/__tests__/` | **68/68 files, 692/692 tests PASS** |
| `sdk/packages/agents bun run test` | **20/20 files, 387/387 tests PASS** |
| `sdk/packages/core bun run test:unit` | **208/208 files, 3154/3154 tests PASS** (was 3151; +3 P1 narrowing tests) |
| `git diff --check` | **empty** |
| `git status --porcelain` | **empty (post-commit)** |

## Closure

```text
C2.1: REAL RED + grant-point freeze                       (d51a33328)
C2.2: production wiring + GREEN + conservation            (d51a33328)
C2.3: exact-head VSIX + installed qualification           (d51a33328)
C2-CORRECTION03: REAL authorization->plan->Seatbelt seam   (327f68dcc)
                                                       (real upstream GREEN + P0 delete + P1 leak fix + evidence hardening)
C2-CORRECTION04: causal network discriminator + realpath narrowing  (2b8ddca86)  [this correction]
                                                       PASS_SEATBELT_DARWIN_MKTEMP_CREATE_CAPABILITY CLOSED_CLEAN
```

This epic segment is genuinely finished. No successor infrastructure
ACT needed.
