# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION03 — C3 Closure

## Verdict

```
PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY CLOSED_CLEAN
```

All three P0 leaks (os.tmpdir steering, no executable identity
binding, shell-resolution identity unproven) are closed at the
policy layer. The proven identity (realpath of /usr/bin/mktemp)
IS the executed identity for the AUTO forms because GNU Bash
executes command names containing a slash as pathnames without
performing function/builtin/PATH lookup.

## Test gates (C3)

| Suite | Pre-CORRECTION03 | Post-CORRECTION03 | Status |
|-------|------------------|-------------------|--------|
| sdk/packages/core full vitest | 3124 PASS | **3126 PASS / 16 SKIP / 0 FAIL** | +2 tests |
| command-safe-rules.test.ts | 278 PASS | 278 PASS | unchanged (lexical-layer) |
| command-policy.mktemp-host-evidence-bound.test.ts | 31 PASS | **31 PASS** | rewritten; same count |
| _live-qualification-c6.test.ts | -- | **9 PASS** | NEW (replaces c5) |
| apps/vscode sdk-tool-policies.test.ts | 22 PASS | **24 PASS** | +2 (slash-bypass) |
| apps/vscode policy/approval/sandbox/sdk-tool-policies suites | 85 PASS | **85 PASS** (109 total combined) | unchanged; c3-real-kernel GREEN |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

107→109 apps/vscode policy/approval/sandbox/sdk-tool-policies PASS.

## End-to-end UX closure (LIVE)

```
darwin host, default PATH, /usr/bin/mktemp identity:
  user: /usr/bin/mktemp
    -> adapter returns valid evidence (realpath = /usr/bin/mktemp,
                                          darwinUserTempRoot from getconf)
    -> policy gate: rendered command starts with `/`
    -> CORRECTION02 evidence gate: platform darwin, identity /usr/bin/mktemp,
                                   root non-empty
    -> ALLOW with matchedRuleSource = host_safe_mktemp_default_temp
    -> Seatbelt composition runs /usr/bin/mktemp under private TMPDIR
    -> exit 0, path inside canonical TMPDIR

darwin host, default PATH, /usr/bin/mktemp -d identity:
  user: /usr/bin/mktemp -d
    -> same as above
    -> ALLOW

darwin host, default PATH, bare mktemp identity:
  user: mktemp
    -> adapter returns valid evidence
    -> policy gate: rendered command does NOT start with `/`
    -> ASK with host_mktemp_shell_resolution_unbound
    -> approval card shown (the user can re-issue as /usr/bin/mktemp
       to obtain AUTO)

darwin host, PATH-shadowed mktemp (e.g. Nix coreutils):
  user: /usr/bin/mktemp
    -> adapter returns undefined (realpath != /usr/bin/mktemp)
    -> policy gate: rendered command starts with `/`
    -> CORRECTION02 evidence gate: identity realpath mismatch
    -> ASK with host_mktemp_executable_identity_unbound

darwin host, with `export -f mktemp` shadow:
  user: /usr/bin/mktemp
    -> adapter returns valid evidence
    -> policy gate: rendered command starts with `/`
    -> CORRECTION02 evidence gate: identity matches
    -> ALLOW
    -> executor: bash -c "/usr/bin/mktemp" -> slash bypasses function
                                              lookup -> BSD mktemp runs
    -> SAFE (no leak)

darwin host, with `export -f mktemp` shadow + bare mktemp:
  user: mktemp
    -> adapter returns valid evidence
    -> policy gate: rendered command does NOT start with `/`
    -> ASK with host_mktemp_shell_resolution_unbound
    -> approval card shown
    -> user explicitly approves knowing function could intercept

darwin host, TMPDIR steered externally:
  user: /usr/bin/mktemp
    -> adapter uses /usr/bin/getconf (NOT os.tmpdir())
    -> getconf returns true Darwin per-user temp root
    -> policy gate: rendered command starts with `/`
    -> CORRECTION02 evidence gate: platform darwin, identity matches,
                                   root from getconf
    -> ALLOW
```

The P0-3 leak is closed at the policy layer: the slash-prefixed
AUTO forms bypass function/builtin/PATH lookup entirely, so the
proven identity IS the executed identity. Bare forms fail closed
to ASK with a distinct source label so the user knows WHY
auto-approve did not fire.

## Architectural invariants preserved

- **No DEFAULT_OFF behavior change for non-mktemp commands.**
- **No new paths to broad filesystem write.** Slash-prefixed
  forms are bounded to `/usr/bin/mktemp` (realpath-checked via
  CORRECTION02 evidence) + Apple-authoritative Darwin per-user
  temp root.
- **No public knob added.**
- **No proto / schema change.**
- **Parser-helper SHA256SUMS unchanged.**
- **OPAQUE_SHELL_TOKENS guard intact.**
- **R5 catastrophic floor intact.**
- **Seatbelt composition unchanged.**
- **CORRECTION02 host-evidence-bound gate preserved** (darwin +
  /usr/bin/mktemp identity + getconf root requirement).
- **1044+ cmd-policy tests PASS.** No regression in any other
  safe rule.

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

## Out of scope (per reviewer)

- **Executor-side `transformedInput` plumbing.** A future ACT
  could thread `transformedInput` through the executor (so the
  policy can rewrite `mktemp` -> `/usr/bin/mktemp` and the
  executor actually uses the rewritten input). This would
  preserve bare-form UX while closing the same leak. The
  implementation is significantly larger than this ACT's
  bounded scope (touches StartCommandJobOptions +
  vscode-run-commands-tool + sdk-interaction-coordinator +
  SdkController). Deferred to a future ACT candidate.

- **Linux mktemp support.** Proving bounded Linux authority
  requires per-process TMPDIR canonicalization + Linux
  executable identity binding (e.g., realpath of
  `/usr/bin/mktemp` on Linux systems where the GNU binary
  honors inherited TMPDIR). Separate ACT candidate.

- **mktemp template forms (`/usr/bin/mktemp foo.XXXX`).**
  Have caller-selected pathname authority and need canonical-
  path evidence binding similar to cd/find. Separate authority
  family.

- **Other Apple-system binaries** (e.g., a `/usr/bin/mktemp`
  symlink to a different binary, or alternative Darwin mktemp
  implementations): would need explicit per-binary review and
  allowlist expansion. NOT in this ACT.

**This CORRECTION03 ACT is closed. The mktemp saga is now
genuinely closed at the policy layer:**
- proven identity = executed identity (slash bypass)
- bounded destination (getconf, realpath-bound)
- executable identity bound to /usr/bin/mktemp (realpath)
- no public knob added
- no proto/schema/parser-helper change
- no Seatbelt change
- adapter proven truthful
- all existing tests still pass
