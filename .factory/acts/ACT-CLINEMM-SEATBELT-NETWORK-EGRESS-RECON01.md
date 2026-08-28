# ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01

> **Status**: **OPEN / POLICY_INTENT_UNBOUND** — §2 source-seam-map PASS
> at ENTRY HEAD `266def919` / ENTRY TREE `3aeabf41`; OPEN HEAD
> `4963904e9`; LAUNCH HEAD `a76ff4137` (durable-binding freeze; see §1
> for full commit list). §3 classification = **CANDIDATE_PRODUCT_POLICY
> _DECISION_REQUIRED** (Branch C-prime is *one* plausible product-policy
> choice, but the product contract that "YOLO implies unrestricted
> network egress" is **UNOBSERVED**; until that contract is frozen, §3
> is not bound). §4 host-ablation **AUTHORIZED** (HOST_REQUIRED); §5
> RED **NOT_AUTHORIZED** until the product-contract decision lands.
>
> **Primary purpose**: LIVE FAILURE → INTENT/POLICY CLASSIFICATION →
> NECESSITY ABLATION → PRODUCT-CONTRACT DECISION → BOUNDED REPAIR.
>
> **Owning epic**: [`EPIC-SAFE-YOLO-SEATBELT`](../../epics/safe-yolo-seatbelt.md) ·
> deferred row at safe-yolo-seatbelt.md:31 (post-V1 network hardening).
>
> **Verdict (target set; only one may apply after live capture)**:
> - `PASS_SEATBELT_NETWORK_PRODUCT_POLICY_REPAIR_V1` (Branch C-prime,
>   **only if** the product-contract decision in §15 picks Option A
>   or Option C with allow-default; pending decision)
> - `PASS_SEATBELT_NETWORK_POLICY_WIRING_REPAIR_V1` (Branch A, ruled out
>   per §D of source-seam-map.md)
> - `PASS_SEATBELT_ROUTED_EGRESS_REPAIR_V1` (Branch D, ruled out)
> - `UPSTREAM_BACKEND_DEFECT_BOUND` (Branch B, ruled out)
> - `NOT_REPRODUCED`
> - `CAPTURE_INSUFFICIENT`
> - `POLICY_DECISION_DEFERRED` (post-§4; awaiting explicit product-contract
>   choice from a designated owner; not auto-promoted)

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

Verified at ACT open (recon subject) and at ACT launch (board binding):

```text
ENTRY_HEAD      = 266def919   (recon subject; the commit the recon read)
ENTRY_TREE      = 3aeabf41    (tree of ENTRY_HEAD)
OPEN_HEAD       = 4963904e9   (first commit creating this ACT file,
                               evidence file, board row, .gitignore
                               whitelist)
LAUNCH_HEAD     = a76ff4137   (durable-binding freeze; the commit list
                               below carries the freeze forward)
LAUNCH_TREE     = fa383737f   (tree of LAUNCH_HEAD)
CURRENT_HEAD    = 9bef23455   (HEAD at the time of this commit;
                               subsequent ACT-only commits naturally
                               lag this pointer by one commit; this is
                               the deliberate design — the pointer is
                               informational, not a contract. Re-read
                               at §15 if a future commit touches ACT
                               content.)

Commit list for this ACT (chronological, most-recent first):
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

WORKTREE        = CLEAN       (no uncommitted tracked changes)
PROTECTED_STASH = PRESERVED   (1 entry; "c2-green-and-c2-p1-delta")
ENTRY_BRANCH    = main        (HEAD; canonical consolidation at d844177bc)
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
NETWORK_USER_INTENT           = UNOBSERVED
PRODUCT_DEFAULT_CONTRACT      = UNDECIDED
PRODUCT_POLICY_DEFECT         = NOT_YET_PROVEN

§4 HOST ABLATION              = AUTHORIZED
REPAIR RED                    = NOT_AUTHORIZED
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

## §5 — RED: deferred and conditional

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

## §7 — Likely bounded repair rules (CONDITIONAL — pending §15)

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

## §15 — Product-contract decision (REQUIRED before §5 RED)

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

Seatbelt cannot express rich destination policy directly: MXC
documents blanket outbound allow/block as the native macOS mechanism,
with constrained networking requiring proxy-based designs rather than
simple hostname allowlists. Option C may therefore have to ship
without a fine-grained destination policy at the Seatbelt layer;
fine-grained policy belongs at a proxy layer above Seatbelt, which is
out of scope for this ACT.

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
