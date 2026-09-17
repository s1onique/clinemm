# Discriminator — ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01

## Test file
`sdk/packages/core/src/runtime/command-policy/command-policy-authority-fail-closed-recon01.test.ts`

## Evidence label
**SYNTHETIC_REAL through REAL_PRODUCTION_SEAM** — the discriminator
invokes the canonical `evaluateCommandPolicy()` entry point
(`sdk/packages/core/src/runtime/command-policy/command-policy.ts:80`)
and the real `evaluateCommandRiskWithParser()` entry point
(`sdk/packages/core/src/runtime/command-policy/command-risk.ts:365`,
invoked at `apps/vscode/src/sdk/sdk-tool-policies.ts:633`).
Host-mode and tool-input fixtures are synthetic. No new Function
extraction. No mocked approval algorithm. The composition rule is
taken verbatim from the production source.

The combined (structural callsite + functional entry-point) evidence
is a **composed proof**, not direct execution of the full host-adapter
authority chain. See ACT §6 for the explicit composition framing and
§8 for the structural callsite proof.

## Adversarial matrix cases (verbatim from discriminator source)

| Case | toolInput | hostAuthorization | expected | verdict |
|------|-----------|-------------------|----------|---------|
| A1 | `{command:"date",requires_approval:false}` | mode:"all" | allow | host_mode_all |
| A2 | `{command:"date",requires_approval:true}` | mode:"all" | ask | model_escalation |
| A3 conservation | `{command:"rm -rf /",requires_approval:false}` | mode:"manual" | ask | host_mode_manual |
| A3b conservation | `{command:"rm -rf /"}` (model=missing) | mode:"manual" | ask | host_mode_manual |
| A3c conservation | `{command:"rm -rf /",requires_approval:"yes"}` (malformed) | mode:"manual" | ask | host_mode_manual |
| **A3' LOAD-BEARING** | `{command:"pwd",requires_approval:false}` | mode:"safe-only" | allow | host_mode_safe_only_rule |
| **A3' LOAD-BEARING** | `{command:"git status",requires_approval:false}` | mode:"safe-only" | allow | host_mode_safe_only_rule |
| **A3' LOAD-BEARING** | `{command:"some-unknown-tool",requires_approval:false}` | mode:"safe-only" | ask (fallthrough) | (not safe_only_rule) |
| **A3' LOAD-BEARING** | `{command:"some-unknown-tool",requires_approval:true}` | mode:"safe-only" | ask (mirror) | (not allow) |
| **A3' LOAD-BEARING** | `{command:"rm -rf $HOME",requires_approval:false}` | mode:"safe-only" | ask (R5 floor) | (not safe_only_rule, not all) |
| **A3' LOAD-BEARING** | `{command:"rm -rf /",requires_approval:false}` | mode:"safe-only" | ask (R5 floor) | (not safe_only_rule, not all) |
| A4 | `{command:"rm -rf /",requires_approval:true}` | mode:"manual" | ask | host_mode_manual |
| **A3'' STRONGER CONSERVATION (YOLO)** | `{command:"rm -rf $HOME",requires_approval:false}` | mode:"all" | canonical: allow / **host-adapter: ask + never-auto-approve** | risk_hard_floor |
| **A3'' STRONGER CONSERVATION (YOLO)** | `{command:"rm -rf /",requires_approval:false}` | mode:"all" | canonical: allow / **host-adapter: ask + never-auto-approve** | risk_hard_floor |
| A3'' sanity | `{command:"echo hi",requires_approval:false}` | mode:"all" | allow | host_mode_all |
| A3'' mirror | `{command:"rm -rf $HOME",requires_approval:true}` | mode:"all" | ask | (canonical ASK; model_escalation or risk_hard_floor) |
| A5a | `null` | mode:"all" | ask | unknown_input |
| A5b | `{commands:[],requires_approval:false}` | mode:"all" | ask | unknown_input |
| A5c | `{commands:[null],requires_approval:false}` | mode:"all" | ask | unknown_input |
| **A6 LOAD-BEARING** | SAFE_ONLY compound (pwd + non-matching) + model=false everywhere | mode:"safe-only" | ask (aggregate) | (not safe_only_rule) |
| **A6 LOAD-BEARING** | SAFE_ONLY compound (pwd + R5-catastrophic) + model=false everywhere | mode:"safe-only" | ask | (not safe_only_rule) |
| A6 known-safe compound | SAFE_ONLY compound (pwd + git status) + model=false everywhere | mode:"safe-only" | allow | host_mode_safe_only_rule |
| A6 multi-true | multi-command ANY true | mode:"all" | ask | model_escalation |
| deny-a | `{command:"rm -rf /",requires_approval:false}` | explicit deny rule | deny | host_hard_deny |
| deny-b | `{command:"rm -rf /",requires_approval:true}` | explicit deny rule | deny | host_hard_deny |
| LATTICE | model=true on allow/ask/deny base | (probe) | raise only | monotonic |
| LATTICE | model=false on allow/ask/deny base | (probe) | unchanged | no spurious escalation |
## Result (executed)

```text
$ cd sdk/packages/core && bun test \
    src/runtime/command-policy/command-policy-authority-fail-closed-recon01.test.ts

bun test v1.3.13 (bf2e2cec)

src/runtime/command-policy/command-policy-authority-fail-closed-recon01.test.ts:
✓ A1     harness-safe + model=false => ALLOW (no downgrade needed)
✓ A2     harness-safe + model=true  => ASK (model escalation honored)
✓ A3.cons MANUAL + destructive + model=false => ASK trivially
✓ A3.cons MANUAL + destructive + model=missing => ASK trivially
✓ A3.cons MANUAL + destructive + model=malformed => ASK trivially
✓ A3'.s1 SAFE_ONLY + known-safe (pwd) + model=false => ALLOW
✓ A3'.s2 SAFE_ONLY + known-safe (git status) + model=false => ALLOW
✓ A3'.s3 SAFE_ONLY + not-in-allowlist (random-tool) + model=false => ASK (fallthrough)
✓ A3'.s4 SAFE_ONLY + unknown + model=true => ASK (mirror)
✓ A3'.s5 SAFE_ONLY + rm -rf $HOME (R5 catastrophic) + model=false => ASK (floor)
✓ A3'.s6 SAFE_ONLY + rm -rf / (R5 root-destruction) + model=false => ASK
✓ A4     harness-requires-approval (manual) + model=true => ASK
✓ A3''.y1 ALL + rm -rf $HOME (R5 catastrophic) + model=false => canonical ALLOW → host-adapter ASK + never-auto-approve
✓ A3''.y2 ALL + rm -rf / (R5 root-destruction) + model=false => host-adapter ASK + never-auto-approve
✓ A3''.y3 ALL + non-catastrophic + model=false => ALLOW (YOLO honored for non-dangerous)
✓ A3''.y4 ALL + rm -rf $HOME + model=true (escalation) => ASK at canonical
✓ A5.a   null toolInput + model=irrelevant => ASK + unknown_input
✓ A5.b   empty commands array + model=false => ASK + unknown_input
✓ A5.c   unparseable command element + model=false => ASK + unknown_input
✓ A6.1   SAFE_ONLY compound (known-safe + non-matching) + model=false everywhere => ASK (aggregate)
✓ A6.2   SAFE_ONLY compound (known-safe + R5-catastrophic) + model=false everywhere => ASK
✓ A6.3   SAFE_ONLY compound (known-safe + known-safe) + model=false everywhere => ALLOW
✓ A6.4   compound (safe + safe) + model=false => ALLOW under mode=all
✓ A6.5   multi-command ANY true model hint => ASK (order-independent)
✓ deny-a DENY rule + model=false => DENY (no downgrade)
✓ deny-b DENY rule + model=true => DENY (model cannot override deny)
✓ LATTICE.1 model=true  never weakens any verdict (lattice monotonicity)
✓ LATTICE.2 model=false never raises any verdict (no spurious escalation)

 30 pass
  0 fail
 68 expect() calls
Ran 30 tests across 1 file. [193.00ms]
```

## Classification

```text
A3' GREEN  AND  A3'' GREEN
       ⇒  NOT_A_CLINEMM_DEFECT
       ⇒  APPROVAL_AUTHORITY_FAIL_CLOSED_PROVEN
       ⇒  STOP (per ACT §15)

SCOPE FREEZE:
  PROVEN:
    model-supplied requires_approval=false
    cannot waive ClineMM host-required command approval
    (composed: structural callsite proof + functional entry-point proof)

  NOT PROVEN BY THIS ACT:
    approval identity / replay safety
    reject-then-retry correlation
    cross-command approval reuse
    (out of scope; see upstream #10783 et al.)
```

The load-bearing cases:

- **A3' (SAFE_ONLY)** — the DIRECT upstream #12020 reproduction
  (model-supplied `requires_approval=false` in the
  auto-approve/safe-command lane). The bounded positive-matcher
  policy refuses to ALLOW any command outside the finite reviewed
  allow list, and the model hint cannot trick the matcher.
  `some-unknown-tool`, `rm -rf $HOME`, `rm -rf /` all become ASK
  regardless of the model hint. GREEN.

- **A3'' (YOLO + R5 hard floor)** — a STRONGER ClineMM conservation
  (NOT a direct #12020 reproduction — #12020 does not require
  global YOLO). Even when the user has explicitly set `mode:"all"`,
  the production callsite at `sdk-tool-policies.ts:633` invokes
  `evaluateCommandRiskWithParser()`, which layers the R5
  catastrophic hard floor over the canonical lattice, downgrading
  ALLOW → ASK + `disposition:"never-auto-approve"` for the bounded
  set of R5-catastrophic patterns. The model hint cannot erase the
  R5 floor. GREEN.

## Environment note

The discriminator ran under `bun test` (bun 1.3.13) per
`.clinerules/bun-and-node.md` (the AGENTS.md-sanctioned runner for
`@cline/core` unit tests). `bun x vitest` failed in this shell with
`TypeError: undefined is not an object (evaluating 'z.string')`
across ALL command-policy/ tests (including pre-existing ones);
the issue is environmental, not a code defect.
