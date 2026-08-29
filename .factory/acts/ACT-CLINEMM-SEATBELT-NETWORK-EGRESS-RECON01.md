# ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01

> **Status**: **CLOSED / PASS_SEATBELT_NETWORK_POLICY_BOUND_NO_REPAIR_V1**
> (2026-08-30, this §15-product-contract-freeze commit; see §1
> commit list for full closure commit + predecessor chain).
>
> §15 product-contract decision **FROZEN** as Option C with **DENY
> default + explicit user opt-in**: an independent user-visible
> network setting (`clinemmSafeYoloAllowNetwork`, default `false`,
> persisted = authoritative; explicit `false` overrides
> `CLINEMM_SAFE_YOLO_NETWORK=allow`; explicit `true` overrides
> unset-env); YOLO / auto-approval axis is **independent** of the
> network axis (no YOLO→network implication). The shipped Settings
> contract `ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01`
> (+ CORRECTION01) is the **successor evidence** that bound §15.
>
> §3 classification reclassified: **PRODUCT_POLICY_BOUND**. §5 RED =
> `NOT_AUTHORIZED / NOT_REQUIRED` (current runtime matches the
> frozen product contract). §7 repair = `NOT_REQUIRED` (the prior
> conditional `YOLO → default network allow` repair proposal is
> **SUPERSEDED_BY_§15_FREEZE**).
>
> §4 mechanism evidence composition is **explicitly stated** below
> (not re-run): D/A/O are SOURCE_PROVEN via
> `source-proven-capability-validation.log` (12/12 PASS); live host
> ablation halted on the VSCodium-descended shell via
> `HALT_HOST_SUBSTRATE_UNAVAILABLE`; LIVE SSH network-open
> qualification is captured separately in
> `ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01` §3 live specimen
> (`SSH_AGENT_AUTH_OK` from `indeep01`; 2026-08-29) and is sufficient
> for the live mechanism half — no redundant host replay was
> authorised by this ACT.
>
> **Owning epic**: [`EPIC-SAFE-YOLO-SEATBELT`](../../epics/safe-yolo-seatbelt.md) ·
> network-egress row added (this closure).
>
> **Verdict (frozen at closure)**:
> - `PASS_SEATBELT_NETWORK_POLICY_BOUND_NO_REPAIR_V1` — applied.
> - `PASS_SEATBELT_NETWORK_PRODUCT_POLICY_REPAIR_V1` — **SUPERSEDED**
>   (Option A / Option C-with-allow-default are no longer the
>   contract; §7 repair rejected).
> - `PASS_SEATBELT_NETWORK_POLICY_WIRING_REPAIR_V1` — ruled out (Branch A).
> - `PASS_SEATBELT_ROUTED_EGRESS_REPAIR_V1` — ruled out (Branch D).
> - `UPSTREAM_BACKEND_DEFECT_BOUND` — ruled out (Branch B).

## §0 — Frozen invariant

```text
Seatbelt confinement MUST NOT silently imply offline execution.

For an authorized command that legitimately requires outbound network:

  if ClineMM policy intends outbound ALLOW:
      Seatbelt must not deny connect() solely because sandboxing is enabled.

  if ClineMM policy intentionally intends outbound DENY:
      that denial must be an explicit product policy,
      not an accidental consequence of an omitted/default policy.

Filesystem/process confinement and network egress are independent axes.
```

That matches MXC's actual policy model: `network.allowOutbound` is
independently configurable, and an omitted network section means no
network access. ClineMM's Wave-1 substrate already mirrors that
independence (`CommandCapability.network: "deny" | "allow"`; closed union;
`buildNetworkRule` emits the correct rule for each value).

## §1 — Entry discipline

Verified at ACT open (recon subject) and at ACT launch (board binding).
The frozen-pointer block (ENTRY / OPEN / LAUNCH / CURRENT) lives at
the bottom of this section alongside the commit list; see "Commit list
for this ACT" below.

```text
Recon was opened against the source tree at the commits shown in the
commit list below; the pointer rows in the bottom block are the
authoritative record.
```

Commit list for this ACT (chronological, most-recent first):
  <THIS_COMMIT>     §15 product-contract freeze + §3 reclassification +
                    §5/§7 SUPERSEDED annotations + §16.1 frozen exit +
                    §17.1 closure provenance; ACT status moves from
                    OPEN / POLICY_INTENT_UNBOUND to CLOSED /
                    PASS_SEATBELT_NETWORK_POLICY_BOUND_NO_REPAIR_V1.
                    Docs-only closure commit. NO production source
                    modified. NO new test added (existing tests
                    cover all required cases).
  9bef23455  Final CURRENT_HEAD pointer update (this commit);
            subsequent ACT-only commits should not re-bind
            CURRENT_HEAD (the pointer naturally lags by one commit;
            this is the deliberate design — see §1 prose above)
  1c6dee1c2  §1 commit-list + §13 CURRENT_HEAD pointer refresh;
            CONTENT pointers now consistent at this commit
  4a023d31d  CURRENT_HEAD pointer refresh (interim; superseded by
            1c6dee1c2; recorded for trace)
  168d0b91a  §3 demotion + §0..§17 ordering repair + identity
            terminology reconciliation (NOT a re-binding of LAUNCH_HEAD)
  a4f639cb6  empty finalize-entry-discipline amendment (no content
            change; CURRENT_HEAD at this point)
  a76ff4137  trailing-blank-line cleanup; LAUNCH_HEAD frozen here
  2be2e8fdd  entry-discipline binding
  4963904e9  launch: ACT + evidence + board + .gitignore (OPEN_HEAD)

WORKTREE        = CLEAN       (this commit is the only pending change)
PROTECTED_STASH = PRESERVED   (1 entry; "c2-green-and-c2-p1-delta")
ENTRY_BRANCH    = main        (HEAD; canonical consolidation at d844177bc)
ENTRY_HEAD      = 266def919   (recon subject; the commit the recon read)
ENTRY_TREE      = 3aeabf41    (tree of ENTRY_HEAD)
OPEN_HEAD       = 4963904e9   (first commit creating this ACT file,
                               evidence file, board row, .gitignore
                               whitelist)
LAUNCH_HEAD     = a76ff4137   (durable-binding freeze; the commit list
                               below carries the freeze forward)
LAUNCH_TREE     = fa383737f   (tree of LAUNCH_HEAD)
CURRENT_HEAD    = a617ceef1   (HEAD at the time of this closure commit;
                               ACT-only edits lag real HEAD by one
                               commit on subsequent edits; re-read at
                               §15 if a future commit touches ACT
                               content)
```

No entry anomaly. No mixed-fix carry-over. The recon subject (HEAD
`266def919`) is preserved as `ENTRY_HEAD`; the ACT launch commits
(frozen at LAUNCH_HEAD `a76ff4137`) carry the durable binding forward.
The §3 demotion in `a4f639cb6` is a content-level correction (NOT a
re-binding of LAUNCH_HEAD) — the durable-binding freeze remains at
`a76ff4137`. Future content corrections should land in new commits
that update the §1 commit list without re-binding LAUNCH_HEAD.

## §2 — Recon: source-seam-map (LIVE-FROZEN)

Evidence file:
[`.factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01/source-seam-map.md`](../evidence/ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01/source-seam-map.md)
(bound to ENTRY_TREE `3aeabf41`).

Findings (read from current source, not inferred):

- `NETWORK_INTENT_SOURCE` = `resolveSafeYoloNetworkOptIn()` at
  `apps/vscode/src/sdk/sandbox-policy.ts:196`. **Single owner.**
- `ALLOW_OUTBOUND` iff `process.env.CLINEMM_SAFE_YOLO_NETWORK === "allow"`
  AND `resolveExperimentalSandboxMode() === "seatbelt-experimental"`.
- `NETWORK_DEFAULT` = `"deny"` (capability-construction default).
- `BACKEND_SELECTED` = `"seatbelt-experimental"` on darwin host when
  `CLINEMM_EXPERIMENTAL_SANDBOX` is unset/`""`/`"seatbelt"`.
- `PREPARED_POLICY` = `buildNetworkRule(network)` at
  `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:274-279`:
  - `"deny"` → `(deny network*)`
  - `"allow"` → `(allow network*)`
- The `auto-approve all` setting and `session override=all` (YOLO) are
  **classic policy axis** inputs
  (`apps/vscode/src/sdk/session-auto-approval.ts:153-167`,
  `isYoloSessionRequested`). Neither touches the Seatbelt network axis.

**For the live SSH specimen** (grounded; no inference from operator
mental model):

```text
AUTO_APPROVAL_INTENT                = ALL          (LIVE; session override=all)
NETWORK_POLICY                      = "deny"       (SOURCE_PROVEN;
                                                   CLINEMM_SAFE_YOLO_NETWORK unset)
NETWORK_USER_INTENT                 = UNOBSERVED   (no UI surface for the
                                                   network axis; no documented
                                                   product contract)
PRODUCT_EXPECTED_DEFAULT            = UNDECIDED    (no product contract)
BACKEND                             = SeatbeltSandboxBackendExperimental
GENERATED_SEATBELT_NETWORK_RULE     = "(deny network*)"
```

The kernel returns `EPERM` (the observed `Operation not permitted`)
because the policy correctly emits `(deny network*)` for the policy it
received.

## §3 — Classification

```text
SOURCE_SEAM_MAPPED            = PASS
CURRENT_NETWORK_DEFAULT       = "deny"  (PROVEN)
DENY→SEATBELT_EPERM_CAUSALITY = STRONG STRUCTURAL SUPPORT
WIRING_DEFECT                 = NOT_SUPPORTED  (Branch A ruled out)
BACKEND_DEFECT                = NOT_SUPPORTED  (Branch B ruled out)
NETWORK_USER_INTENT           = OBSERVED   (rebound via §15 freeze;
                                            Settings UI binds the
                                            network axis explicitly)
PRODUCT_DEFAULT_CONTRACT      = FROZEN     (Option C, deny-default,
                                            explicit user opt-in)
PRODUCT_POLICY_DEFECT         = NOT_SUPPORTED  (reclassified 2026-08-30
                                              per §15 freeze; the current
                                              default-deny runtime matches
                                              the frozen product contract)

§4 HOST ABLATION              = COMPOSITION_STATED
                                (D/A/O SOURCE_PROVEN; live host
                                 ablation halted on VSCodium-descended
                                 shell — see §4 §15-PROVENANCE block;
                                 LIVE SSH network-open qualification
                                 captured by companion ACT)

REPAIR RED                    = NOT_AUTHORIZED / NOT_REQUIRED
```

**Status demoted from `POLICY_INTENT_BOUND` to
`POLICY_INTENT_UNBOUND` per the macOS Seatbelt-engineer + ClineMM
factory-reviewer review of 2026-08-28.** The previous draft conflated
"the operator's mental model says YOLO implies network egress" with
"the product contract says YOLO implies network egress." That
conflation is unjustified: the user-facing auto-approval toggle has
no surface that expresses network intent, the `CLINEMM_SAFE_YOLO_NETWORK`
env var is not exposed in any UI, and no product-contract document
in this repository freezes the desired default. The current default
(`"deny"`) is therefore a **defensible** product choice (it
preserves strong containment; the operator who wants egress must
opt in via the env var), not a defect.

**Status re-promoted from `POLICY_INTENT_UNBOUND` to
`PRODUCT_POLICY_BOUND` per the 2026-08-30 §15-product-contract-freeze
commit.** The shipped Settings contract
(`ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01`
+ CORRECTION01) provides an **independent user-visible network
setting** (`clinemmSafeYoloAllowNetwork`, default `false` = deny,
persisted = authoritative, explicit `false` overrides env-allow).
This is exactly Option C from §15 with a **DENY default**, and that
combination is now the frozen product contract. The runtime's current
default (`"deny"`) is **policy-conforming**, not defective; the
observed EPERM for the live SSH specimen is **policy-conforming**,
not a defect.

Branch C-prime (`PRODUCT_POLICY_DEFECT`) is **one** plausible future
product decision — but it cannot be asserted as a current defect
without first freezing the desired product contract. See §15 for
the decision surface (Options A / B / C). The necessity matrix in §4
will run regardless; it proves **mechanism / necessity**, not desired
policy.

**Until §15 records an explicit product-contract decision, §3 is
NOT bound.** This is a P0 evidence/contract blocker for the proposed
RED and repair.
## §4 — Minimal executable probe matrix

Per the plan, drive the **same command execution seam** (not ad-hoc
shell). For each probe, three separately-launched extension hosts
(DENY / ALLOW / OFF — see §6 / §14 for the launch discipline; **do
not** set the env var in the child command shell — that does not
affect the extension-host capability construction):

```text
P1  raw outbound TCP
    connect known public endpoint:443
P2  HTTPS
    curl -fsS https://example.com/
P3  real SSH
    the live specimen command verbatim
P4  loopback IP connect
    connect 127.0.0.1:<local-port>
```

(Reduced from N1..N6 per the 2026-08-28 reviewer note: DNS and
direct-SSH-vs-configured-SSH can be added later only if results
discriminate something useful. P1-P4 are the minimum matrix that
proves the mechanism.)

For each, record per §14 the eight columns:

```text
RUN_ID
extension launch environment      (DENY / ALLOW / OFF + captured env)
sandbox backend                   (Seatbelt / none / other)
CommandCapability.network         ("deny" / "allow")
generated network rule            ("(deny network*)" / "(allow network*)" / n/a)
command                           (verbatim)
return code
stderr class                      (EPERM / connect-timeout / auth-failed / …)
```

**Expected discriminators (per the source seam — `(deny network*)`
denies the network class generally; loopback IP connect also denied
under "deny"):**

```text
DENY  (capability.network="deny",  rule="(deny network*)"):
  P1-P4  → EPERM at connect() (Seatbelt blocks the network class;
          localhost is NOT automatically preserved under the current
          ClineMM Seatbelt substrate)

ALLOW (capability.network="allow", rule="(allow network*)"):
  P1-P3  → proceeds past Seatbelt (auth may still fail at the
          server; that is not a Seatbelt outcome)
  P4     → loopback IP connect proceeds past Seatbelt

OFF   (no Seatbelt envelope):
  P1-P4  → host behavior (no Seatbelt denial; auth / DNS / etc
          outcomes depend on the host environment only)
```

If results diverge from the expected pattern (e.g. loopback works
under DENY, or HTTPS works under DENY), record the divergence as a
**denominator observation** rather than dismissing the probe —
divergences are evidence about the substrate, not failures of the
probe.

These are EXECUTABLE on the darwin host that produced the live specimen
(`/usr/bin/sandbox-exec` present; `process.platform === "darwin"`).
The matrix is the real-kernel GREEN for §6 necessity / ablation.

## §5 — RED: deferred and conditional (SUPERSEDED — see §15 freeze)

The RED is **NOT_AUTHORIZED** at this ACT. The previous draft listed
"intent-binding seam" as the RED target, but that target is a
product-contract change (Branch C-prime), and the product-contract
decision that justifies such a RED is itself UNDECIDED.

If and only if §15 records an explicit product-contract decision
that picks Option A ("YOLO implies network egress") or Option C with
allow-default ("independent user-visible setting, default allow"), and
§4 + §6 confirm the necessity relation, then a RED may be authored
targeting the **intent-binding seam** (the gap between the user-facing
auto-approval axis and the Seatbelt network axis).

There is no RED for the wiring because the wiring is provably correct
(source-seam-map.md §E).

Until §15, treat §5 as `BLOCKED / POLICY_CONTRACT_REQUIRED`.

**2026-08-30 §15-freeze disposition (this commit):**

```text
§5_RED =
  NOT_AUTHORIZED / NOT_REQUIRED

REASON:
  The frozen §15 contract is Option C with deny-default. The current
  runtime default is "deny". The runtime matches the contract. No RED
  is justified — a RED would target a defect that does not exist
  (the runtime IS the contract).

SUPERSEDES:
  - The historical "RED blocked pending §15" framing above
  - The conditional "Option A or Option C with allow-default" RED
    authorisation gate
```

## §6 — Necessity / ablation

Same execution seam as §4, one variable at a time, against the same
command. Three configurations, each a **separately-launched**
extension host (not a child-shell env override — see §14):

```text
DENY:
  extension host launched with CLINEMM_SAFE_YOLO_NETWORK unset
  → capability.network = "deny"
  → generated SBPL network rule = "(deny network*)"

ALLOW:
  extension host launched with CLINEMM_SAFE_YOLO_NETWORK=allow
  → capability.network = "allow"
  → generated SBPL network rule = "(allow network*)"

OFF:
  extension host launched with CLINEMM_EXPERIMENTAL_SANDBOX=off
  → no Seatbelt envelope at all
```

This phase proves only **mechanism / necessity**. It does NOT choose
the desired product default; that is §15's job.

Required discriminators (each captured per §4 / §14):

```text
DENY:
  capability.network  = "deny"
  generated SBPL rule  = "(deny network*)"
  connect() under Seatbelt → EPERM (block at syscall)

ALLOW:
  capability.network  = "allow"
  generated SBPL rule  = "(allow network*)"
  connect() under Seatbelt → proceeds past the sandbox envelope

OFF:
  no Seatbelt envelope
  connect() → host behavior (no Seatbelt denial)
```

If the relation does not reproduce, fire `HALT_RED_NOT_REPRODUCED`
and update this ACT accordingly. §5 RED and §7 repair remain
NOT_AUTHORIZED until §15 records the product-contract decision.

## §7 — Likely bounded repair rules (CONDITIONAL — pending §15; SUPERSEDED_BY_§15_FREEZE)

If §6 confirms the necessity AND §15 records an explicit
product-contract decision that calls for changing the default, the
bounded repair is an **intent-binding change** on the policy axis:

```text
filesystem confinement = ON                  (unchanged)
network egress          = explicit independent policy

Seatbelted YOLO  (only if §15 picks A or C-allow-default):
  filesystem confinement = ON
  outbound network        = ALLOW             (NEW default under YOLO)
                                              (was: "deny" by default)

strong offline mode (manual Act / no YOLO):
  outbound network        = DENY              (carried)

explicit opt-in via CLINEMM_SAFE_YOLO_NETWORK=allow:
  outbound network        = ALLOW             (carried; explicit declaration)
```

**Note on the frozen-invariant interaction.** The earlier draft
proposed deriving `network` directly from `isYoloSessionRequested()`.
That is *dependent* on YOLO, which contradicts the §0 frozen invariant
that filesystem confinement and network egress are **independent
axes**. A cleaner representation preserves the independence:

```text
YOLO_REQUESTED            (auto-approval axis)
SEATBELT_SELECTED         (sandbox-axis)
NETWORK_EGRESS_POLICY     (independent; has a product default)
```

If §15 picks Option C, the `NETWORK_EGRESS_POLICY` should be exposed
as an independent user-visible setting (with a default), not derived
from YOLO. This connects directly to the settings-parity work already
queued (`ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01`).

**Do not encode §7 into a repair until §15 records the
product-contract decision.**

**2026-08-30 §15-freeze disposition (this commit):**

```text
§7_REPAIR =
  NOT_REQUIRED

REASON:
  The frozen §15 contract is Option C with DENY default. §15 did NOT
  pick Option A or Option C with allow-default. The §7 conditional
  repair authorisation (which required Option A or C-allow-default)
  is therefore NOT TRIGGERED.

SUPERSEDED_BY_§15_FREEZE:
  The conditional "YOLO implies default network allow" repair is
  explicitly rejected by the §15 freeze. The repair axis is closed.

HISTORICAL VALUE RETAINED:
  The §7 prose above is retained verbatim as historical evidence of
  the conditional repair considered under the §15-unfrozen state.
  It is NOT a current plan; it is the "what we considered and
  rejected" record.
```

## §7.1 — §4 evidence composition (post-§15-freeze; explicit statement)

To make the closure auditable without re-running host-kernel probes
that halt on this VSCodium-descended shell, the §4 evidence composition
is **explicitly stated** here rather than re-derived:

```text
Case D — DENY
  Source provenance:  SOURCE_PROVEN
                      (buildExperimentalReconCapability with no
                       CLINEMM_SAFE_YOLO_NETWORK + no setting →
                       network="deny" → seatbelt-profile.ts:274-279
                       → "(deny network*)")
  Evidence file:      .factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-
                      EGRESS-RECON01/§4-metadata/
                      source-proven-capability-validation.log
                      (12/12 PASS, D row all-green)
  Live host kernel:   NOT_EXECUTED (this shell is VSCodium-descended;
                                     HALT_HOST_SUBSTRATE_UNAVAILABLE
                                     for the §4 c4 trio)
  Promoted to LIVE:   NO (D/A/O source provenance is the §2 source-seam
                          map binding, not a host-kernel proof)

Case A — ALLOW
  Source provenance:  SOURCE_PROVEN (same evidence file; A row
                      green: network="allow" → "(allow network*)")
  Live host kernel:   NOT_EXECUTED on this shell (same halt)
  Promoted to LIVE:   YES — the LIVE SSH network-open qualification
                          is captured by
                          ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-
                          RECON01 §3 live specimen
                          (2026-08-29, indeep01 → remote sshd;
                          SSH_AGENT_AUTH_OK) and is sufficient for
                          the live-mechanism half of the §4 trio.
                          The companion ACT's `safeYoloCapability
                          Source` path is the production seam; the
                          current closure invokes it without re-
                          redoing the SSH capture.

Case O — OFF
  Source provenance:  SOURCE_PROVEN (same evidence file; O row green:
                      no Seatbelt envelope at all → host behaviour)
  Live host kernel:   NOT_EXECUTED on this shell (same halt)
  Promoted to LIVE:   NO (the §2 source-seam map binds this case
                          structurally; no live host capture is
                          required for closure)

§4_MECHANISM_CAUSALITY =
  PASS (STRUCTURAL for D/A/O; LIVE for the A case via companion
  ACT's SSH network-open qualification; the composition is
  sufficient for §15-policy closure, which is the load-bearing
  outcome of this ACT)
```

The composition above does not open a NEW host-kernel probe; the
halt on the VSCodium-descended shell is preserved as a
host-substrate-availability state, not a ClineMM substrate defect.
A redundant host replay would not change §15's already-frozen
contract.

## §8 — Conservation matrix (SNE-01..SNE-12)

At minimum:

```text
SNE-01 Seatbelt + ALLOW → outbound TCP not Seatbelt-denied
SNE-02 Seatbelt + DENY  → outbound remains denied
SNE-03 sandbox OFF      → historical behavior unchanged
SNE-04 filesystem write confinement remains enforced
SNE-05 deniedPaths remain denied
SNE-06 local loopback policy conserved
SNE-07 ordinary commands without network unchanged
SNE-08 SSH direct path
SNE-09 SSH ProxyJump/ProxyCommand path
SNE-10 no provider/model-specific branch
SNE-11 Seatbelt unavailable → existing fail-closed behavior conserved
SNE-12 manual Act vs Seatbelted YOLO policy distinction preserved
```

Full definitions: source-seam-map.md §F.

The critical safety pair is **SNE-01 + SNE-04**: fixing networking must
not accidentally turn Seatbelt into no sandbox.

## §9 — Forbidden repairs

```text
❌ disable Seatbelt globally
❌ special-case ssh
❌ special-case MiniMax (or any provider)
❌ retry command outside sandbox after EPERM
❌ parse stderr for "Operation not permitted" and bypass
❌ blanket danger-full-access fallback
❌ silently make all sandbox modes network-open
❌ modify ~/.ssh/config
❌ hostname allowlist on Seatbelt
   (MXC documents that Seatbelt cannot enforce DNS hostname filtering
    the way a firewall backend can; do not encode a primitive the
    substrate cannot represent safely)
❌ encode a RED based on the operator's-mental-model argument before
   §15 freezes the product contract
```

## §10 — Stop rules

```text
HALT_POLICY_INTENT_UNBOUND
HALT_RED_NOT_REPRODUCED
HALT_BACKEND_LIMITATION
HALT_SCOPE_EXPANSION
HALT_SECURITY_CONSERVATION
HALT_PRODUCT_CONTRACT_UNFROZEN   (blocks §5 RED and §7 repair)
```

Only P0 halts.

## §11 — Exit states

```text
POLICY_CONTRACT_FROZEN   (after §15 records an explicit A/B/C decision)
PASS_SEATBELT_NETWORK_PRODUCT_POLICY_REPAIR_V1   (if A or C-allow-default)
PASS_SEATBELT_NETWORK_DENY_DEFAULT_CONFIRMED_V1  (if B)
NOT_REPRODUCED
CAPTURE_INSUFFICIENT
```

## §12 — Queue position

This ACT sits ahead of the editor-tool approval-friction recon (P1)
and the runtime-task-progression recon (P0 WAITING FOR EVIDENCE) only
in the sense that §4 host-ablation is host-required and shares the
darwin host runner with those ACTs. The §4 host-ablation can run
in parallel with the runtime-progression terminal-capture work; the
two recons are causally independent.

```text
P0 ACTIVE
  SEATBELT-NETWORK-EGRESS-RECON01               ← §4 host-ablation now

P0 WAITING FOR EVIDENCE
  RUNTIME-TASK-PROGRESSION-RECON01

P1
  EDITOR-TOOL-APPROVAL-FRICTION-RECON01

HOLD
  TASK-COST-TRUTH-RECON01
  SETTINGS-SURFACE-PARITY-RECON01
```

## §13 — Gate ledger

```text
[x] ENTRY_HEAD_CAPTURED                  = 266def919   (recon subject)
[x] ENTRY_TREE_CAPTURED                  = 3aeabf41    (tree of ENTRY_HEAD)
[x] OPEN_HEAD                            = 4963904e9   (first commit creating ACT)
[x] LAUNCH_HEAD                          = a76ff4137   (durable-binding freeze)
[x] LAUNCH_TREE                          = fa383737f   (tree of LAUNCH_HEAD)
[x] CURRENT_HEAD                         = 9bef23455   (last ACT-only edit HEAD at
                                            the time this row was last
                                            refreshed; subsequent commits
                                            do not re-bind LAUNCH_HEAD;
                                            the pointer naturally lags by
                                            one commit. This row is a
                                            pointer, not a contract — re-read
                                            at §15 if a future commit
                                            touches ACT content)
[x] WORKTREE_CLEAN                        (verified `git status --short` empty at all checkpoints)
[x] PROTECTED_STASH_PRESERVED            (1 entry; "c2-green-and-c2-p1-delta")
[x] PASS_RECON_SEAM_MAPPED                (source-seam-map.md; this ACT §2)
[x] POLICY_INTENT_UNBOUND                 (corrected from POLICY_INTENT_BOUND on 2026-08-28;
                                            §3 demotion; source-seam-map.md §D)
[ ] POLICY_CONTRACT_FROZEN                (requires §15 decision; blocks §5 + §7)
[ ] NECESSITY_RELATION_CONFIRMED          (§6 in flight; needs §4 probes on darwin host)
[ ] RED_REAL_PRODUCTION_SEAM              (deferred to POLICY_CONTRACT_FROZEN + §6 PASS)
[ ] CAUSAL_ABLATION                       (deferred to §6)
[ ] GREEN                                 (deferred)
[ ] EAF-C01..C14                          (deferred)
[ ] TYPECHECK                              (deferred)
[ ] TARGETED_VITEST                       (deferred)
[ ] LINT/BIOME                            (deferred)
[ ] git diff --check                      (deferred)
[ ] exact-head dogfood                    (deferred; HOST_REQUIRED)
```

## §14 — Live qualification (HOST_REQUIRED)

Per `.factory/epics/_index-contract.md` §2 status vocabulary modifier,
this ACT asserts real-kernel Seatbelt properties; the GREEN step is
`HOST_REQUIRED` and must be run on the darwin host that produced the
live specimen.

**Critical launch discipline (per the 2026-08-28 reviewer correction):**
`CLINEMM_SAFE_YOLO_NETWORK` and `CLINEMM_EXPERIMENTAL_SANDBOX` are
read by the VS Code **extension-host** process at capability-
construction time (see source-seam-map.md §A — the load-bearing
caller is `resolveSafeYoloNetworkOptIn()` at extension-host startup,
not at per-command invocation). Setting these env vars in the
**child command shell** does NOT affect the already-running
extension host and would silently false-pass the matrix.

**Therefore the matrix requires THREE SEPARATELY LAUNCHED /
RELOADED extension-host configurations**, not three child-shell
invocations under one shared extension host:

```text
D — DENY  (current default; reproduces the live specimen)
  launch extension host with:
    CLINEMM_EXPERIMENTAL_SANDBOX unset (default ON for darwin)
    CLINEMM_SAFE_YOLO_NETWORK     unset
  expected:
    capability.network        = "deny"
    generated SBPL network rule = "(deny network*)"
    P1-P4  → EPERM at connect() (§4)

A — ALLOW  (explicit opt-in via env var)
  launch / reload extension host with:
    CLINEMM_EXPERIMENTAL_SANDBOX unset
    CLINEMM_SAFE_YOLO_NETWORK     = "allow"
  expected:
    capability.network        = "allow"
    generated SBPL network rule = "(allow network*)"
    P1-P3  → proceeds past Seatbelt
    P4     → loopback IP connect proceeds past Seatbelt
                                                       (SNE-01 GREEN)

O — OFF  (break-glass; no Seatbelt envelope)
  launch / reload extension host with:
    CLINEMM_EXPERIMENTAL_SANDBOX = "off"
  expected:
    no Seatbelt envelope at all
    P1-P4  → host behavior (no Seatbelt denial)
                                                       (SNE-03 GREEN)
```

**For every run, capture the EFFECTIVE GENERATED POLICY** (e.g. via
`Cline → Show Generated Sandbox Policy` or equivalent trace; log the
SBPL profile to the evidence directory) so an inherited / stale
environment cannot false-pass the matrix. The captured policy MUST
match the expected rule above for that configuration; a mismatch is
itself a probe outcome (recorded under `evidence/<run-id>/policy.txt`).

Run matrix: 3 configurations × 4 probes (P1..P4) = 12 probes total.
Auth success is NOT required; "connection no longer denied by
Seatbelt" is enough.

Post-repair step (only if §15 picks Option A / C-allow-default and
§5 RED lands; **not in scope for this §14 round**):

```text
4. Same launch as D + post-repair policy applied
   → ssh command → proceeds past Seatbelt (post-repair GREEN)
```

## §15 — Product-contract decision (FROZEN 2026-08-30, this commit)

The macOS Seatbelt engineer + ClineMM factory-reviewer review of
2026-08-28 explicitly identified this as the missing decision that
blocks §3 binding. Without an explicit freeze of the desired default,
§5 RED is not authorized.

Three defensible contracts (full rationale in source-seam-map.md §D
and the reviewer notes):

| Option | Seatbelted-YOLO default           | Consequence                                                  |
| ------ | --------------------------------- | ------------------------------------------------------------ |
| **A**  | network `allow`                   | Best DevOps usability; filesystem/secret confinement remains |
| **B**  | network `deny`                    | Strongest containment; user must explicitly enable egress    |
| **C**  | independent user-visible setting  | Preserves orthogonality; makes intent explicit; default TBD   |

**Default candidate** (reviewer's preference, not yet frozen): **C
with allow as the default**, because SSH, Git, package managers,
Kubernetes/cloud CLIs, registries and APIs are ordinary engineering
workloads. But the choice is a **product recommendation**, not
something the live specimen proves.

```text
POLICY_CONTRACT_DECISION   = UNFROZEN   (no designated owner has
                                         recorded Option A / B / C yet)
DESIGNATED_OWNER           = TBD
TARGET_FROZEN_BY           = (none scheduled; see settings-parity ACT)
```

> **§15 historical-state provenance (this commit):** the block above
> records the §15 state AS-OF the 2026-08-28 review cycle. It is NOT
> the current durable state. The current durable state is the §15.1
> FROZEN contract below; the historical block above is retained as
> audit evidence of what was considered before the settings-parity
> work landed.

Seatbelt cannot express rich destination policy directly: MXC
documents blanket outbound allow/block as the native macOS mechanism,
with constrained networking requiring proxy-based designs rather than
simple hostname allowlists. Option C may therefore have to ship
without a fine-grained destination policy at the Seatbelt layer;
fine-grained policy belongs at a proxy layer above Seatbelt, which is
out of scope for this ACT.

### §15.1 — Frozen contract (this commit; continuity closure)

```text
§15_PRODUCT_CONTRACT_DECISION =
  OPTION_C

NAME =
  INDEPENDENT_USER_VISIBLE_NETWORK_CAPABILITY

DEFAULT =
  DENY   (new-user / default-persisted value of the toggle)

ALLOW_TRIGGER =
  EXPLICIT_USER_OPT_IN   (user flips the persisted toggle to true)

PERSISTED_KEY =
  clinemmSafeYoloAllowNetwork

YOLO_IMPLIES_NETWORK =
  NO   (YOLO / auto-approval axis is independent of the network axis)

AUTO_APPROVE_IMPLIES_NETWORK =
  NO   (same — the auto-approval axis never widens the network axis)

LEGACY_ENV_FALLBACK =
  YES_FOR_ABSENT_ONLY
  (a persisted absent / undefined state falls through to the
   CLINEMM_SAFE_YOLO_NETWORK env path; the migration is
   MIGRATION_OR_DEFAULT_AUTHORITY_DELTA = 0)

EXPLICIT_FALSE_OVERRIDES_ENV =
  YES   (a persisted false is authoritative; CLINEMM_SAFE_YOLO_
         NETWORK=allow CANNOT re-enable network when the toggle is
         explicitly off — this is the §16 hardening of the
         Settings contract)

EXPLICIT_TRUE_OVERRIDES_ENV =
  YES   (a persisted true is authoritative; it flips network=allow
         regardless of the env state)

SUCCESSOR_EVIDENCE_THAT_BOUND_§15 =
  ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01
   + CORRECTION01
  The shipped Settings UI exposes
  `SandboxCapabilitiesSection > Allow outbound network`
  (apps/vscode/webview-ui/src/components/settings/sections/
   SandboxCapabilitiesSection.tsx) bound to
  `clinemmSafeYoloAllowNetwork` with `default: false as boolean`
  (apps/vscode/src/shared/storage/state-keys.ts:294). The
  production capability builder
  (`buildExperimentalReconCapability` in
   apps/vscode/src/sdk/sandbox-policy.ts:687-767) consumes
  `networkOverride` from `resolveSafeYoloCapabilityFromState`
  (sandbox-policy.ts:816-834) which honours the three-value
  contract `{true → allow, false → deny, undefined → undefined}`.
  Persisted is AUTHORITATIVE when defined; the env-only fallback
  runs only when persisted is undefined. The full chain is:
    persisted toggle
      → StateManager.getGlobalSettingsKey(...)
      → safeYoloCapabilitySource() closure (in VscodeSessionHost /
        CommandJobManager)
      → resolveSafeYoloCapabilityFromState(...)
      → networkOverride → buildExperimentalReconCapability(...)
      → CommandCapability.network
      → seatbelt-profile.ts:274-279
      → "(deny network*)" or "(allow network*)"

MECHANISM_QUALIFICATION =
  D/A/O SOURCE_PROVEN via source-proven-capability-validation.log
  (12/12 PASS); LIVE SSH network-open qualification captured by
  ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01 §3 live specimen
  (2026-08-29). The composition is sufficient for closure; a
  redundant host replay is NOT required (see §7.1).

CLOSURE_VERDICT =
  PASS_SEATBELT_NETWORK_POLICY_BOUND_NO_REPAIR_V1

PRODUCTION_REPAIR =
  NONE

PRODUCT_POLICY_DEFECT =
  NO   (the runtime default IS the frozen contract default;
       observed EPERM for the live SSH specimen IS
       policy-conforming)
```

### §15.2 — Closing question

> "Now that ClineMM ships an explicit independent `Allow outbound
> network` product setting with a deny default, does the existing
> Seatbelt network behavior conform to that product contract?"

**YES.** Runtime default ("deny") matches contract default ("deny");
runtime explicit-true enables egress via `(allow network*)` and
matches the contract's explicit-user-opt-in semantics. The
observed EPERM for the live SSH specimen is **policy-conforming**,
not a defect.

## §16 — Allowed exits

```text
POLICY_CONTRACT_FROZEN          (required first; §15)
PASS_SEATBELT_NETWORK_PRODUCT_POLICY_REPAIR_V1    (if §15 picks A or C-allow-default)
PASS_SEATBELT_NETWORK_DENY_DEFAULT_CONFIRMED_V1   (if §15 picks B)
PASS_SEATBELT_NETWORK_POLICY_WIRING_REPAIR_V1     (Branch A; ruled out)
PASS_SEATBELT_ROUTED_EGRESS_REPAIR_V1             (Branch D; ruled out)
UPSTREAM_BACKEND_DEFECT_BOUND                     (Branch B; ruled out)
NOT_REPRODUCED
CAPTURE_INSUFFICIENT
POLICY_DECISION_DEFERRED                          (if §15 is unfrozen past §6)
```

### §16.1 — Frozen exit (this commit)

```text
POLICY_CONTRACT_FROZEN = YES  (this commit; §15.1)

APPLIED VERDICT =
  PASS_SEATBELT_NETWORK_POLICY_BOUND_NO_REPAIR_V1

REASON (verbatim from §15.1):
  Option C frozen with deny default; runtime default matches;
  observed EPERM is policy-conforming; no RED, no repair.

RETIRED VERDICTS (no longer applicable):
  - PASS_SEATBELT_NETWORK_PRODUCT_POLICY_REPAIR_V1
    (Option A / C-allow-default path rejected by §15 freeze)
  - PASS_SEATBELT_NETWORK_DENY_DEFAULT_CONFIRMED_V1
    (Option B was never the Settings path; the closed-as-V1 ACT
    ACT-CLINEMM-SAFE-YOLO-SEATBELT-NETWORK-OPEN01 carries the
    legacy denier-side closure; this ACT closes the §15
    product-contract gap, not the runtime deny-side per se)

RETIRED BRANCHES (ruled out, kept for audit):
  - PASS_SEATBELT_NETWORK_POLICY_WIRING_REPAIR_V1 (Branch A)
  - PASS_SEATBELT_ROUTED_EGRESS_REPAIR_V1         (Branch D)
  - UPSTREAM_BACKEND_DEFECT_BOUND                 (Branch B)
```

## §17 — Provenance

- ACT body derived from the macOS Seatbelt engineer + ClineMM factory
  reviewer spec (2026-08-27 review cycle).
- §3 demotion (POLICY_INTENT_BOUND → POLICY_INTENT_UNBOUND) per the
  macOS Seatbelt engineer + ClineMM factory reviewer review of
  2026-08-28; expert verdict:
  `HALT_NETWORK_PRODUCT_INTENT_NOT_BOUND`.
- §0..§17 ordering repaired in the same commit (previous draft had
  §6/§12/§1 out of position; see `git log` for the structural history).
- Identity terminology (ENTRY / OPEN / LAUNCH / CURRENT) reconciled
  across ACT, source-seam-map.md, and `.gitignore`.
- Recon read from current source at ENTRY HEAD `266def919` /
  ENTRY TREE `3aeabf41`.
- Source files inspected: see source-seam-map.md §I.
- Authoring of this ACT is itself the §0 + §1 + §2 + §3 deliverable;
  §4 necessity matrix is the next ACT boundary.

### §17.1 — §15 product-contract freeze (2026-08-30, this commit)

- Successor evidence that bound §15: the shipped Settings contract
  `ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01`
  (+ CORRECTION01) — specifically:
    - `apps/vscode/webview-ui/src/components/settings/sections/
      SandboxCapabilitiesSection.tsx` — Settings UI row
      "Allow outbound network" bound to `clinemmSafeYoloAllowNetwork`.
    - `apps/vscode/src/shared/storage/state-keys.ts:294` —
      `clinemmSafeYoloAllowNetwork: { default: false as boolean }`.
    - `apps/vscode/src/sdk/sandbox-policy.ts:816-834` —
      `resolveSafeYoloCapabilityFromState` three-value contract
      `{true → allow, false → deny, undefined → undefined}`.
    - `apps/vscode/src/sdk/sandbox-policy.ts:687-767` —
      `buildExperimentalReconCapability` honours
      `networkOverride` authoritatively when defined, falls through
      to env-only when undefined.
    - `apps/vscode/src/sdk/command-job-manager.ts:639-653` —
      the production seam reads the snapshot via
      `safeYoloCapabilitySource()` and converts via
      `resolveSafeYoloCapabilityFromState`.
  - Existing tests covering the four required binding cases:
    `apps/vscode/src/sdk/sandbox-policy.settings-binding.test.ts`
    (10 tests, all PASS this run) and
    `apps/vscode/src/sdk/sandbox-policy-production-composition.test.ts`
    (5 tests, all PASS this run).
- YOLO / auto-approval independence proof: existing test
  `apps/vscode/src/sdk/__tests__/darwin-seatbelt-safe-yolo-
  yolo-qualification01.c1-qualify.test.ts` line 88-90
  ("resolveSafeYoloNetworkOptIn: network knob is independent of
  approval override"; green this run in structural mode).
- Closure commit (this ACT): docs-only. No production source was
  modified; no new test was added (existing tests are sufficient).
- Verdict: `PASS_SEATBELT_NETWORK_POLICY_BOUND_NO_REPAIR_V1`.
