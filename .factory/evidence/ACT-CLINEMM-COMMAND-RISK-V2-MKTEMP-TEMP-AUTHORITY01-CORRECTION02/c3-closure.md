# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION02 — C3 Closure

## Verdict

```
PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY CLOSED_CLEAN
```

Both P0 leaks the reviewer identified in
`HALT_MKTEMP_HOST_EVIDENCE_NOT_BOUND_TO_EXECUTION_SEMANTICS`
are closed at the production seam AND the host adapter is
proven truthful.

## What changed in C3

C3 is the final regression and closure step. The implementation
landed in C2. C3:

1. Ran the full engineering gate suite:
   - sdk/packages/core full vitest: 3124 PASS / 16 SKIP / 0 FAIL
   - apps/vscode policy/approval/sandbox/sdk-tool-policies:
     5 files, 107 tests, all PASS
   - bun run build:sdk: clean
   - apps/vscode bun run check-types: tsc --noEmit exit 0
   - apps/vscode bun run compile: biome+tsc+proto-lint exit 0
   - git diff --check: clean

2. Confirmed the Seatbelt c3-real-kernel suite (15/15 GREEN)
   remains unaffected — the sandbox side is fully orthogonal
   to the policy-side executable-identity binding.

3. Wrote the final-assessment evidence file.

## Test gates (C3)

| Suite | Pre-CORRECTION02 | Post-CORRECTION02 | Status |
|-------|------------------|-------------------|--------|
| sdk/packages/core full vitest | 3121 PASS | **3124 PASS / 16 SKIP / 0 FAIL** | +3 tests |
| command-policy.mktemp-host-evidence-bound.test.ts | 29 | **31** | +2 (GNU + Nix shadow) |
| _live-qualification-c5.test.ts | -- | **6** | NEW (replaces c4) |
| apps/vscode sdk-tool-policies.test.ts | 18 | **22** | +4 (adapter-authenticity) |
| apps/vscode policy/approval/sandbox suites | 85 | **85** | unchanged |
| apps/vscode sandbox c3-real-kernel | 15/15 | **15/15** | **GREEN regression** |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |

107/107 PASS across the apps/vscode policy/approval/sandbox/sdk-tool-policies suites.

## Adapter-authenticity proof

The new apps/vscode tests prove the ADAPTER is truthful, addressing
the reviewer's P1 concern verbatim:

> "Your current tests are good policy-seam tests, but they only
>  inject arbitrary TempAuthorityEvidence values and prove the
>  policy gate obeys those values. They do not prove the VS Code
>  adapter constructed truthful evidence."

The new tests in `apps/vscode/src/sdk/sdk-tool-policies.test.ts`:
- **non-darwin: undefined** -- platform gate enforced
- **darwin with /usr/bin first in PATH**: adapter returns evidence
  with `executableRealpath === "/usr/bin/mktemp"` AND
  `darwinUserTempRoot` matching `/(private\/)?var\/folders\//`
  (the Apple-authoritative Darwin per-user temp root pattern),
  NOT `/tmp`, NOT `/synthetic`
- **darwin with PATH-shadowed**: adapter returns undefined (the
  strict identity bound fails closed)
- **darwin with TMPDIR steered**: even when TMPDIR=/synthetic is
  set, the adapter's getconf source wins and returns the real
  Darwin per-user temp root

These tests are REAL on the actual darwin host where this work
runs (verified at the time of writing). They are not policy-seam
tests; they exercise the full adapter pipeline: subprocess +
realpathSync + the strict identity gate.

## End-to-end UX closure (LIVE, unchanged from prior CORRECTIONs)

```
interactive: mktemp  (darwin host, executeSafeCommands=true,
                       PATH-default, /usr/bin first)
  -> getCommandHostAuthorization(...) populates tempAuthorityEvidence
     via buildTempAuthorityEvidence
       /usr/bin/which mktemp          -> executablePath
       realpathSync(executablePath)   -> executableRealpath (== /usr/bin/mktemp)
       /usr/bin/getconf DARWIN_USER_TEMP_DIR -> darwinUserTempRoot
       realpathSync(darwinUserTempRoot)       -> canonicalDarwinUserTempRoot
  -> evaluateCommandPolicy(toolInput, hostAuthorization)
       match: host_safe_mktemp_default_temp
       TEMP_AUTHORITY_HOST_EVIDENCE_BOUND_SOURCES contains the rule
       gate: evidence present, platform=darwin,
             executableRealpath == /usr/bin/mktemp,
             darwinUserTempRoot non-empty,
             canonicalDarwinUserTempRoot non-empty
       -> ALLOW / auto-approve-eligible /
          matchedRuleSource=host_safe_mktemp_default_temp
  -> no approval card
  -> CommandJobManager.start
  -> SeatbeltSandboxBackendExperimental.prepare
       synthesizedTempRoot, canonical tempRoot, profile, materialize env
  -> sandbox-exec -f <profile> /usr/bin/mktemp
       exit 0

For darwin hosts where PATH is shadowed (homebrew/nix coreutils):
  -> getCommandHostAuthorization(...): adapter returns undefined
       (realpath of GNU coreutils != /usr/bin/mktemp)
  -> evaluateCommandPolicy: ASK with host_mktemp_executable_identity_unbound
  -> approval card shown
  -> user retains explicit-approval gate
```

The user-facing UX is preserved for normal macOS users AND fails
closed for PATH-shadowed installations. Both P0 leaks the reviewer
identified are closed.

## Architectural invariants preserved

- **No DEFAULT_OFF behavior change for non-mktemp commands.**
- **No new paths to broad filesystem write.** Bare mktemp under
  the strict-identity gate is bounded to /usr/bin/mktemp +
  Apple-authoritative Darwin per-user temp.
- **No public knob added.**
- **No proto / schema change.**
- **Parser-helper SHA256SUMS unchanged.**
- **OPAQUE_SHELL_TOKENS guard intact.**
- **R5 catastrophic floor intact.**
- **Seatbelt composition unchanged** (predecessor ACT's CORRECTION01
  lifecycle wrap is intact; sandbox side is fully orthogonal to
  the policy-side executable-identity binding).
- **1044+ cmd-policy tests PASS.** No regression in any other
  safe rule.
- **Adapter-truthful tests pass.** Proves the new helper sources
  evidence from subprocesses that the inherited environment cannot
  steer.

## Trust state

```
ENTRY_HEAD = 6d8acd676 (C3 of CORRECTION01)
C1_HEAD    = 10493a3f6 docs(factory): reopen + RED repros
C2_HEAD    = 049a10fdd feat(safety): strict-identity-bound rule
C3_HEAD    = <this commit> docs(factory): apps/vscode adapter + GREEN, ACT CLOSED_CLEAN
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

1. **Linux mktemp support.** Proving bounded Linux authority would
   require per-process TMPDIR canonicalization + Linux executable
   identity binding (e.g., realpath of `/usr/bin/mktemp` on Linux
   systems where the GNU binary honors inherited TMPDIR). Separate
   ACT candidate.

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
