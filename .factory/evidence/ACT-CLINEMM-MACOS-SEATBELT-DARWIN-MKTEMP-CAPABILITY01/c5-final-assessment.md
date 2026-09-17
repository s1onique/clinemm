# C5 Final Assessment (spec §60, CORRECTION05)
# ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2

TIMESTAMP_UTC = 2026-08-26T12:45Z

## Verdict (final bounded correction closed)

**PASS_SEATBELT_DARWIN_MKTEMP_CREATE_CAPABILITY CLOSED_CLEAN**

## Reviewer flags closed (CORRECTION05)

### P0 - TEST positive network-denial witness (CLOSED)

CORRECTION04 had a false-pass hazard: the brace-group script
{
  exec 3<>/dev/tcp/...
  read -t 3 line <&3
  printf "%s" "$line" > probe
  printf connected >> probe
} || printf denied > probe

with the assertion `not.toContain(TOKEN)` could pass with
"connected" (no TOKEN, because read returned empty when the
redirection failed) or with `<missing>` (any unrelated failure).

CORRECTION05 makes the discriminator EXACT:

```bash
if exec 3<>/dev/tcp/127.0.0.1/$PORT; then
    IFS= read -r -t 3 line <&3 || line=""
    printf "CONNECTED:%s\n" "$line"
    exec 3<&-
else
    printf "DENIED\n"
fi
```

The bash `if` branches on the EXACT exit status of the
redirection, not the brace-group's outer scope. The listener
sends `TOKEN\n` so the CONTROL can read a clean one-line
payload.

Discriminator matrix:

```text
CONTROL, Seatbelt OFF:
  stdout === "CONNECTED:${TOKEN}\n"  AND exit === 0
  any other outcome -> CAPTURE_INSUFFICIENT (NOT PASS)

TEST, Seatbelt ON:
  stdout === "DENIED\n"  AND exit === 0
  any other outcome -> NETWORK_DENY_VIOLATION (real C2 fail)
```

The test PASSES with the exact-match discriminator on both legs.
The network-deny invariant is now CAUSALLY proven with positive
witnesses (CONNECTED on the CONTROL side; DENIED on the TEST
side) and the false-pass hazard is structurally impossible
(partial-success outcomes fall into CAPTURE_INSUFFICIENT or
NETWORK_DENY_VIOLATION, both of which fail the test).

### P1 - production global counter (CLOSED)

The CORRECTION04 instrumentation module (`__c2RealpathCallCount`,
`_getC2RealpathCallCount`, `_resetC2RealpathCallCount`) violated
Factory discipline (no permanent test-only production machinery).
CORRECTION05 DELETED those exports entirely from
`sdk/packages/core/src/runtime/command-policy/command-execution-plan.ts`.
Production source is CLEAN (grep -n 'Counter\|__c2\|c2Realpath\|_getC2\|_resetC2'
returns empty).

The test file now observes `realpathSync` via a module-level
`vi.mock("node:fs")` with `vi.importActual`:

```ts
vi.mock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
    return {
        ...actual,
        realpathSync: vi.fn((...args) => actual.realpathSync(...args)),
    }
})

import { realpathSync as realpathSyncMocked } from "node:fs"
```

The vi.fn reference is module-local to the test file. The
required behavioral matrix is unchanged:

```text
[pwd, git status]    -> 0 resolver calls
[/usr/bin/mktemp]    -> 1
[mktemp, pwd]        -> 1
```

### P2 - duplicate CONTROL check (CLOSED)

CORRECTION04 had two consecutive `if (!controlObserved.includes(TOKEN))`
checks (lines 354-364). CORRECTION05's rewrite consolidated them
into a single exact-match throw.

### P2 - parser-helper SHA anchor (NON-BLOCKING)

`ENTRY_HEAD = "d51a33328"` remains hard-coded in the unit test.
Reviewer flagged this as non-blocking P2. No further action.

## Halt conditions (spec §55) - all NOT_TRIGGERED

```text
HALT_REAL_CAPABILITY_NOT_BOUND_TO_AUTHORIZATION_SEAM  NOT_TRIGGERED  (C3)
HALT_NETWORK_TEST_FALSE_PASS                          NOT_TRIGGERED  (C5)
HALT_NETWORK_CONSERVATION_NOT_CAUSALLY_PROVEN         NOT_TRIGGERED  (C4)
HALT_PRODUCTION_GLOBAL_TEST_MACHINERY                 NOT_TRIGGERED  (C5)
HALT_DUPLICATE_TEST_BRANCH                            NOT_TRIGGERED  (C5)
```

## Maturity matrix (spec §57) - updated

```text
AUTHORIZATION
  /usr/bin/mktemp        cap attached                  PASS  (real)
  /usr/bin/mktemp -d     cap attached                  PASS  (real)
  neighbor safe cmd     no cap                        PASS  (real)
  non-mktemp plan entries  0 realpath probes           PASS  (vi.mock("node:fs"))
  production source CLEAN (no test-only globals)      PASS

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
  overwrite existing                                   DENY
  unlink existing                                      DENY
  rename existing                                      DENY
  workspace write                                      DENY
  network                                              DENY  (EXACT-stdout:
                                                           CONTROL prints
                                                           CONNECTED:$TOKEN,
                                                           TEST prints DENIED)
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
| `sdk/packages/core bun run test:unit` | **208/208 files, 3154/3154 tests PASS** |
| `git diff --check` | **empty** |
| `git status --porcelain` | **empty (post-commit)** |
| production source cleanup (no test-only globals) | **CLEAN** (`grep -n 'Counter\\|__c2\\|c2Realpath' command-execution-plan.ts` empty) |

## Closure

```text
C2.1: REAL RED + grant-point freeze                                (d51a33328)
C2.2: production wiring + GREEN + conservation                     (d51a33328)
C2.3: exact-head VSIX + installed qualification                    (d51a33328)
C2-CORRECTION03: REAL authorization->plan->Seatbelt seam            (327f68dcc)
C2-CORRECTION04: live-listener CONTROL + realpath narrowing         (2b8ddca86)
                                                                  (P0 false-pass hazard remained)
C2-CORRECTION05: exact-stdout discriminator + drop production counter (d1fb24d95)  [this]
                                                                   PASS_SEATBELT_DARWIN_MKTEMP_CREATE_CAPABILITY
                                                                   CLOSED_CLEAN
```

This epic segment is genuinely finished. No successor infrastructure
ACT needed.
