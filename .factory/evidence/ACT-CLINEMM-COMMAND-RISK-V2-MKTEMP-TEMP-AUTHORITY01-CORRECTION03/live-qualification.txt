# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION03 — C2 Closure

## Verdict

```
C2 = PASS

The shell-resolution identity leak is structurally closed.
The proven identity (realpath of /usr/bin/mktemp via
CORRECTION02 evidence) IS the executed identity for the
AUTO forms (slash-prefixed) because GNU Bash executes
command names containing a slash as pathnames without
performing function/builtin/PATH lookup.
```

## What changed

### 1. `sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts`

- REWRITE positive regex from
  `^\s*mktemp(?:\s+-d)?\s*$`
  to
  `^\s*(?:\/usr\/bin\/)?mktemp(?:\s+-d)?\s*$`
  (matches BOTH bare and slash-prefixed forms; the gate
  in command-policy.ts distinguishes them)
- REVIEW STANDARD block rewritten for CORRECTION03:
  - documents slash-bypass proof
  - documents shell-function/BASH_ENV shadow
  - lists new source label `host_mktemp_shell_resolution_unbound`

### 2. `sdk/packages/core/src/runtime/command-policy/command-policy.ts`

- ADD pre-check at the start of the host-evidence-bound branch:
  ```ts
  const cmdStr = renderNormalizedCommand(command)
  if (!/^\s*\//u.test(cmdStr)) {
    return {
      kind: "ask",
      source: "host_mktemp_shell_resolution_unbound",
      reason: `shell resolution unbound: rendered command ...`
    }
  }
  ```
  Bare forms (no leading slash) are ASK'd with the new
  source label. Slash-prefixed forms continue to the
  CORRECTION02 host-evidence gate.

### 3. `sdk/packages/core/src/runtime/command-policy/command-policy-types.ts`

- +new `CommandDecisionSource` value
  `host_mktemp_shell_resolution_unbound`
  so operators can see that the bare-form gate failed
  (distinct from the executable-identity and temp-authority
  gates which use different source labels).

### 4. `sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-host-evidence-bound.test.ts` (UPDATED)

Tests reorganized:
- "darwin host WITH /usr/bin/mktemp identity + true Darwin root -> AUTO
   for explicit-path positive forms" (5 forms: `/usr/bin/mktemp`,
   `/usr/bin/mktemp -d`, with whitespace variants)
- "BARE `mktemp` and `mktemp -d` -> ASK with
   host_mktemp_shell_resolution_unbound" (5 forms)
- "darwin host WITHOUT evidence -> ASK with
   host_mktemp_temp_authority_unbound" (2 forms)
- "darwin host with PATH-shadowed mktemp -> ASK with
   host_mktemp_executable_identity_unbound" (3 forms)
- "darwin host with empty temp root -> ASK with
   host_mktemp_temp_authority_unbound" (2 forms)
- "darwin host WITH evidence + negative forms -> ASK or DENY"
   (14 forms including -u/-p/-t, template operand, compose, env
   steering, dynamic operand)

### 5. `sdk/packages/core/src/runtime/command-policy/_live-qualification-c6.test.ts` (NEW, replaces c5)

9 tests:
- RED REPROOF P0-3 (bare form -> ASK with new source): 2
- RED REPROOF P0-1/P0-2 (PATH shadow / missing evidence): 2
- GREEN PROOF (slash-prefixed form -> AUTO): 2
- CONSERVATION: 3

### 6. `apps/vscode/src/sdk/sdk-tool-policies.test.ts` (UPDATED)

+2 tests in new describe `CORRECTION03: explicit-path slash-bypass
(policy seam)`:
- `/usr/bin/mktemp` + darwin identity + getconf root -> ALLOW
- bare `mktemp` + darwin identity -> ASK with
  `host_mktemp_shell_resolution_unbound`

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

## Scope discipline

- **Bare `mktemp` / `mktemp -d` ASK with new source label**
  (UX trade-off; user can re-issue as `/usr/bin/mktemp` for AUTO)
- **GNU/Linux mktemp support remains OUT OF SCOPE**
  (separate ACT candidate)
- **mktemp template forms remain ASK** (separate authority family)
- **`-u`, `-p`, `-t`, `--tmpdir` remain ASK**
- **All compose / opaque / dynamic / env / glob / brace forms
  remain ASK**
- **Out of scope: executor-side `transformedInput` plumbing**
  (a separate architectural concern; would close the gap while
  preserving bare-form UX but is significantly larger than this
  ACT's bounded scope; deferred to a future ACT)
- **Only `/usr/bin/mktemp` approved in this ACT** (other
  Apple-system binaries could be added in a future ACT after
  explicit review)

## Test gates (C2)

| Suite | Pre-CORRECTION03 | Post-CORRECTION03 | Status |
|-------|------------------|-------------------|--------|
| command-safe-rules.test.ts | 278 PASS | 278 PASS | unchanged (lexical-layer) |
| command-policy.mktemp-host-evidence-bound.test.ts | 31 PASS | **31 PASS** | rewritten; same test count |
| _live-qualification-c6.test.ts | -- | **9 PASS** | NEW (replaces c5) |
| sdk/packages/core full vitest | 3124 PASS | **3126 PASS / 16 SKIP / 0 FAIL** | +2 tests |
| apps/vscode sdk-tool-policies.test.ts | 22 PASS | **24 PASS** | +2 (slash-bypass) |
| apps/vscode policy/approval/sandbox/sdk-tool-policies suites | 85 PASS | **85 PASS** (109 total combined) | unchanged; c3-real-kernel GREEN |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

## Live RED at C2

The P0-3 leak is reproduced live at
`red-p0-3-shell-function.txt`:

```
CHANNEL 1 (export -f mktemp):
  mktemp() { printf "BAD %s\n" "${TMPDIR:-/tmp}"; }
  export -f mktemp
  bash -c "mktemp" -> BAD /synth   (function runs)
  /usr/bin/which mktemp -> /usr/bin/mktemp  (proof meaningless)

CHANNEL 2 (BASH_ENV):
  BASH_ENV=<file defining mktemp()>
  bash -c "mktemp" -> BASHENV_FUNC  (function runs)
  /usr/bin/which mktemp -> /usr/bin/mktemp  (proof meaningless)
```

Slash-bypass proof verified live at the same file:

```
bash -c "mktemp"         with export -f mktemp  -> BADFUNC
bash -c "/usr/bin/mktemp" with same export -f    -> BSD mktemp
bash -c "mktemp"         with BASH_ENV=...      -> BASHENV_FUNC
bash -c "/usr/bin/mktemp" with same BASH_ENV    -> BSD mktemp
```

The CORRECTION03 gate rejects the bare form before
the CORRECTION02 host-evidence gate fires, so the
proved-and-executed identity mismatch is closed.

## C3 plan

C3 will:
1. Run the full engineering gate suite
   (sdk core + apps/vscode policy/approval/sandbox suites +
    bun run build:sdk + apps/vscode bun run compile)
2. Run the seatbelt c3-real-kernel suite for GREEN regression
3. Write c3-closure.md + final-assessment.md evidence
4. Single C3 commit closing CORRECTION03 with
   `PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY CLOSED_CLEAN`
