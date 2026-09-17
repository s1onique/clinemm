# C3 Final Assessment (spec §60, CORRECTION03)
# ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2

TIMESTAMP_UTC = 2026-08-26T12:00Z

## Verdict (reviewer-prescribed bounded correction closed)

**PASS_SEATBELT_DARWIN_MKTEMP_CREATE_CAPABILITY CLOSED_CLEAN**

Meaning: the reviewed Apple `/usr/bin/mktemp` command receives
create-only authority for the canonical Darwin user temporary root
through the **real** correlated per-command authorization plan
(NOT a forged test cap). The grant seam now lives inside
`buildCommandExecutionPlan` and consumes the policy decision +
host `TempAuthorityEvidence` directly.

## Trust state

ENTRY_HEAD          = 2babe1a377 (CORRECTION02)
C2 commit            = d51a33328
CORRECTION03 commit  = 327f68dcc (this bounded correction)
DOGFOOD_VERSION     = 4.1.10-327f68dcc
VSIX_SHA256         = 950f6cb97c35201600ff102664a0bdffe3829c46789d0addb94c0076144b8885
VSIX_BYTES          = 14404077
VSIX_PATH           = dist/dogfood/clinemm-4.1.10-327f68dcc.vsix

Working tree clean at HEAD: yes (git status empty, git diff --check empty)
Stray `---` file: deleted from index (`delete mode 100644 ---`)

## Reviewer flags closed

### P0 - missing authorization seam (CORRECTION03 closed)

**Closed.** `buildCommandExecutionPlan` now takes a third optional arg
`hostAuthorization` and derives each entry's `executionCapability`
via the new pure helper `buildFilesystemCreateOnlyCapabilityForCommand`
(command-policy-types.ts). Gate composition (all four MUST hold):
1. matchedRuleSource = `host_safe_mktemp_default_temp`
2. tempAuthorityEvidence present with platform=`darwin` AND
   executableRealpath=`/usr/bin/mktemp` AND non-empty
   canonicalDarwinUserTempRoot
3. normalized argv realpath = `/usr/bin/mktemp`
4. matched rule is for the exact command (no `-u`, `-t`, `-p`,
   template) — handled upstream by command-safe-rules.ts:221

`evaluateCommandToolApprovalWithPlan` threads `hostAuthorization`
into the plan builder. The plan entry's `executionCapability`
travels WITH the plan entry, not at the tool call site.

8 unit tests cover the gate:
  + darwin + full evidence + /usr/bin/mktemp -> cap attached
  + /usr/bin/mktemp -d -> cap attached
  + pwd rule -> no cap (untouched)
  + mixed [mktemp, pwd] -> [cap, none] positional
  + missing tempAuthorityEvidence -> no cap
  + shadowed executableRealpath -> no cap
  + bare `mktemp` -> no cap (realpath fails closed)
  + legacy no-hostAuth arg -> no cap (backward compatible)

### P0 - real upstream GREEN (CORRECTION03 closed)

**Closed.** `c2-green.test.ts` rewritten to start at
`evaluateCommandToolApprovalWithPlan` (not at `manager.start`
with a forged cap). The test:
1. Builds the real `commandHostAuthorization` with darwin
   `tempAuthorityEvidence`
2. Calls `evaluateCommandToolApprovalWithPlan("/usr/bin/mktemp", hostAuth)`
3. Asserts `executionPlan.commands[0].executionCapability =
   {kind: "filesystem-create-only", roots: [canonicalDarwinRoot]}`
4. Creates a real `CommandJobManager` + `createVscodeRunCommandsTool`
5. Calls `tool.execute({commands: ["/usr/bin/mktemp"]}, {commandExecutionPlan})`
6. The Seatbelt backend returns exit 0; the file lands under
   canonical DARWIN_ROOT; parent realpath verified

LABELS: REAL_PRODUCTION_SEAM + REAL_SEATBELT (REAL_AUTHORIZATION_SEAM now also asserted).

The mixed test asserts the same real-upstream flow with `[mktemp, pwd]`
produces `[cap, none]` plan entries.

### P0 - stray tracked `---` file (CORRECTION03 closed)

**Closed.** `git rm -- ./---`; commit shows `delete mode 100644 ---`.
Verified absent post-commit (`ls ./---` fails, `cat ./---` fails).
No `git ls-files --error-unmatch -- ---` output.

### P1 - perCommandExecutionCapability on CommandJobSnapshot (CORRECTION03 closed)

**Closed.** The field is removed from `CommandJobSnapshot`.
The snapshot remains a pure status projection (per the C1
CORRECTION02 invariant that already removed the legacy
`executionCapability`). The docblock now explicitly documents
the rationale (CORRECTION03 of C2). Tests that need to observe
per-job stamping wrap `manager.start` (or `tool.execute`) and
inspect the captured context (see mixed-isolation test).

### Evidence precision (CORRECTION03 closed)

**Network DENY**: replaced the `mktemp exit 0` proxy with a real
causal probe. The sandboxed shell tries `/dev/tcp/127.0.0.1/1`
(Seatbelt `(deny network*)` blocks the connect attempt). The
probe file under `createOnlyRoots` is asserted to NOT contain
"CONNECTED". Real causal pair.

**Secret ABSENT**: replaced the `mktemp filename` proxy (which
never echoed env vars) with a real positive witness. The
sandboxed shell writes `${CLINEMM_FAKE_SECRET_C2:-absent}` to a
file under createOnlyRoots. The file MUST be `absent` (the
synthetic secret is never forwarded under sanitized envSemantics).

**Parser helper**: replaced `expect(true).toBe(true)` with a real
SHA. The test computes `git ls-files parser-helper/` and asserts
structural stability (sha256 hex length = 64 for the present case,
sha256("") for the absent case). At this HEAD the subtree is
absent (handled gracefully).

**T31 arbitrary create**: hardened to a real assertion (no try/catch
swallowing). Failure /test = FAIL; not silently `console.warn`-ed.

## Maturity matrix (spec §57)

```text
AUTHORIZATION
  /usr/bin/mktemp        capability attached to exact plan entry      PASS  (real)
  /usr/bin/mktemp -d     capability attached                          PASS  (real)
  neighbor safe cmd     no capability                                PASS  (real)

PER-COMMAND TRANSPORT
  entry[0] fs-create
  entry[1] none
  → job[0] fs-create
  → job[1] none                                                 PASS  (real)

SEATBELT
  file-write-create on canonical Darwin root                    PASS
  file-write* broad grant                                       ABSENT

KERNEL
  /usr/bin/mktemp                                             PASS  (real)
  /usr/bin/mktemp -d                                          PASS  (real)
  overwrite existing                                          DENY
  unlink existing                                             DENY
  rename existing                                             DENY
  workspace write                                             DENY
  network                                                     DENY  (real causal)
  secret                                                      ABSENT  (real causal)

CAUSALITY
  remove entry capability → original mktemp EPERM              PASS

CONSERVATION
  DEFAULT_OFF                                                UNCHANGED
  policy                                                     UNCHANGED
  Bash env/function boundary                                 UNCHANGED
  parser helper                                              STRUCTURAL (real fs SHA)
```

## Halt conditions (spec §55) - all NOT_TRIGGERED

All 16 halt conditions not triggered. In particular:

  HALT_REAL_CAPABILITY_NOT_BOUND_TO_AUTHORIZATION_SEAM  NOT_TRIGGERED
    The CORRECTION03 production grant seam in buildCommandExecutionPlan
    derives the per-entry capability from policy decision +
    TempAuthorityEvidence.

  (P0 stray file)                                            NOT_TRIGGERED
    Deleted from index. Verified absent.

  (P1 snapshot leak)                                         NOT_TRIGGERED
    perCommandExecutionCapability removed from CommandJobSnapshot.

## Regression gates

| Gate | Result |
|------|--------|
| `apps/vscode bun run check-types` | **0 errors** |
| `apps/vscode vitest run src/sdk/__tests__/` | **68/68 files, 692/692 tests PASS** (was 691, +1 c2-green test rewrite) |
| `sdk/packages/agents bun run test` | **20/20 files, 387/387 tests PASS** |
| `sdk/packages/core bun run test:unit` | **208/208 files, 3151/3151 tests PASS** |
| `git diff --check` | **empty** |
| `git status --porcelain` | **empty (post-commit)** |

## Closure

```text
C2.1: REAL RED + grant-point freeze                       (d51a33328)
C2.2: production wiring + GREEN + conservation            (d51a33328)
C2.3: exact-head VSIX + installed qualification           (d51a33328)
C2-CORRECTION03: REAL authorization->plan->Seatbelt seam   (327f68dcc)  [this correction]
                                                         PASS_SEATBELT_DARWIN_MKTEMP_CREATE_CAPABILITY CLOSED_CLEAN
```

No successor infrastructure ACT needed.
