# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION01 — C1 Closure

## Frozen

The previous ACT's verdict is REJECTED. The production rule
was a flat cross-platform lexical regex that ignored inherited
environment. The reviewer disposition
(HALT_MKTEMP_DEFAULT_OFF_AUTHORITY_UNPROVEN) is correct.

## Live RED (reproduced)

On this darwin-arm64 host, with a synthetic TMPDIR set externally:

  Darwin BSD /usr/bin/mktemp     -> /var/folders/.../T/tmp.XXXX  (Outcome A confirmed)
  GNU coreutils (PATH-resolved) -> $SYNTH/tmp.XXXX               (LEAK reproduced)

The leak exists whenever the production environment resolves
`mktemp` to the GNU coreutils binary. On darwin hosts this
happens via homebrew/coreutils/nix installs; on Linux hosts it
is the default. The lexical regex auto-approves the command
in both cases, breaking the bounded-destination claim.

## CORRECTION01 contract freeze

**Make host_safe_mktemp_default_temp a host-evidence-bound rule.**

Architecture (mirrors the existing R0 path-authority evidence
mechanism):

  1. The lexical regex continues to gate the rendered shape:
     `^\s*mktemp(?:\s+-d)?\s*$` -- unchanged from C2.

  2. Promotion to ALLOW ALSO requires the host authorization to
     carry `tempAuthorityEvidence`:
       platform: 'darwin' | 'linux' | 'win32' | 'unknown'
       effectiveDefaultTempRoot: string    // raw TMPDIR / observed default
       canonicalDefaultTempRoot:  string    // canonicalized realpath

     For this ACT (darwin-only), the gate accepts ONLY
     platform === 'darwin'. Anything else returns ASK with
     source `host_mktemp_temp_authority_unbound`.

  3. If `tempAuthorityEvidence` is missing entirely, the rule
     falls through to ASK (defense in depth -- the host that
     hasn't supplied evidence can't claim authority).

  4. The host adapter at apps/vscode/src/sdk/sdk-tool-policies.ts
     populates tempAuthorityEvidence for darwin hosts:
       platform: 'darwin'
       effectiveDefaultTempRoot: <process.env.TMPDIR
                                 || _CS_DARWIN_USER_TEMP_DIR (via confstr)
                                 || '/tmp'>
       canonicalDefaultTempRoot: <fs.realpathSync of the above>
     This is a host-evidence convention; the policy layer
     stays pure.

  5. Linux remains ASK. This ACT explicitly does NOT add a
     Linux-safe-rule for mktemp. Linux mktemp honors inherited
     TMPDIR -- proving bounded Linux authority requires an
     authority-evidence change that is OUT OF SCOPE for this
     ACT and would be a separate ACT candidate.

## Out of scope (correctly remain ASK)

- GNU/Linux bare mktemp (TMPDIR-respecting on most systems)
- All `-u`, `-p`, `-t`, `--tmpdir`, template, dynamic, env,
  combined, opaque, brace/glob forms (already ASK from C2)
- mktemp && other (opaque)
- mktemp > file (opaque)
- mktemp "$X" (dynamic, no flattening)

## Files to be touched in C2

```
sdk/packages/core/src/runtime/command-policy/command-policy-types.ts
  +TempAuthorityEvidence interface
  +optional tempAuthorityEvidence field on CommandHostAuthorization
  +extended commandHostAuthorization() factory

sdk/packages/core/src/runtime/command-policy/command-policy.ts
  +TEMP_AUTHORITY_HOST_EVIDENCE_BOUND_SOURCES = { "host_safe_mktemp_default_temp" }
  +isTempAuthorityHostEvidenceBoundRuleSource(source)
  +new branch in evaluateOne() (after the R0 path-authority block):
     if matched source is temp-authority-bound AND evidence missing
       return ASK source="host_mktemp_temp_authority_unbound"
     if matched source is temp-authority-bound AND evidence.platform !== "darwin"
       return ASK source="host_mktemp_temp_authority_unbound"
     if matched source is temp-authority-bound AND evidence fields malformed
       return ASK source="host_mktemp_temp_authority_unbound"
     else fall through to existing safeExecutionProfile assignment

sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts
  -REWRITE the REVIEW STANDARD block for host_safe_mktemp_default_temp:
   no longer claim "promotes the bare form on Linux too"
   document the new contract: lexical match + darwin host evidence
   list the explicit host-side evidence fields the host adapter must supply

sdk/packages/core/src/runtime/command-policy/command-safe-rules.test.ts
  +1 ablation test: rule still matches mktemp / mktemp -d at the
   lexical layer (no host-evidence gate at this layer; the gate is in
   evaluateOne)
  +new describe block documenting that the RULE is platform-neutral
   but PROMOTION to ALLOW is host-evidence-bound (the rule engine
   does not see the evidence; it just returns the source label;
   command-policy.ts:evaluateOne applies the gate)

sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-live-green.test.ts
  -REWRITE assertions:
   positive cases require tempAuthorityEvidence{darwin} AND
     assert decisionKind=allow AND matchedRuleSource=host_safe_mktemp_default_temp
   linux cases WITHOUT evidence: assert decisionKind=ask AND
     source contains host_mktemp_temp_authority_unbound
   linux cases WITH evidence AND platform==="linux": assert ASK (darwin gate rejects)
   "without evidence" cases: assert ASK with the same source
  -update docstring to be precise: this drives evaluateCommandPolicy at
   the production policy seam -- it is NOT a substitute for live installed UX
  -rename to command-policy.mktemp-host-evidence-bound.test.ts

sdk/packages/core/src/runtime/command-policy/_live-qualification-c3.test.ts
  -RENAME to _live-qualification-c4.test.ts
  -add a new test that uses process.env.TMPDIR-stripping helper to
   simulate the inherited env case explicitly (a fake getter via
   vi.stubEnv)
  -assert: under the CORRECTION, GNU PATH-resolved bare mktemp with
   a TMPDIR-inherited env returns ASK even though the rendered
   string is just "mktemp"

.factory/epic-board.md  +this row (already added)
```

## Files NOT touched

```
sdk/packages/core/bin/parser-helper/darwin-*/cline-parser-helper   unchanged
sdk/packages/core/bin/parser-helper/SHA256SUMS.txt                unchanged
proto/cline/*.proto                                                unchanged
sdk/packages/core/src/runtime/command-policy/command-risk.ts       unchanged
sdk/packages/core/src/runtime/command-policy/structured-command-risk.ts unchanged
sdk/packages/core/src/runtime/command-policy/path-authority.ts     unchanged
```

## P1 wording correction

The committed tests' file names overstate the test surface. The
production-policy-seam tests in command-policy.mktemp-live-green.test.ts
and _live-qualification-c3.test.ts drive evaluateCommandPolicy directly
-- they are `REAL_PRODUCTION_POLICY_SEAM` evidence, NOT `LIVE installed UX`.
The TRUE live installed UX evidence is the seatbelt c3-real-kernel
suite from the predecessor ACT.

CORRECTION01 renames `_live-qualification-c3.test.ts` ->
`_live-qualification-c4.test.ts` and updates the docstring of the
live-green file to state "REAL_PRODUCTION_POLICY_SEAM (this test is
NOT a substitute for live installed UX; see c3-real-kernel suite
for that evidence)".

## Verdict

C1 = PASS (entry freeze clean, RED reproduced, contract freeze for
the bounded correction established).

C2 = GO (lean implementation as described).
