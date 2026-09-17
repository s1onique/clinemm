# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION02 — Final Assessment

## Verdict

```
PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY CLOSED_CLEAN
```

The cross-platform authority leak AND the executable-identity
mismatch are both closed. The host adapter is proven truthful
by the new apps/vscode tests. The end-to-end UX closure is
preserved on default macOS hosts and fails closed on
PATH-shadowed installations.

## What was done (three commits)

1. **C1** (`docs(factory)`) -- reopen + RED repros
   - entry freeze at ENTRY_HEAD=6d8acd676 (C3 of CORRECTION01)
   - BOTH P0s reproduced LIVE on this darwin-arm64 host:
     P0-1 (os.tmpdir honors TMPDIR/TMP/TEMP, getconf independent)
     P0-2 (which mktemp -> GNU coreutils on this Nix host)
   - contract freeze for the bounded correction

2. **C2** (`feat(safety)`) -- strict-identity-bound rule
   - REWROTE TempAuthorityEvidence to 5 fields
   - REWROTE policy gate to require executableRealpath ===
     /usr/bin/mktemp AND non-empty getconf-sourced temp root
   - REWROTE REVIEW STANDARD block
   - REWROTE host adapter to use subprocess (which + getconf)
   - Added 4 adapter-authenticity tests in apps/vscode
   - Updated/renamed test files (c4 -> c5)

3. **C3** (`docs(factory)`) -- final regression + GREEN, ACT CLOSED_CLEAN
   - 107/107 apps/vscode PASS
   - 3124/0 sdk core FAIL
   - 15/15 sandbox c3-real-kernel GREEN
   - All compile/build gates clean

## Production change scope (C2)

```
sdk/packages/core/src/runtime/command-policy/command-policy-types.ts
  REWRITE TempAuthorityEvidence interface:
    OLD: { platform: "darwin"|"linux"|"win32"|"unknown",
           effectiveDefaultTempRoot: string,
           canonicalDefaultTempRoot: string }
    NEW: { platform: "darwin",
           executablePath: string,
           executableRealpath: string,
           darwinUserTempRoot: string,
           canonicalDarwinUserTempRoot: string }
  +new CommandDecisionSource value
   "host_mktemp_executable_identity_unbound"

sdk/packages/core/src/runtime/command-policy/command-policy.ts
  REWRITE host-evidence-bound branch in evaluateOne():
    - executableRealpath === /usr/bin/mktemp (strict identity)
    - darwinUserTempRoot + canonicalDarwinUserTempRoot non-empty
    - any failure -> ASK with appropriate new source label

sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts
  REVIEW STANDARD block rewritten -- documents strict-identity
  bound + true-Darwin-root requirement

apps/vscode/src/sdk/sdk-tool-policies.ts
  REPLACE buildTempAuthorityEvidence() with subprocess-based helper:
    - /usr/bin/which mktemp           -> executablePath
    - realpathSync(executablePath)    -> executableRealpath
      STRICT GATE: must equal /usr/bin/mktemp; else undefined
    - /usr/bin/getconf DARWIN_USER_TEMP_DIR -> darwinUserTempRoot
      (Apple-authoritative; ignores inherited TMPDIR)
    - realpathSync(darwinUserTempRoot) -> canonicalDarwinUserTempRoot
  Imports: remove `import * as os from "node:os"` (os.tmpdir() removed)
           add `import * as child_process from "node:child_process"`

NEW/UPDATED test files:
  sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-host-evidence-bound.test.ts
    UPDATED to 31 tests (was 29; +2 for GNU + Nix shadow cases)
  sdk/packages/core/src/runtime/command-policy/_live-qualification-c5.test.ts
    NEW 6 tests (replaces _live-qualification-c4.test.ts)

DELETED test files:
  sdk/packages/core/src/runtime/command-policy/_live-qualification-c4.test.ts
```

NO parser-helper change. SHA256SUMS unchanged. NO proto/schema
change. NO public knob added. NO DEFAULT_OFF behavior change
for non-mktemp commands.

## Test gates

| Suite | Pre-ACT | Post-CORRECTION02 | Status |
|-------|---------|-------------------|--------|
| sdk/packages/core full vitest | 3109 PASS | **3124 PASS / 16 SKIP / 0 FAIL** | +15 tests, 0 regression |
| command-safe-rules.test.ts | 278 PASS | 278 PASS | unchanged (lexical-layer) |
| command-policy.mktemp-host-evidence-bound.test.ts | 29 PASS | **31 PASS** | +2 (GNU + Nix shadow) |
| _live-qualification-c5.test.ts | -- | **6 PASS** | NEW (replaces c4) |
| apps/vscode sdk-tool-policies.test.ts | 18 PASS | **22 PASS** | +4 (adapter-authenticity) |
| apps/vscode policy/approval/sandbox suites | 70 PASS | **85 PASS** | +15 c3-real-kernel |
| apps/vscode sandbox c3-real-kernel | 15/15 | **15/15** | **GREEN regression** |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

## Architectural invariants preserved

- **No DEFAULT_OFF behavior change for non-mktemp commands.**
- **No new paths to broad filesystem write.** Bare mktemp under
  the strict-identity gate is bounded to /usr/bin/mktemp +
  Apple-authoritative Darwin per-user temp.
- **No public knob added.**
- **Parser-helper SHA256SUMS unchanged.**
- **OPAQUE_SHELL_TOKENS guard intact.**
- **R5 catastrophic floor intact.**
- **Seatbelt composition unchanged.**
- **1044+ cmd-policy tests PASS.**
- **P1 wording fixed.** The live-green tests explicitly name
  `REAL_PRODUCTION_POLICY_SEAM`. The TRUE live UX evidence is
  the seatbelt c3-real-kernel suite.
- **Adapter truthfulness PROVEN.** The new apps/vscode tests
  directly address the reviewer's P1 concern by exercising the
  full adapter pipeline on the actual host.

## Trust state

```
ENTRY_HEAD = 6d8acd676 (C3 of CORRECTION01)
C1_HEAD    = 10493a3f6 docs(factory): reopen + RED repros
C2_HEAD    = 049a10fdd feat(safety): strict-identity-bound rule
C3_HEAD    = <this commit> docs(factory): apps/vscode adapter + GREEN
branch     = main
origin/main = unchanged (13 unpushed local commits)
NOT pushed
```

## Final freeze

```
mktemp (darwin + /usr/bin/mktemp identity + getconf root)  AUTO   PASS
mktemp -d (darwin + /usr/bin/mktemp identity + getconf root) AUTO  PASS
mktemp (darwin, no evidence)                              ASK    PASS  host_mktemp_temp_authority_unbound
mktemp (darwin, GNU coreutils shadow via PATH)            ASK    PASS  host_mktemp_executable_identity_unbound
mktemp (darwin, Nix coreutils shadow via PATH)            ASK    PASS  host_mktemp_executable_identity_unbound
mktemp (darwin, TMPDIR steered + /usr/bin/mktemp first)   AUTO   PASS  getconf wins
mktemp (linux, any evidence)                              ASK    PASS  adapter returns undefined on linux
mktemp -u (any platform, evidence)                        ASK    PASS  lexical reject
mktemp foo.XXXXXX (any platform)                          ASK    PASS  lexical reject
TMPDIR=/x mktemp                                          ASK    PASS  lexical reject
env TMPDIR=/x mktemp                                      ASK    PASS  lexical reject
mktemp && pwd                                             ASK    PASS  opaque
mktemp > /tmp/x                                           ASK    PASS  opaque

DEFAULT_OFF authority               PASS (darwin + /usr/bin/mktemp identity;
                                            bounded destination host-proven;
                                            linux remains ASK; PATH-shadowed
                                            darwin fails closed)
Seatbelt mktemp                     PASS (15/15 c3-real-kernel)
Private TMPDIR                      PASS
Parser helper                       UNCHANGED (SHA256SUMS unchanged)
R5 catastrophe                      INTACT
Command-policy conservation         PASS (3124 tests, 0 regression)
Adapter truthfulness                PROVEN (4 new apps/vscode tests)
P1 wording                          FIXED (REAL_PRODUCTION_POLICY_SEAM
                                            explicitly named in tests)
```

## Verdict

```
PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY
CLOSED_CLEAN
```

## Evidence (gitignored, local)

```
.factory/evidence/ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION02/
  entry-freeze.txt
  red-p0-1-tmpdir-steered.txt
  red-p0-2-executable-identity.txt
  c1-closure.md
  c2-closure.md
  c3-closure.md
  test-gates.txt
  c3-live-output.txt
  live-qualification.txt
  final-assessment.md
```

## Next ACT candidates (NOT in this ACT)

Per the reviewer's bounded CORRECTION02:

1. **Linux mktemp support.** Proving bounded Linux authority
   requires per-process TMPDIR canonicalization + Linux
   executable identity binding (e.g., realpath of
   `/usr/bin/mktemp` on Linux systems where the GNU binary
   honors inherited TMPDIR). Separate ACT candidate.

2. **mktemp template forms (`mktemp foo.XXXX`).** Have caller-
   selected pathname authority and need canonical-path evidence
   binding similar to cd/find. Separate authority family.

3. **Other Apple-system binaries** (e.g., a `/usr/bin/mktemp`
   symlink to a different binary, or alternative Darwin mktemp
   implementations): would need explicit per-binary review and
   allowlist expansion. NOT in this ACT.

The bounded bare mktemp form does NOT require any of these.
The reviewer's lean correction closes both P0s while preserving
the user-facing UX on default macOS hosts.

**This CORRECTION02 ACT is closed.**
