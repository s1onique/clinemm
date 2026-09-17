# ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01 — Final Assessment

## Verdict

```
PASS_SEATBELT_PRIVATE_TEMP_CAPABILITY
CLOSED_CLEAN
```

## What the fix is

The Wave-1 dogfood surface T01/T02 (and E04) as REAL_PRODUCTION_SEAM
EPERM. The seam for fix was already plumbed end-to-end:

  CommandCapability.tempRoot?: string         (sdk/core types.ts:122)
  prepare() canonicalizes caller-supplied path (seatbelt-backend.ts:191)
  profile emits (allow file-write* (subpath "...")) (seatbelt-profile.ts:204)
  materializeEnvironment sets TMPDIR=syntheticTempDir (environment.ts:205)

The gap: the backend only handled `if (cap.tempRoot)` (line 191 of
seatbelt-backend.ts) but the contract at types.ts:113 said "When
tempRoot is omitted and environment.mode=sanitized, the backend
synthesizes one under the system temp root". The production builder
(sandbox-policy.ts:142) never sets tempRoot, so synthesis never
fired.

## Fix scope (C1)

  sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts:
    - Added SYNTHESIZED_TEMP_DIR_PREFIX = "clinemm-sandbox-temp-"
    - Added else branch to the `if (cap.tempRoot)` block: when tempRoot
      is undefined, mkdtempSync under tmpdir() with the prefix,
      canonicalize via realpathSync, fail-closed on canonicalization
      failure (best-effort cleanup before throwing SandboxError).
    - Updated cleanup hook to also best-effort remove the synthesized
      temp root. Caller-supplied tempRoot is NOT touched (the
      backend never allocated it).

  apps/vscode/src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts:
    - Added 6 GREEN tests covering mktemp/mktemp -d success, TMPDIR
      binding, W01 conservation, sibling-deny (no parent authority
      expansion), and cleanup.

No API surface change. No public knob added. No DEFAULT_OFF behavior
change. No command-policy change. No broad /tmp write grant.

## C2 dogfood ablation

Reran the same manifest at the same SHA against the C1 source.
Identical 31 probes + 3 CONTROL legs. Matrix delta:

  T01  COMPATIBILITY_FAIL  -> PASS   (mktemp writes to canonical temp)
  T02  COMPATIBILITY_FAIL  -> PASS   (mktemp -d same)
  E04  TMPDIR=              -> TMPDIR=/private/var/folders/.../T/clinemm-sandbox-temp-XXXXX
  W01  EXPECTED_DENY        -> EXPECTED_DENY  (unchanged)
  N01  EXPECTED_DENY        -> EXPECTED_DENY  (unchanged)
  C02  EXPECTED_DENY        -> EXPECTED_DENY  (unchanged)
  E01  PASS                 -> PASS  (unchanged)
  F03  TOOL_MISSING         -> RESOLVED  (cwd is repo-root now; sdk/apps resolve)
  F04  TOOL_MISSING         -> RESOLVED  (same)
  G07  COMPATIBILITY_FAIL   -> COMPATIBILITY_FAIL  (unchanged, env issue)

P0 matrix (W01, N01, C02, E01) is unchanged. P0_FAIL=0.
CAUSAL_PAIR_FAIL=0. P0_HALTED=false. Security invariants are
preserved.

## Why the fix is bounded

1. Only ONE write grant is added to the profile:
   `(allow file-write* (subpath "<canonical temp root>"))`.
2. The canonical temp root is the result of realpathSync on
   mkdtempSync(tmpdir(), "clinemm-sandbox-temp-XXXXXX"). On
   macOS this resolves to /private/var/folders/.../T/...
3. The grant does NOT extend to:
   - /tmp, /private/tmp
   - /var, /private/var
   - any parent of the synthesized temp root
   - any sibling of the synthesized temp root
4. The deny-after-allow rule order is preserved; if a workspace
   readonlyRoot is a descendant of the temp root (impossible by
   construction since workspaceRoots are user-supplied and the
   synthesized root is in /private/var/folders/.../T/), the deny
   would still win.
5. Network deny is unchanged. Secret sanitization is unchanged.
6. The cleanup hook is best-effort and never affects the command's
   exit classification.

## Conservation matrix (all P0 regressions zero)

```
W01 EXPECTED_DENY  -> unchanged
N01 EXPECTED_DENY  -> unchanged
C02 EXPECTED_DENY  -> unchanged
E01 PASS            -> unchanged

p0Fail=0, causalPairFail=0, p0Halted=false

W01 workspace write still DENIED under production seam
N01 network still DENIED
C02 nested shell workspace write still DENIED
E01 synthetic secret still absent

DEFAULT_OFF    unchanged
CommandPolicy  unchanged
Parser helper  unchanged
```

## Files touched (production, committed)

  apps/vscode/src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts
    (+217 / -200 lines; 6 new GREEN tests)

  sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts
    (+56 / -4 lines; synthesis branch + cleanup extension)

## Test gates

  vitest sandbox c3-real-kernel file        15/15 PASS (was 9/9)
  vitest command-job-manager.test.ts         18/18 PASS
  vitest command-job-manager.sandbox-integration 16/16 PASS
  sdk/packages/core full vitest          3039 PASS / 0 FAIL
  apps/vscode bun run compile             biome lint+format+tsc+proto PASS
  git diff --check                        clean

## Trust state

  C1_HEAD    = 938faa7bb feat(safety): ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01-C1
  C1_TREE    = <frozen at commit time>
  C2 run completed against C1_HEAD above
  branch     = main
  origin/main = unchanged (3 unpushed local commits: Wave-1 dogfood
    C1+C2+C3 + this ACT's C1+C2)
  NOT pushed

## Next steps (NOT in this ACT)

1. **C3 commit** — evidence/cleanup only. Will follow this C2 in a
   separate commit. Will remove the dogfood harness directory
   (`apps/vscode/src/dev/dogfood/`) per its frozen removal trigger
   (the matrix has closed; the successor evidence supersedes it).

2. **Possible follow-up ACT** — `ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01`
   for the interactive command-policy layer (the separate
   command-policy `mktemp` approval issue, NOT touched here).

3. **Possible follow-up ACT** — `ACT-CLINEMM-COMMAND-SANDBOX-DEVELOPER-CACHE-CAPABILITY01`
   if real Go/Node cache workflows are next on the priority list
   (also NOT in scope of this ACT).
