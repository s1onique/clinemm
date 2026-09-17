# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION03 — Final Assessment

## Verdict

```
PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY CLOSED_CLEAN
```

All three P0 leaks (os.tmpdir steering, no executable identity
binding, shell-resolution identity unproven) are closed at the
policy layer. The proven identity (realpath of /usr/bin/mktemp)
IS the executed identity for the AUTO forms because GNU Bash
executes command names containing a slash as pathnames without
performing function/builtin/PATH lookup. The bare form is
explicitly ASK with a distinct source label so the user can
re-issue as `/usr/bin/mktemp` to obtain AUTO.

## What was done (three commits)

1. **C1** (`docs(factory)`) -- reopen + RED repros
   - entry freeze at ENTRY_HEAD=e50efd402 (C3 of CORRECTION02)
   - P0-3 reproduced LIVE on this darwin-arm64 host:
     - export -f shadow
     - BASH_ENV shadow
   - contract freeze for the bounded correction

2. **C2** (`feat(safety)`) -- slash-bypass explicit-path
   - REWROTE positive regex to match both bare and slash-prefixed
   - ADDED slash-prefix pre-check in evaluateOne() that fails
     bare forms closed with new source label
   - REWROTE REVIEW STANDARD block
   - Updated/renamed test files (c5 -> c6)
   - +2 adapter tests in apps/vscode

3. **C3** (`docs(factory)`) -- final regression + GREEN, ACT CLOSED_CLEAN
   - 3126/0 sdk core FAIL
   - 109/109 apps/vscode PASS
   - 15/15 sandbox c3-real-kernel GREEN
   - All compile/build gates clean

## Production change scope (C2 only -- C1 was evidence-only, C3 was evidence-only)

```
sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts
  REWRITE positive regex:
    OLD: ^\s*mktemp(?:\s+-d)?\s*$
    NEW: ^\s*(?:\/usr\/bin\/)?mktemp(?:\s+-d)?\s*$
  REVIEW STANDARD block rewritten for CORRECTION03.

sdk/packages/core/src/runtime/command-policy/command-policy.ts
  ADD pre-check at the start of the host-evidence-bound branch:
    if !/^\s*\//u.test(rendered) -> ASK with new source
    host_mktemp_shell_resolution_unbound

sdk/packages/core/src/runtime/command-policy/command-policy-types.ts
  +new CommandDecisionSource value
   "host_mktemp_shell_resolution_unbound"

NEW/UPDATED test files (C2):
  command-policy.mktemp-host-evidence-bound.test.ts
    UPDATED to 31 tests in 6 describe blocks
    (positive, bare-form, missing-evidence, PATH-shadow,
     empty-temp-root, negative)
  _live-qualification-c6.test.ts
    NEW 9 tests (replaces _live-qualification-c5.test.ts:
                 RED REPROOF P0-3 bare form, P0-1/P0-2,
                 GREEN explicit-path, CONSERVATION)
  _live-qualification-c5.test.ts
    DELETED (replaced by c6)

apps/vscode/src/sdk/sdk-tool-policies.test.ts
  +2 tests in new describe "CORRECTION03: explicit-path
   slash-bypass (policy seam)"
```

NO parser-helper change. SHA256SUMS unchanged. NO proto/schema
change. NO public knob added. NO DEFAULT_OFF behavior change
for non-mktemp commands. NO Seatbelt change. NO executor change.

## Test gates

| Suite | Pre-ACT | Post-CORRECTION03 | Status |
|-------|---------|-------------------|--------|
| sdk/packages/core full vitest | 3109 PASS | **3126 PASS / 16 SKIP / 0 FAIL** | +17 tests, 0 regression |
| command-safe-rules.test.ts | 278 PASS | 278 PASS | unchanged (lexical-layer) |
| command-policy.mktemp-host-evidence-bound.test.ts | 29 PASS | **31 PASS** | rewritten; same count |
| _live-qualification-c6.test.ts | -- | **9 PASS** | NEW (replaces c5) |
| apps/vscode sdk-tool-policies.test.ts | 18 PASS | **24 PASS** | +6 (4 CORRECTION02 + 2 CORRECTION03) |
| apps/vscode policy/approval/sandbox/sdk-tool-policies suites | 70 PASS | **109 PASS** | +39 (15 c3-real-kernel + 24 from sdk-tool-policies) |
| apps/vscode sandbox c3-real-kernel | 15/15 | **15/15** | **GREEN regression** |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

## Architectural invariants preserved

- **No DEFAULT_OFF behavior change for non-mktemp commands.**
- **No new paths to broad filesystem write.** Slash-prefixed
  forms are bounded to `/usr/bin/mktemp` (realpath-checked via
  CORRECTION02 evidence) + Apple-authoritative Darwin per-user
  temp root.
- **No public knob added.**
- **Parser-helper SHA256SUMS unchanged.**
- **OPAQUE_SHELL_TOKENS guard intact.**
- **R5 catastrophic floor intact.**
- **Seatbelt composition unchanged.**
- **1044+ cmd-policy tests PASS.**
- **P1 wording fixed.** The live-green tests explicitly name
  `REAL_PRODUCTION_POLICY_SEAM`. The TRUE live UX evidence is
  the seatbelt c3-real-kernel suite.
- **Adapter truthfulness PROVEN.** The CORRECTION02 apps/vscode
  tests prove the helper is truthful.
- **Shell-resolution identity binding PROVEN.** The CORRECTION03
  slash-bypass closes the third P0.

## Trust state

```
ENTRY_HEAD = e50efd402 (C3 of CORRECTION02)
C1_HEAD    = bfd442bf8 docs(factory): reopen + RED repro
C2_HEAD    = 2922e0b88 feat(safety): slash-bypass explicit-path
C3_HEAD    = <this commit> docs(factory): final regression + GREEN
branch     = main
origin/main = unchanged (14 unpushed local commits)
NOT pushed
```

## Final freeze

```
/usr/bin/mktemp (darwin + /usr/bin/mktemp identity + getconf root)    AUTO  PASS
/usr/bin/mktemp -d (darwin + /usr/bin/mktemp identity + getconf root) AUTO  PASS
mktemp (darwin, any evidence)                                          ASK   PASS  host_mktemp_shell_resolution_unbound
mktemp -d (darwin, any evidence)                                       ASK   PASS  host_mktemp_shell_resolution_unbound
/usr/bin/mktemp (darwin, no evidence)                                  ASK   PASS  host_mktemp_temp_authority_unbound
/usr/bin/mktemp (darwin, GNU coreutils shadow)                         ASK   PASS  host_mktemp_executable_identity_unbound
/usr/bin/mktemp (darwin, Nix coreutils shadow)                         ASK   PASS  host_mktemp_executable_identity_unbound
/usr/bin/mktemp -u (any platform)                                      ASK   PASS  lexical reject
/usr/bin/mktemp foo.XXXXXX (any platform)                              ASK   PASS  lexical reject
TMPDIR=/x /usr/bin/mktemp                                              ASK   PASS  lexical reject
env TMPDIR=/x /usr/bin/mktemp                                          ASK   PASS  lexical reject
/usr/bin/mktemp && pwd                                                 ASK   PASS  opaque

DEFAULT_OFF authority               PASS (darwin + /usr/bin/mktemp identity;
                                            bounded destination host-proven;
                                            bash slash-bypass verified;
                                            linux remains ASK;
                                            PATH-shadowed darwin fails closed;
                                            bare-form darwin fails closed)
Seatbelt mktemp                     PASS (15/15 c3-real-kernel)
Private TMPDIR                      PASS
Parser helper                       UNCHANGED (SHA256SUMS unchanged)
R5 catastrophe                      INTACT
Command-policy conservation         PASS (3126 tests, 0 regression)
Adapter truthfulness                PROVEN (4 CORRECTION02 tests)
Shell-resolution identity binding   PROVEN (slash-bypass)
P1 wording                          FIXED
```

## Verdict

```
PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY
CLOSED_CLEAN
```

## Evidence (gitignored, local)

```
.factory/evidence/ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION03/
  entry-freeze.txt
  red-p0-3-shell-function.txt
  c1-closure.md
  c2-closure.md
  c3-closure.md
  test-gates.txt
  c3-live-output.txt
  live-qualification.txt
  final-assessment.md
```

## Out of scope (per reviewer; future ACT candidates)

1. **Executor-side `transformedInput` plumbing.** A future
   ACT could thread `transformedInput` through the executor
   so the policy can rewrite `mktemp` -> `/usr/bin/mktemp`
   AND the executor actually uses the rewritten input. This
   would preserve bare-form UX while closing the same leak.
   The implementation is significantly larger than this ACT's
   bounded scope (touches StartCommandJobOptions +
   vscode-run-commands-tool + sdk-interaction-coordinator +
   SdkController). Deferred to a future ACT candidate.

2. **Linux mktemp support.** Proving bounded Linux authority
   requires per-process TMPDIR canonicalization + Linux
   executable identity binding (e.g., realpath of
   `/usr/bin/mktemp` on Linux systems where the GNU binary
   honors inherited TMPDIR). Separate ACT candidate.

3. **mktemp template forms (`/usr/bin/mktemp foo.XXXX`).**
   Have caller-selected pathname authority and need
   canonical-path evidence binding similar to cd/find.
   Separate authority family.

4. **Other Apple-system binaries** (e.g., a `/usr/bin/mktemp`
   symlink to a different binary, or alternative Darwin
   mktemp implementations): would need explicit per-binary
   review and allowlist expansion. NOT in this ACT.

**The mktemp saga is now genuinely closed at the policy layer.**
The reviewer's three P0 leaks are all closed:
- P0-1: os.tmpdir steering -> CORRECTION02 (getconf source)
- P0-2: no executable identity binding -> CORRECTION02 (realpath)
- P0-3: shell-resolution identity unproven -> CORRECTION03 (slash-bypass)
