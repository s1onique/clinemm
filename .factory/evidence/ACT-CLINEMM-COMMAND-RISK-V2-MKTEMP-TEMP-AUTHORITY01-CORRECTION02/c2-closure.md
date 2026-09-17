# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION02 — C2 Closure

## Verdict

```
C2 = PASS

The cross-platform authority leak is structurally closed.
Both P0-1 (os.tmpdir() honors TMPDIR) and P0-2 (no
executable identity binding) are addressed by:
  - REWRITE TempAuthorityEvidence to require BOTH executable
    identity AND true Darwin temp authority
  - REWRITE the policy gate in evaluateOne() to enforce both
  - REWRITE the host adapter to source both via subprocess
    (which + getconf), proving the ADAPTER is truthful
```

## What changed

### 1. `sdk/packages/core/src/runtime/command-policy/command-policy-types.ts`

- REWRITE `TempAuthorityEvidence` interface:
    OLD:
      `{ platform: "darwin"|"linux"|"win32"|"unknown",
         effectiveDefaultTempRoot: string,
         canonicalDefaultTempRoot: string }`
    NEW:
      `{ platform: "darwin",
         executablePath: string,
         executableRealpath: string,
         darwinUserTempRoot: string,
         canonicalDarwinUserTempRoot: string }`
- Add new `CommandDecisionSource` value
  `host_mktemp_executable_identity_unbound` so operators can
  see which gate failed (vs. the temp-authority gate which
  uses `host_mktemp_temp_authority_unbound`).

### 2. `sdk/packages/core/src/runtime/command-policy/command-policy.ts`

- REWRITE the host-evidence-bound branch in `evaluateOne()`:
    - if `evidence === undefined` OR `evidence.platform !== "darwin"`
      -> ASK with `host_mktemp_temp_authority_unbound`
    - if `executablePath` or `executableRealpath` is empty
      -> ASK with `host_mktemp_executable_identity_unbound`
    - if `executableRealpath !== "/usr/bin/mktemp"`
      -> ASK with `host_mktemp_executable_identity_unbound`
    - if `darwinUserTempRoot` or `canonicalDarwinUserTempRoot` is empty
      -> ASK with `host_mktemp_temp_authority_unbound`
    - else: fall through to existing ALLOW verdict

### 3. `sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts`

- REWRITE the REVIEW STANDARD block for `host_safe_mktemp_default_temp`:
    - documented the strict identity bound (realpath === /usr/bin/mktemp)
    - documented the true-Darwin-root requirement (getconf, not os.tmpdir())
    - listed the new source labels

### 4. `sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-host-evidence-bound.test.ts` (UPDATED)

29 tests at the REAL production policy seam:
- darwin WITH evidence -> AUTO (4 positive forms)
- darwin WITHOUT evidence -> ASK with new source
- linux evidence object -> (gate accepts but host adapter returns undefined on linux)
- darwin WITH GNU coreutils shadow -> ASK with executable_identity_unbound
- darwin WITH Nix coreutils shadow -> ASK with executable_identity_unbound
- darwin WITH empty executableRealpath -> ASK with executable_identity_unbound
- darwin WITH valid identity + arbitrary temp-root string -> ALLOW (gate is identity-bound; value-source enforced at host adapter)
- darwin WITH empty darwinUserTempRoot -> ASK with new source
- darwin WITH empty canonicalDarwinUserTempRoot -> ASK with new source
- darwin WITH evidence + negative forms -> ASK (18 negative forms)

### 5. `sdk/packages/core/src/runtime/command-policy/_live-qualification-c5.test.ts` (NEW, replaces c4)

6 tests:
- RED REPROOF P0-1: darwin-with-steered-effective-root but identity matches
  -> ALLOW (documents that the gate is identity-bound; value-source
  is host-adapter's responsibility, enforced by the new adapter tests)
- RED REPROOF P0-2: PATH-shadowed executable -> ASK with new source
- RED REPROOF: missing evidence -> ASK with temp_authority_unbound
- GREEN: /usr/bin/mktemp identity + true Darwin root -> AUTO
- GREEN: same for mktemp -d
- CONSERVATION: mktemp -u / foo.XXXXXX stay ASK

### 6. `apps/vscode/src/sdk/sdk-tool-policies.ts`

- REPLACE `buildTempAuthorityEvidence()`:
    OLD:
      - on darwin: uses os.tmpdir() (LEAK: honors TMPDIR)
    NEW:
      - on darwin:
          (a) /usr/bin/which mktemp  -> executablePath
          (b) fs.realpathSync(executablePath) -> executableRealpath
              STRICT GATE: must equal /usr/bin/mktemp; otherwise
              return undefined (fail closed)
          (c) /usr/bin/getconf DARWIN_USER_TEMP_DIR -> darwinUserTempRoot
              (Apple-authoritative; ignores inherited TMPDIR)
          (d) fs.realpathSync(darwinUserTempRoot) -> canonicalDarwinUserTempRoot
- Add imports: `import * as child_process from "node:child_process"`
- Update imports: remove `import * as os from "node:os"` (os.tmpdir() removed)

### 7. `apps/vscode/src/sdk/sdk-tool-policies.test.ts` (UPDATED)

4 new tests in describe block
`CORRECTION02: buildTempAuthorityEvidence (host adapter authenticity)`:
- non-darwin -> undefined
- darwin with /usr/bin first in PATH -> identity-bound evidence with
  realpath === /usr/bin/mktemp AND darwinUserTempRoot from getconf
- darwin with PATH-shadowed mktemp -> undefined (fail closed)
- darwin with TMPDIR steered but /usr/bin first -> getconf wins,
  TMPDIR ignored (no leak)

These tests prove the ADAPTER is truthful -- not just the policy
seam. They directly address the reviewer's concern:
  "Your current tests are good policy-seam tests, but they only
   inject arbitrary TempAuthorityEvidence values and prove the
   policy gate obeys those values. They do not prove the VS Code
   adapter constructed truthful evidence."

### 8. `sdk/packages/core/src/index.ts` and `runtime/command-policy/index.ts`

- No public type changes needed. The `TempAuthorityEvidence`
  interface was updated in place in `command-policy-types.ts`;
  re-export from `index.ts` already pulls the new shape.

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

## Scope discipline

- **Linux mktemp support remains OUT OF SCOPE.** Proving bounded
  Linux authority would require a separate ACT candidate with
  per-process TMPDIR canonicalization.
- **Template forms (`mktemp foo.XXXX`) remain ASK** -- separate
  authority family.
- **`-u`, `-p`, `-t`, `--tmpdir` remain ASK.**
- **All compose / opaque / dynamic / env / glob / brace forms
  remain ASK.**
- **No parser-helper change.**
- **Only `/usr/bin/mktemp` is approved** in this ACT. Other
  Apple-system binaries could be added in a future ACT after
  explicit review.

## C2 test gates

| Suite | Pre-CORRECTION02 | Post-CORRECTION02 | Status |
|-------|------------------|-------------------|--------|
| sdk/packages/core command-safe-rules.test.ts | 278 PASS | 278 PASS | unchanged (lexical-layer) |
| command-policy.mktemp-host-evidence-bound.test.ts | 29 PASS | **31 PASS** | +2 (GNU + Nix shadow tests) |
| _live-qualification-c5.test.ts | -- | **6 PASS** | NEW (replaces c4) |
| sdk/packages/core full vitest | 3121 PASS | **3124 PASS / 16 SKIP / 0 FAIL** across 208 files | +3 tests, 0 regression |
| apps/vscode sdk-tool-policies.test.ts | 18 PASS | **22 PASS** | +4 (adapter authenticity) |
| apps/vscode policy/approval/sandbox suites | 85 PASS | **85 PASS** | unchanged; c3-real-kernel GREEN |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

## Live RED at C2

Both P0 leaks are reproduced LIVE in `red-p0-1-tmpdir-steered.txt`
and `red-p0-2-executable-identity.txt`. The CORRECTION02 fixes
both with explicit subprocess-based evidence.

The new apps/vscode tests prove the ADAPTER is truthful:
on darwin with `/usr/bin` first in PATH, the adapter returns
evidence with `executableRealpath === "/usr/bin/mktemp"` AND
`darwinUserTempRoot` from `/usr/bin/getconf` (NOT from
TMPDIR / NOT synthetic).

## C3 plan

C3 will:
1. Run the full engineering gate suite
   (sdk core + apps/vscode policy/approval/sandbox suites +
    bun run build:sdk + apps/vscode bun run compile)
2. Run the seatbelt c3-real-kernel suite for GREEN regression
3. Write c3-closure.md + final-assessment.md evidence
4. Single C3 commit closing CORRECTION02 with
   `PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY CLOSED_CLEAN`.
