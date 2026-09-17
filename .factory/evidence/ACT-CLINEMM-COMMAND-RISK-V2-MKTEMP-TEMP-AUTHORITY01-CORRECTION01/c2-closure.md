# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION01 — C2 Closure

## Verdict

```
C2 = PASS

The cross-platform authority leak is closed.

BEFORE (prior ACT C2):
  mktemp              -> allow / auto-approve-eligible on ANY platform
                          regardless of inherited environment
                          LEAK: GNU mktemp honors inherited TMPDIR

AFTER (CORRECTION01):
  mktemp (darwin, with evidence) -> allow / auto-approve-eligible
  mktemp (darwin, no evidence)   -> ask  / host_mktemp_temp_authority_unbound
  mktemp (linux, any evidence)   -> ask  / host_mktemp_temp_authority_unbound
  mktemp (other, any evidence)   -> ask  / host_mktemp_temp_authority_unbound
  mktemp -u (any)                -> ask  / host_mode_safe_only_fallthrough
  mktemp foo.XXXXXX (any)        -> ask  / host_mode_safe_only_fallthrough
  ...
```

## What changed

### 1. `sdk/packages/core/src/runtime/command-policy/command-policy-types.ts`

- Added `TempAuthorityEvidence` interface exporting `platform`,
  `effectiveDefaultTempRoot`, `canonicalDefaultTempRoot`.
- Added optional `tempAuthorityEvidence?: TempAuthorityEvidence`
  on `CommandHostAuthorization`.
- Added a new `CommandDecisionSource` value
  `host_mktemp_temp_authority_unbound` so the operator can see why
  the AUTO did not fire.
- Extended `commandHostAuthorization()` factory to accept the
  new optional field. The factory remains backward-compatible:
  omitting `tempAuthorityEvidence` is a no-op.

### 2. `sdk/packages/core/src/runtime/command-policy/command-policy.ts`

- Added `TEMP_AUTHORITY_HOST_EVIDENCE_BOUND_SOURCES = { "host_safe_mktemp_default_temp" }`.
- Added `isTempAuthorityHostEvidenceBoundRuleSource(source)` predicate.
- Added `isTempAuthorityHostEvidenceBound(source)` exported predicate
  for tests.
- Inside `evaluateOne()` (the per-command policy resolver), AFTER
  the R0 path-authority block and BEFORE the
  `safeExecutionProfile` assignment, added a new branch:
  if the matched safe rule is in
  `TEMP_AUTHORITY_HOST_EVIDENCE_BOUND_SOURCES`, then:
    (a) if `auth.tempAuthorityEvidence` is undefined -> ASK
        with `host_mktemp_temp_authority_unbound`
    (b) if `auth.tempAuthorityEvidence.platform !== "darwin"` -> ASK
        with `host_mktemp_temp_authority_unbound`
    (c) if either `effectiveDefaultTempRoot` or
        `canonicalDefaultTempRoot` is empty -> ASK
        with `host_mktemp_temp_authority_unbound`
  Otherwise: fall through to the existing ALLOW verdict.

### 3. `sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts`

- Rewrote the REVIEW STANDARD block for `host_safe_mktemp_default_temp`
  to reflect the corrected contract:
    - rendered shape matches is necessary but NOT sufficient
    - the rule is host-evidence-bound
    - only `platform === "darwin"` promotes
    - linux/unknown stays at ASK
    - the source comment no longer claims cross-platform AUTO

### 4. `sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-host-evidence-bound.test.ts` (NEW)

29 tests covering the corrected contract at the production policy seam:

- darwin WITH evidence -> AUTO (4 positive cases)
- darwin WITHOUT evidence -> ASK with `host_mktemp_temp_authority_unbound` (2)
- linux WITH linux evidence -> ASK (2)
- darwin WITH malformed evidence -> ASK (3 cases:
  empty effectiveDefaultTempRoot, empty canonicalDefaultTempRoot,
  platform=unknown)
- darwin WITH evidence + negative forms -> ASK (18 negative forms)

The old `command-policy.mktemp-live-green.test.ts` was REPLACED with
this file (the original docstring overstated the evidence as "LIVE
installed UX"; the renamed file states clearly "REAL_PRODUCTION_POLICY_SEAM").

### 5. `sdk/packages/core/src/runtime/command-policy/_live-qualification-c4.test.ts` (NEW, replaces c3)

6 tests:

- RED REPROOF (under CORRECTION01): darwin host WITHOUT evidence
  returns ASK with `host_mktemp_temp_authority_unbound`. This
  closes the cross-platform authority leak at the policy layer.
- RED REPROOF (linux-with-linux-evidence): darwin gate rejects
  linux evidence; bare mktemp returns ASK.
- GREEN PROOF: darwin WITH evidence auto-approves bare mktemp
  and bare mktemp -d.
- CONSERVATION: mktemp -u and mktemp foo.XXXXXX remain ASK with
  darwin evidence.

The file name was renamed from `_live-qualification-c3.test.ts` to
`_live-qualification-c4.test.ts` and the docstring was updated to
make explicit that the test surface is REAL_PRODUCTION_POLICY_SEAM,
not LIVE installed UX (the live UX evidence is the seatbelt
c3-real-kernel suite from the predecessor ACT).

## Architectural invariants preserved

- **No DEFAULT_OFF behavior change for non-mktemp commands.**
- **No new paths to broad filesystem write.** Bare mktemp under
  the host-evidence gate is bounded to the host-proven per-user
  temp directory on darwin.
- **Linux mktemp is now ASK**, not AUTO. This closes the leak
  the reviewer identified.
- **No public knob added.** The new field is optional; the factory
  remains backward-compatible.
- **No apps/vscode code change** (yet -- the apps/vscode adapter
  in C3 will populate the evidence for darwin hosts).
- **Parser-helper SHA256SUMS unchanged.**
- **OPAQUE_SHELL_TOKENS guard intact** -- all the negative forms
  remain ASK at the lexical layer regardless of evidence.
- **R5 catastrophic floor intact** -- no impact on `rm -rf` etc.
- **1044 cmd-policy tests PASS** -- no regression in any other
  safe rule.

## Scope discipline

- Linux mktemp support remains OUT OF SCOPE. Proving bounded Linux
  mktemp authority would require canonicalizing inherited TMPDIR
  per-process and binding it to a per-user temp authority --
  a separate ACT candidate.
- Template forms (`mktemp foo.XXXX`) remain ASK -- separate
  authority family.
- `-u`, `-p`, `-t`, `--tmpdir` remain ASK.
- All compose / opaque / dynamic / env-steering / glob / brace
  forms remain ASK.
- No parser-helper change.
- No proto / schema change.

## Files touched

```
sdk/packages/core/src/runtime/command-policy/command-policy-types.ts
  +TempAuthorityEvidence interface
  +tempAuthorityEvidence optional field on CommandHostAuthorization
  +host_mktemp_temp_authority_unbound source value
  +extended commandHostAuthorization() factory

sdk/packages/core/src/runtime/command-policy/command-policy.ts
  +TEMP_AUTHORITY_HOST_EVIDENCE_BOUND_SOURCES set
  +isTempAuthorityHostEvidenceBoundRuleSource predicate
  +isTempAuthorityHostEvidenceBound exported predicate
  +new branch in evaluateOne() requiring host evidence

sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts
  REVIEW STANDARD block rewritten for host_safe_mktemp_default_temp

sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-host-evidence-bound.test.ts
  NEW (29 tests, replaces command-policy.mktemp-live-green.test.ts)

sdk/packages/core/src/runtime/command-policy/_live-qualification-c4.test.ts
  NEW (6 tests, replaces _live-qualification-c3.test.ts)

sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-live-green.test.ts
  DELETED (replaced by the new file)

sdk/packages/core/src/runtime/command-policy/_live-qualification-c3.test.ts
  DELETED (replaced by _live-qualification-c4.test.ts)
```

## C3 plan

C3 will:
1. Update `apps/vscode/src/sdk/sdk-tool-policies.ts` to populate
   `tempAuthorityEvidence` for darwin hosts at
   `executeSafeCommands=true`.
2. Run apps/vscode full vitest -- expect zero regressions
   (the new field is optional and existing tests don't supply it).
3. Run apps/vscode compile (biome + tsc + proto-lint).
4. Run apps/vscode seatbelt c3-real-kernel suite -- the
   Seatbelt mktemp composition must remain GREEN (no production
   change to the sandbox side; only the policy evidence changes).
5. Single C3 commit closing the CORRECTION01 with
   `PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY CLOSED_CLEAN`.
