# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION02 -- C1 Closure

## Verdict

```
C1 = PASS

Both P0 leaks are reproduced live. Contract freeze for
the bounded CORRECTION02 established.
```

## Reopened disposition

The CORRECTION01 verdict
`PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY CLOSED_CLEAN` is REJECTED.
Reviewer disposition
`HALT_MKTEMP_HOST_EVIDENCE_NOT_BOUND_TO_EXECUTION_SEMANTICS`
is correct. Two coupled P0s:

- **P0-1**: `os.tmpdir()` honors `TMPDIR/TMP/TEMP` on non-Windows
  systems, so the CORRECTION01 evidence field
  `effectiveDefaultTempRoot = os.tmpdir()` was environment-steerable.
  Live reproduced at
  `red-p0-1-tmpdir-steered.txt`:
    TMPDIR=/synthetic node -e 'console.log(require("os").tmpdir())'
    -> /synthetic
  vs.
    confstr(_CS_DARWIN_USER_TEMP_DIR) -> /var/folders/.../T
    /usr/bin/getconf DARWIN_USER_TEMP_DIR -> /var/folders/.../T
  The authoritative source ignores TMPDIR; Node does not.

- **P0-2**: CORRECTION01 evidence contained no executable
  identity. The policy approved `mktemp` regardless of which
  mktemp binary PATH resolves to. On this darwin host, the
  default PATH resolves `mktemp` to GNU coreutils 9.8 (Nix
  install), not Darwin's BSD. Live reproduced at
  `red-p0-2-executable-identity.txt`:
    which mktemp -> /run/current-system/sw/bin/mktemp
    realpath     -> /nix/store/.../coreutils-9.8/bin/coreutils
  So even on darwin+evidence, the policy approved GNU mktemp
  as if it were Darwin BSD, and the inherited TMPDIR steered
  the destination.

## CORRECTION02 contract freeze (reviewer's lean correction)

### New evidence interface

```ts
export interface TempAuthorityEvidence {
  /** OS platform the executor will resolve the command on. */
  platform: "darwin";
  /** Raw PATH-resolved executable path of `mktemp`. */
  executablePath: string;
  /** fs.realpathSync(executablePath) -- canonical identity. */
  executableRealpath: string;
  /** Raw `/usr/bin/getconf DARWIN_USER_TEMP_DIR` output. */
  darwinUserTempRoot: string;
  /** fs.realpathSync(darwinUserTempRoot). */
  canonicalDarwinUserTempRoot: string;
}
```

### New gate

The policy gate (after lexical match) requires ALL:

  1. `evidence.executableRealpath === "/usr/bin/mktemp"`
     (only Apple-system identity reviewed in this ACT)
  2. `evidence.darwinUserTempRoot` non-empty
  3. `evidence.canonicalDarwinUserTempRoot` non-empty
  4. `evidence.canonicalDarwinUserTempRoot ===
      fs.realpathSync(evidence.darwinUserTempRoot)`
     (sanity check that the canonical root is consistent with
     the raw root -- the host adapter already realpathed it,
     but the policy rechecks to defend against adapter bugs)

If any gate fails -> ASK with new source:
  host_mktemp_executable_identity_unbound (for #1)
  host_mktemp_temp_authority_unbound (for #2, #3, #4)

### Host adapter

Replace the CORRECTION01 helper with a tighter
`buildTempAuthorityEvidence()` that:

  1. If `process.platform !== "darwin"` -> return undefined.
  2. Resolve `mktemp` via subprocess: `/usr/bin/which mktemp`
     (PATH-aware, host-environment-bound). Capture stdout.
  3. If stdout is empty -> return undefined.
  4. `fs.realpathSync(stdout)` -> `executableRealpath`.
  5. If `executableRealpath !== "/usr/bin/mktemp"` -> return
     undefined. This is the strict identity bound.
  6. Resolve true Darwin per-user temp via subprocess:
     `/usr/bin/getconf DARWIN_USER_TEMP_DIR`. Capture stdout.
  7. If stdout is empty -> return undefined.
  8. `fs.realpathSync(stdout)` -> `canonicalDarwinUserTempRoot`.
  9. If `realpathSync` fails -> fall back to the raw stdout
     string for `canonicalDarwinUserTempRoot` (fail-soft on
     the canonical but the raw is still authoritative).
  10. Return
      `{ platform: "darwin",
         executablePath: stdout_of_which,
         executableRealpath,
         darwinUserTempRoot: stdout_of_getconf,
         canonicalDarwinUserTempRoot }`.

### Why this is the lean correction

The reviewer explicitly preferred:

  > "bare `mktemp`
  >  -> host resolves executable
  >  -> only AUTO if realpath == /usr/bin/mktemp
  >  -> otherwise ASK"

We implement exactly that. On macOS hosts where the default
PATH resolves `mktemp` to /usr/bin/mktemp (typical), the user
gets AUTO. On hosts where PATH is shadowed (homebrew coreutils,
Nix coreutils, etc.), the rule fails closed to ASK.

### Out of scope (correctly remain ASK)

- GNU/Linux bare mktemp (TMPDIR-respecting on most systems)
- PATH-shadowed mktemp on darwin (CORRECTION02 catches this)
- All `-u`, `-p`, `-t`, `--tmpdir`, template, dynamic, env,
  combined, opaque, brace/glob forms (already ASK from CORRECTION01)
- mktemp && other (opaque)
- mktemp > file (opaque)
- mktemp "$X" (dynamic, no flattening)

### Files to be touched in C2

```
sdk/packages/core/src/runtime/command-policy/command-policy-types.ts
  REWRITE TempAuthorityEvidence: replace the four fields with the
  new five-field contract. Add field-by-field documentation.

sdk/packages/core/src/runtime/command-policy/command-policy.ts
  REWRITE the host-evidence-bound gate in evaluateOne():
    - require executableRealpath === "/usr/bin/mktemp"
    - require non-empty darwinUserTempRoot
    - require non-empty canonicalDarwinUserTempRoot
    - on any failure: ASK with the appropriate new source label

sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts
  REWRITE the REVIEW STANDARD block for host_safe_mktemp_default_temp
  to document the executable-identity + true-Darwin-root binding.

sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-host-evidence-bound.test.ts
  REWRITE: positive cases now require executableRealpath =
  "/usr/bin/mktemp" AND darwinUserTempRoot from getconf;
  negative cases include "executable realpath != /usr/bin/mktemp"
  (e.g., GNU coreutils shadow), "missing executable identity",
  "darwinUserTempRoot empty", "darwinUserTempRoot looks synthetic"
  (e.g., /synthetic/... that could be steered).

sdk/packages/core/src/runtime/command-policy/_live-qualification-c4.test.ts
  RENAME to _live-qualification-c5.test.ts.
  REWRITE: RED REPROOF includes both P0-1 (TMPDIR-steered evidence)
  and P0-2 (PATH-shadowed executable) cases. GREEN includes the
  new strict-identity case.

apps/vscode/src/sdk/sdk-tool-policies.ts
  REPLACE buildTempAuthorityEvidence() with the new subprocess-
  based helper. Add new helper `buildStrictMktempEvidence()`.

sdk/packages/core/src/index.ts
  No public type changes -- the TempAuthorityEvidence interface
  is updated in place.
```

### Files NOT touched

```
sdk/packages/core/bin/parser-helper/darwin-*/cline-parser-helper   unchanged
sdk/packages/core/bin/parser-helper/SHA256SUMS.txt                unchanged
proto/cline/*.proto                                                unchanged
sdk/packages/core/src/runtime/command-policy/command-risk.ts       unchanged
sdk/packages/core/src/runtime/command-policy/structured-command-risk.ts unchanged
sdk/packages/core/src/runtime/command-policy/path-authority.ts     unchanged
sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts    unchanged
   (CORRECTION01 lifecycle wrap is intact; the Seatbelt side is
    not affected by CORRECTION02)
```

### Verdict

```
C1 = PASS (entry freeze clean, both P0s reproduced, contract freeze
       for the bounded correction established).

C2 = GO (lean implementation as described; reviewer explicitly
       bounded the correction to executable identity + true Darwin
       temp authority).
```
