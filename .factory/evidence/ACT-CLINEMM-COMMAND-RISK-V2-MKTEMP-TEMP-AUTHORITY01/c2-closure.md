# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01 — C2 Closure

## Verdict

```
C2 = PASS

BEFORE:
  mktemp                    -> decision:ask  source:risk_parse_failed
  mktemp -d                 -> decision:ask  source:risk_parse_failed
  mktemp -u                 -> decision:ask  source:risk_parse_failed
  mktemp foo.XXXXXX         -> decision:ask  source:risk_parse_failed
  ... (no distinction across forms)

AFTER:
  mktemp                    -> decision:allow  matchedRuleSource:host_safe_mktemp_default_temp
  mktemp -d                 -> decision:allow  matchedRuleSource:host_safe_mktemp_default_temp
  mktemp -u                 -> decision:ask   source:host_mode_safe_only_fallthrough
  mktemp foo.XXXXXX         -> decision:ask   source:host_mode_safe_only_fallthrough
  ... (positive forms auto-approved; negative forms remain ASK)
```

## What changed

### 1. `sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts`

Added ONE safe rule:

```ts
{
    source: "host_safe_mktemp_default_temp",
    pattern: /^\s*mktemp(?:\s+-d)?\s*$/u,
},
```

Inserted immediately after the `host_safe_pwd` rule (logically
grouped with simple intrinsic commands). The rule ships with a
detailed REVIEW STANDARD comment block documenting every accepted
form, every explicit negative, and the DEFAULT_OFF discriminator.

### 2. `sdk/packages/core/src/runtime/command-policy/command-safe-rules.test.ts`

Added TWO new describe blocks (45 tests total):

- `findSafeRuleMatch \u2014 mktemp accepted forms` (1 test, 5 positive forms)
- `findSafeRuleMatch \u2014 REJECTED mktemp forms (path-steering / dynamic / -u)`
  (39 tests, one per documented negative form)
- 1 ablation test: `removing the rule demotes bare mktemp to no-match`

### 3. `sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-live-green.test.ts` (NEW FILE)

23 tests that drive the REAL production function
`evaluateCommandPolicy` with the host authorization that
matches the production call-site in `apps/vscode/src/sdk/sdk-tool-policies.ts:165`
(`{ mode: "safe-only", explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES }`).

This is the LIVE GREEN evidence: the public production seam
now routes bare mktemp to allow/auto-approve-eligible and
keeps every negative at ASK.

## Architectural discriminator still holds

The DEFAULT_OFF discriminator (Section 43) is unaffected:
the safe rule grants authority based on rendered shape alone,
NOT on the executor's later Seatbelt state. The Seatbelt
composition (documented in the predecessor ACT) provides
ADDITIONAL defense-in-depth but is NOT the authorization basis.

## Out-of-scope forms (correctly remain ASK, documented in REVIEW STANDARD)

- mktemp -u                       (Darwin manual: unsafe race)
- mktemp -p DIR ...               (path-steering via destination)
- mktemp -t prefix                (template-driven creation)
- mktemp --tmpdir DIR             (GNU's path-steering form)
- mktemp TEMPLATE                 (caller-selected pathname)
- mktemp "$X" / mktemp ${X}       (dynamic operands, no flattening)
- mktemp $(printf -- -d)         (substitution-evaluated \u2014 not inferrable to `-d`)
- TMPDIR=/x mktemp                (env steering)
- env TMPDIR=/x mktemp            (env wrapper)
- mktemp -d foo.XXXX              (combined -d + template, out of Wave 1)
- mktemp > /tmp/x                 (redirect, opaque)
- mktemp 2>/dev/null              (stderr redirect, opaque)
- mktemp {-d,}  / mktemp *        (brace/glob, no flattened inference)

The OPAQUE_SHELL_TOKENS guard at the upstream of `findSafeRuleMatch`
already short-circuits `&&`, `||`, `|`, `;`, `>`, `<`, `$`, `${`,
so redirects/composition/substitution never reach the regex.

## Files touched

```
sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts
  +1 entry: host_safe_mktemp_default_temp (with REVIEW STANDARD block)

sdk/packages/core/src/runtime/command-policy/command-safe-rules.test.ts
  +1 positive test in finite positive allowlist (with 5 cases)
  +1 REJECTED describe block (39 negative tests + 1 ablation)
  total: 45 new tests

sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-live-green.test.ts
  NEW (23 tests, drives evaluateCommandPolicy at the real production seam)

.factory/epic-board.md
  +1 row (this C2 closure)
```

No SDK API change, no apps/vscode code change, no proto change,
no parser-helper change.

## Scope discipline preserved

- No DEFAULT_OFF behavior change for any other command
- No public knob added
- No PATH-shadowed-binary special case (consistent with
  existing semantic-command-name policy)
- No GNU/Linux specific work (the rule applies uniformly;
  both darwin BSD and GNU satisfy Outcome A for the bare form)
- No template-form support (separate authority family)
- No -u promotion (Darwin manual explicitly unsafe)

## C2 done. C3 next.

C3 plan:
1. Re-run live RED capture test as GREEN.
2. Run Seatbelt mktemp composition through the executor (the
   existing 15-test `command-job-manager.sandbox-c3-real-kernel.test.ts`
   already proves GREEN mktemp / GREEN mktemp -d under private TMPDIR;
   C3 verifies nothing has regressed).
3. Update epic board with PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY.
4. Single C3 commit.
