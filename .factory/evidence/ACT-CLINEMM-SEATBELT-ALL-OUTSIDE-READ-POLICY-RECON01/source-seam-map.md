# Source-seam map — ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01

Recon-only enumeration of every production seam that bears on the
question:

> Should a read-only command referencing a path outside the workspace
> require manual approval when `mode=all` and mandatory Seatbelt is
> active?

This is a contract reconciliation, not a repair. Every claim in this
map is anchored to a verbatim source citation that any reviewer can
re-open.

---

## §1. The two authority gates (host policy + sandbox containment)

There are two *independent* gates that bear on this question. Both
must be considered separately; conflating them is the central
epistemic risk of the recon.

```text
GATE A (host policy): command-policy.ts:329-411 (path-authority)
  Decides the LATTICE verdict (ALLOW / ASK / DENY) at the host layer.
  Source: `host_workspace_realpath_authority`

GATE B (sandbox containment): seatbelt-profile.ts:153-162 (buildReadRule)
  Decides the FILESYSTEM containment at the macOS Seatbelt layer
  via `(allow file-read*)` + per-X `(deny file-read* (subpath X))`.
  NO lattice output — it is a kernel-level constraint, not a verdict.
```

These gates are *non-overlapping in their authority*:

```text
  GATE A decides whether the user is asked.
  GATE B decides whether the process can read regardless.

  A command with GATE A = ALLOW still goes through GATE B at runtime.
  A command with GATE A = ASK never reaches GATE B (it gates on user
    consent first, and Seatbelt still binds the eventual execution).
  A command with GATE B = DENIED cannot execute the read at all,
    even if GATE A said ALLOW.
```

The decision this recon is asking is *which gate is supposed to be
the load-bearing boundary for outside-workspace reads*.

---

## §2. GATE A — host policy

### §2.1 Lattice ordering (command-policy-types.ts:51-67)

```text
type CommandDecisionKind = "allow" | "ask" | "deny"
restrictiveness: ALLOW (0) < ASK (1) < DENY (2)

Primary invariant: effectiveDecision >= hostDecision
  (the model can only escalate, never downgrade)
```

The lattice is *restrictiveness-ordered*. `ASK` is the default for anything that fails positive proof.

### §2.2 Decision source vocabulary (command-policy-types.ts:78-156)

```text
host_mode_all
host_mode_all_seatbelt_required          (R5 conditional authority)
host_mode_safe_only_rule                  (per-command safe-rule match)
host_mode_safe_only_fallthrough           (anySafeOnlyFallthrough)
host_mode_manual
host_workspace_realpath_authority         (the gate at issue)
host_workspace_path_authority             (legacy)
host_hard_deny
risk_hard_floor                           (R5 catastrophic)
```


### §2.3 The path-authority gate (command-policy.ts:329-411)

Triggers `host_workspace_realpath_authority` (ASK) when ANY of the following is true for a path-bearing R0 command:

```text
  evidence === undefined
  auth.workspaceRoots.length !== evidence.roots.length
  auth.workspaceRoots[i] !== evidence.roots[i]   (root-identity)
  auth.cwd !== evidence.cwd
  evidence.operands.length !== expectedOperands.length
  operand-identity mismatch                       (per-operand)
  conformance fail (outside-root / symlink escape)
```

The command-policy.ts:329-411 block is the gate; `evaluateCommandRealpathConformance` (path-authority.ts:625) is the realpath check. Realpath containment = the operand realpath must be under one of the `auth.workspaceRoots` (after `realpathSync`).


### §2.4 aggregateSource (command-policy.ts:640..760)

The aggregate step that emits the final source for the multi-element input. The order of precedence (R5 + CORRECTION02) is:

```text
  step 1. anyDeny                       -> host_hard_deny
  step 2. anyManual                     -> host_mode_manual
  step 3. anyWorkspacePathAuthority     -> host_workspace_path_authority
  step 4. anyWorkspaceRealpathAuthority -> host_workspace_realpath_authority   (THE GATE)
  step 5. anySafeOnlyFallthrough        -> host_mode_safe_only_fallthrough
  step 6. anySafeOnlyRule               -> host_mode_safe_only_rule
  step 7. strict-suppressor             -> host_mode_all_seatbelt_required
                                          (only when mode=all && mandatorySeatbelt
                                           && aggregateLatticeKind === "allow"
                                           AND step 4 was NOT hit)
```

**Critical structural property**: step 4 (`host_workspace_realpath_authority`) fires *before* the strict-suppressor (step 7). That means:

```text
  For a single-command or multi-command input where ANY operand fails
  the realpath gate (i.e. is OUTSIDE the workspace roots), the
  aggregate source IS host_workspace_realpath_authority, NOT
  host_mode_all_seatbelt_required.

  The ALL + mandatorySeatbelt branch CANNOT downgrade this to ALLOW
  because (a) the lattice is ASK, not ALLOW, so the strict-suppressor pre-condition
  (aggregateLatticeKind === "allow") is not met, and
  (b) step 4 is precedence-higher than step 7.
```

This is the *observed behavior* for the live specimen 54T24A8CE5.


### §2.5 Test fixtures confirming GATE A behavior

```text
  apps/vscode/src/sdk/__tests__/seatbelt-all-workspace-realpath-authority-correction02.live-two-element-red.test.ts
    LIVE_CATEGORY_B (commands=[wc-inside, cat-outside])
      -> ASK / host_workspace_realpath_authority  (CONSERVATION)
    ABL_REVERSED (commands=[cat-outside, wc-inside])
      -> ASK / host_workspace_realpath_authority  (order-independent)
    CONSERVATION_BOTH_OUTSIDE
      -> ASK / host_workspace_realpath_authority  (kernel containment)
```

These are not tests *for* the policy semantics; they are tests *documenting* the current GATE A behavior. They are explicit CONSERVATION tests; the file header declares `R5_MANUAL_APPROVAL_LANE = STILL OPEN` pending this exact reconciliation.


---

## §3. GATE B — Seatbelt filesystem containment


### §3.1 The SBPL read rule (seatbelt-profile.ts:153-162)

```sbpl
  (allow file-read*)
  (deny file-read* (subpath "<DENIED_1>"))
  (deny file-read* (subpath "<DENIED_2>"))
  ...
```

Mechanics:

```text
  - (allow file-read*) is BROAD. macOS Seatbelt processes rules in
    order; (allow file-read*) permits reads of ANY vnode the process
    can stat (subject to macOS process-startup paths).
  - (deny file-read* (subpath X)) is appended AFTER the allow. Apple
    Seatbelt "last match wins" semantics means the deny wins for
    any path matching X or under X.
  - The SECURE boundary IS the deny list, NOT a missing-allow list.
    This is the documented pattern from Anthropic macos-sandbox-utils.
  - (subpath X) matches both X and every descendant of X
    (the vnode-tree subpath).
```


### §3.2 The metadata rule (seatbelt-profile.ts:374-375)

```sbpl
  (allow file-read-metadata (subpath "/"))
```

`(allow file-read-metadata (subpath "/"))` means file metadata (stat/lstat) is permitted for the entire filesystem. This is required for path resolution. It does NOT permit file *contents* to be read; it only permits stat.

### §3.3 What goes into denyReadSubpaths (production wiring)

The production builder is `apps/vscode/src/sdk/sandbox-policy.ts:892-933`.

```text
denyReadSubpaths = [
  ...resolveSafeYoloSensitiveReadDenials({ networkOverride: ... })
]
```

The helper (`sandbox-policy.ts:656-734`) returns `[]` unless ALL of the following hold:

```text
  resolveExperimentalSandboxMode() === "seatbelt-experimental"
  effective network capability is "allow" (env var or Settings override)
  process.env.HOME is set
```

When active, the deny list is **only** the curated credential set (see §3.4). When inactive, `denyReadSubpaths = []`.

**There is no per-task deny-list population based on workspace roots.** The workspace is allowed broadly via `(allow file-read*)` because the workspace is the dogfooder "open directory" — the agent needs to be able to read all of it. The workspace is NOT in the deny list.


### §3.4 The CURATED_CREDENTIAL_SET_V1 (production freeze)

From `darwin-seatbelt-safe-yolo-sensitive-read-confinement01.c2-green.test.ts:14-31` and `sandbox-policy.ts:713-721`:

```text
DENY (only these, when §3.3 predicate is satisfied):
  ~/.ssh/id_rsa
  ~/.ssh/id_ecdsa
  ~/.ssh/id_ecdsa_sk
  ~/.ssh/id_ed25519
  ~/.ssh/id_ed25519_sk
  ~/.ssh/id_mldsa44_ed25519
  ~/.gnupg/private-keys-v1.d/

KEEP_READABLE (NOT in deny list):
  ~/.ssh/config
  ~/.ssh/known_hosts
  ~/.ssh/known_hosts2

DEFER_AUTHENTICATED_DEV_CREDENTIALS (NOT in this list):
  ~/.aws/credentials, ~/.aws/config, ~/.aws/cli/cache/
  ~/.kube/config, ~/.docker/config.json
  ~/.config/gh/hosts.yml

ONLY-EXISTING-FILES-ARE-EMITTED:
  production helper filters the candidate list to existing paths
  (realpathSync failure -> omit; see sandbox-policy.ts:727-733)
```

**Excluded from the deny list (and therefore readable by the sandboxed process when Seatbelt is active):**

```text
  /etc/profiles/per-user/<u>/bin/codium-clinemm     (the live 54T24A8CE5 outside operand)
  /etc/passwd                                       (commonly reachable; not in deny list)
  ~/.ssh/config                                     (explicit KEEP_READABLE)
  ~/.ssh/known_hosts                                (explicit KEEP_READABLE)
  ~/.aws/credentials                                (DEFER_AUTHENTICATED_DEV_CREDENTIALS)
  ~/.kube/config                                    (DEFER_AUTHENTICATED_DEV_CREDENTIALS)
  ~/.docker/config.json                             (DEFER_AUTHENTICATED_DEV_CREDENTIALS)
  ~/.config/gh/hosts.yml                            (DEFER_AUTHENTICATED_DEV_CREDENTIALS)
  /Users/<other-user>/...                           (other users home dirs; not in deny list)
  /Volumes/<other-volume>/...                       (other mounted volumes)
  /private/var/...                                  (system paths)
```

This is the **load-bearing security finding** of this recon.


### §3.5 The R11 invariant (darwin-seatbelt-safe-yolo-sensitive-read-confinement01.c2-green.test.ts:455-462)

```ts
  it("R11: Seatbelt ON + network DENY -> denyReadSubpaths = [] (broad-read preserved)", () => {
    delete process.env.CLINEMM_SAFE_YOLO_NETWORK
    const denials = resolveSafeYoloSensitiveReadDenials()
    expect(denials).toEqual([])
  })
```

The test is explicit: when Seatbelt is active but the network opt-in is NOT set (the historical default posture), the production helper returns `[]`. The historical broad-read contract is preserved.

### §3.6 What GATE B does NOT prevent

Under mandatory Seatbelt (`mode=all + mandatorySeatbelt + sandboxMode=seatbelt-experimental`) and default broad-read (`denyReadSubpaths = []`):

```text
  PERMITTED at Seatbelt layer:
    - reading any file on the host that the process can stat
    - reading /etc, /private, /Users, /Volumes, $HOME, ...
    - reading other users files (subject to file permissions)
    - reading through symlinks (realpath is process-side; Seatbelt
      matches the resolved vnode)
    - reading process substitution targets
    - reading command-substitution operands
    - writing to writableRoots / tempRoot (per the WRITE rule)
    - network: DENIED (default) or ALLOWED (opt-in)
    - exec: ALLOWED for any executable on PATH

  NOT PERMITTED at Seatbelt layer:
    - writing to readonlyRoots (deny-write emitted after write-allow)
    - writing outside writableRoots/tempRoot
    - reading the curated credential set WHEN network=allow
    - reading is gated by macOS file permissions too (uid/gid/ACL)
```

**Seatbelt containment != "safe to expose host file contents to the model".** A sandboxed process can still `cat /etc/profiles/per-user/...` and emit the contents to stdout, which then becomes a tool result in the model context.


---


## §4. The privacy/data-authority boundary

This is the central distinction the policy question turns on:

```text
SANDBOXED EXECUTION       (GATE B)        -- process containment
  !=
SAFE TO EXPOSE TO MODEL   (GATE A needed) -- data-authority boundary
```

A process can be safely contained (cannot write outside writableRoots, cannot exfiltrate to network under default-deny) while still being permitted to read any host file the macOS filesystem allows the process user to read.

When such a file contents are emitted (via `cat`, `wc -l`, `head`, or any safe R0 read command), they enter the model context. This is *data exfiltration by content*, not by network.

Therefore:

```text
  If ClineMM intent is that workspace authority is the
  DATA-AUTHORITY boundary (i.e. "the model should never see host file
  contents that live outside the workspace"), then GATE A
  host_workspace_realpath_authority ASK is the correct semantic.

  If ClineMM intent is that Seatbelt containment (GATE B) is
  sufficient -- i.e. "anything the user can see in their shell, the
  model can see", then the outside operand should auto-approve and
  the ASK is a redundant authority layer.
```

This is not derivable from the source code; it is a product-policy question.


---

## §5. Upstream Cline baseline (context only)

Per `permission-handling.mdx` (upstream `cline/cline` docs):

```text
  autoApprove: true  -> "run without asking"
  CLI auto-approval -> commands run without asking
  Cline also supports command-permission restrictions separately.
```

Therefore, even upstream `autoApprove: true` does NOT mean "ALL commands auto-run"; it means "ALL commands that are not in the configured restriction list auto-run". Upstream treats auto-approval and command restrictions as conceptually distinct controls.

This is **context, not proof**. ClineMM workspace authority may intend to be one such command restriction even when the upstream default for an analogous control is more permissive.


---

## §6. Decision table (post-source-map; pre-decision)

This is the table the recon needs the operator / product owner to rule on. Every cell is currently policy-defaulted to the value the production tests assert today; the question is whether each cell is the *intended* policy.

```text
                              | inside read        | outside read       | outside write
  ----------------------------|--------------------|--------------------|--------------------
  ALL, no Seatbelt            | ASK (realpath ok)  | ASK (realpath fail)| DENY (workspace authority)
                              |                    |                    |
  ALL + mandatory Seatbelt    | ALLOW              | ASK (current)      | DENY (kernel contains write)
                              | (host_mode_all_    | host_workspace_    |
                              |  seatbelt_required)|  realpath_authority|
                              |                    |                    |
  safe-only                   | ASK (no positive   | ASK                | DENY
                              |  rule match)       |                    |
                              |                    |                    |
  explicit deny rule matches  | DENY               | DENY               | DENY
                              |                    |                    |
  stale/missing path evidence | ASK (fail-closed)  | ASK                | ASK
                              |                    |                    |
```

Execution protection (orthogonal axis):

```text
  ALL, no Seatbelt           -> NONE (no Seatbelt; workspace authority is the only authority)
  ALL + mandatory Seatbelt   -> SEATBELT (process containment; broad-read + small credential deny list)
  safe-only                  -> NONE
  explicit deny rule matches -> BLOCKED before execution (rule wins)
  stale/missing evidence     -> BLOCKED before execution (realpath gate fails closed)
```


---

## §7. The bound decision rule (NOT made in this ACT)

Per the verdict MISSION contract, this ACT must NOT make the decision. It produces the seam map, the decision table, and the adversarial case inventory. The decision belongs to operator / product owner.

Three admissible verdicts:

```text
NOT_A_DEFECT_POLICY_EXPECTED
  if outside reads intentionally require approval under ALL+Seatbelt.
  54T24A8CE5 closes as EXPECTED. R5 manual-approval lane waits for
  a genuinely incorrect specimen.

POLICY_SEMANTICS_DEFECT
  if product doctrine establishes that ALL+mandatory Seatbelt SHOULD
  suppress approval for outside reads AND the privacy invariants in §3.6
  can be preserved. Then a separate REPAIR01 is authorized.

CAPTURE_INSUFFICIENT
  if product intent is genuinely undocumented/ambiguous.
  Stop and require explicit policy decision.
```

The recon document, the decision table, and the adversarial case inventory are all the input the operator needs to choose among these three.

