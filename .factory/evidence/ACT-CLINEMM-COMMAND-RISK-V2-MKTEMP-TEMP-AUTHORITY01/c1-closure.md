# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01 — C1 Closure

## Freezing

The following contract is FROZEN at C1 — any drift requires an
explicit re-discussion, not an unannounced change.

### Scope (Wave 1)

| form                  | finalDecision | finalDisposition      | finalSource                       |
|-----------------------|---------------|-----------------------|-----------------------------------|
| `mktemp`              | `allow`       | `auto-approve-eligible` | `host_safe_mktemp_default_temp` |
| `mktemp -d`           | `allow`       | `auto-approve-eligible` | `host_safe_mktemp_default_temp` |
| `mktemp -u`           | `ask`         | `ask`                 | `no-rule-match`                  |
| `mktemp -p /tmp ...`  | `ask`         | `ask`                 | `no-rule-match`                  |
| `mktemp -t foo`       | `ask`         | `ask`                 | `no-rule-match`                  |
| `mktemp TEMPLATE`     | `ask`         | `ask`                 | `no-rule-match`                  |
| `mktemp "$X"`         | `ask`         | `ask`                 | `risk_parse_failed` (opaque)     |
| `mktemp ${X}`         | `ask`         | `ask`                 | `risk_parse_failed` (opaque)     |
| `TMPDIR=/x mktemp`    | `ask`         | `ask`                 | `no-rule-match`                  |
| `env TMPDIR=/x mktemp`| `ask`         | `ask`                 | `no-rule-match`                  |
| `mktemp -d foo.X`     | `ask`         | `ask`                 | `no-rule-match`                  |
| `mktemp 2>/dev/null`  | `ask`         | `ask`                 | `risk_opaque_composition`        |

### Architectural discriminator — DEFAULT_OFF answer

> "Does auto-approving bare mktemp remain bounded when
>  CLINEMM_EXPERIMENTAL_SANDBOX is disabled?"

ANSWER on darwin-arm64:

  OUTCOME_A_INTRINSIC_BOUNDED_AUTHORITY=YES
  - BSD mktemp on darwin ignores $TMPDIR for the bare form.
  - Destination is the per-user temp dir (/var/folders/.../T),
    which is host-defined and not caller-steerable for the bare
    form (no operand, no -p, no -t, no template).
  - The V1 safe rule's positive match is INDEPENDENT of any future
    sandbox state.
  - Adding the safe rule does NOT bind policy to optional Seatbelt
    protection; it grants bounded authority from host-evidence alone.

  OUTCOME_B_HOST_EVIDENCE_BOUNDED=YES (when PATH-shadowed GNU)
  - GNU mktemp honors $TMPDIR.
  - Destination is host-defined (TMPDIR or default), still bounded
    but the bound depends on which binary PATH resolves to.
  - Same V1 rule continues to bound the bare form, but authority
    description should be honest: "the host can demonstrate the
    destination came from a bounded initial state".

### Wave 1 grammar (verified by regex above)

```regex
^\s*mktemp(?:\s+-d)?\s*$
```

Trailing `\s*` allows benign trailing whitespace (bash ignores it).
The OPAQUE_SHELL_TOKENS guard upstream catches all dynamic,
redirect, composition, and assignment-bearing inputs.

### Files to touch

```
sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts
  +1 entry: host_safe_mktemp_default_temp

sdk/packages/core/src/runtime/command-policy/command-safe-rules.test.ts
  (or new file command-safe-rules.mktemp.test.ts)
  +tests:
    - bare mktemp            -> match (auto-approve-eligible)
    - bare mktemp -d         -> match (auto-approve-eligible)
    - mktemp -u              -> no match (ASK)
    - mktemp foo.XXXXXX      -> no match (ASK)
    - mktemp -p /tmp ...     -> no match (ASK)
    - mktemp -t foo          -> no match (ASK)
    - TMPDIR=/tmp mktemp     -> no match (ASK)
    - mktemp "$X"            -> opaque -> no match (ASK)
    - mktemp 2>/dev/null     -> opaque -> no match (ASK)
    - "mktemp && pwd"        -> opaque -> no match (ASK)

.factory/epic-board.md
  +1 row (C1 closure; description of outcome)

.factory/evidence/ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01/
  (this file + the 8 evidence files already written)
```

### Files NOT touched (parser-helper conservation)

- `sdk/packages/core/bin/parser-helper/darwin-*/cline-parser-helper`
  - SHA256 unchanged at 874741a3... (darwin-arm64)
- `sdk/packages/core/bin/parser-helper/SHA256SUMS.txt`
  - unchanged
- `proto/cline/*.proto`
  - unchanged (no public surface change)

### What I am NOT shipping in Wave 1

- GNU/Linux mktemp support — out of scope (Section 38). Linux
  binaries remain at the existing ASK behavior.
- mktemp template forms — out of scope (Section 19). Path-authority,
  separate ACT candidate.
- mktemp -u "even less authority" claim — explicit non-go (Section 18).
- `mktemp && other_command` composition — out of scope (Section 24).
  Follow the existing safe-rule composition.

## C1 Verdict

```
C1 = PASS

RECON:
  - live RED captured (risk_parse_failed ASK)
  - production rejection boundary identified (V1 safe-rule engine)
  - darwin host semantics captured (BSD ignores TMPDIR for bare
    form, GNU honors TMPDIR)
  - DEFAULT_OFF discriminator: PASS (intrinsic bounded authority)
  - parser helper delta: NONE
  - candidate grammar: PASS the targeted tests in the abstract
  - existing path-authority conservation: PRESERVED (no other safe
    rule form touched)

C2 = GO
```

C2 will:
1. Add the safe rule entry to DEFAULT_COMMAND_HOST_ALLOW_RULES.
2. Add the RED->GREEN test matrix to command-safe-rules tests.
3. Verify no other test file's RED depends on the unchanged
   "ask / risk_parse_failed" status for any of these inputs.
4. Verify command-risk full suite passes.
5. Verify apps/vscode command-policy suite passes.
6. Close C1 evidence.
7. Commit (single C2 commit).

C3 will:
1. Re-run the live RED capture test as GREEN.
2. Run the existing Seatbelt mktemp composition test to ensure
   policy -> executor -> Seatbelt -> mktemp exit 0 is end-to-end
   intact.
3. Update epic board with PASS_MKTEMP_BOUNDED_TEMP_AUTHORITY.
4. Commit (single C3 commit).
