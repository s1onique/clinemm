# ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01

> **Status**: **OPEN / POLICY_INTENT_BOUND** — §2 source-seam-map PASS at
> ENTRY HEAD `266def919` / ENTRY TREE `3aeabf41` (recon subject);
> ACT LAUNCH HEAD `a76ff4137` (final binding commit; see §1 for the
> full commit list). §3 classification = **Branch C-prime
> (PRODUCT_POLICY_DEFECT)** — the auto-approval/YOLO surface is NOT
> co-extensive with the Seatbelt network policy axis; §4 RED deferred
> to darwin host (HOST_REQUIRED).
>
> **Primary purpose**: LIVE FAILURE → INTENT/POLICY CLASSIFICATION →
> RED → NECESSITY → BOUNDED REPAIR.
>
> **Owning epic**: [`EPIC-SAFE-YOLO-SEATBELT`](../../epics/safe-yolo-seatbelt.md) ·
> deferred row at safe-yolo-seatbelt.md:31 (post-V1 network hardening).
>
> **Verdict (target set; only one may apply after live capture)**:
> - `PASS_SEATBELT_NETWORK_PRODUCT_POLICY_REPAIR_V1` (Branch C-prime, primary)
> - `PASS_SEATBELT_NETWORK_POLICY_WIRING_REPAIR_V1` (Branch A, ruled out
>   per §D of source-seam-map.md)
> - `PASS_SEATBELT_ROUTED_EGRESS_REPAIR_V1` (Branch D, ruled out)
> - `UPSTREAM_BACKEND_DEFECT_BOUND` (Branch B, ruled out)
> - `NOT_REPRODUCED`
> - `CAPTURE_INSUFFICIENT`

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

**For the live SSH specimen**:

```text
NETWORK_INTENT                   = ALLOW       (operator's mental model;
                                              auto-approval = "ALL — this task")
ALLOW_OUTBOUND                   = "deny"      (CLINEMM_SAFE_YOLO_NETWORK unset)
BACKEND                          = SeatbeltSandboxBackendExperimental
GENERATED_SEATBELT_NETWORK_RULE  = "(deny network*)"
```

The kernel returns `EPERM` (the observed `Operation not permitted`)
because the policy correctly emits `(deny network*)` for the policy it
received.

## §3 — Classification

Per source-seam-map.md §D — Branch C-prime (PRODUCT_POLICY_DEFECT).
## §4 — Minimal executable probe matrix

Per the plan, drive the **same command execution seam** (not ad-hoc
shell). Run each once with `sandbox OFF` and `Seatbelt ON`:

```text
N1  DNS only
    python/socket.getaddrinfo("example.com", 443)
N2  raw outbound TCP
    connect known public endpoint:443
N3  HTTPS
    curl -fsS https://example.com/
N4  SSH direct
    ssh -F /dev/null <direct-host>
N5  SSH real configuration
    original ssh command
N6  loopback
    connect localhost
```

For each, record `network intent | generated policy | backend | return code
| errno | stderr class`. Expected discriminators:

```text
N1-N5 all EPERM, N6 works        → blanket external-egress deny
HTTPS works, SSH fails           → protocol/routed-policy issue
direct SSH works, configured SSH fails → ProxyJump/ProxyCommand path
sandbox OFF works, Seatbelt ON fails → necessity relation strongly supported
```

These are EXECUTABLE on the darwin host that produced the live specimen
(`/usr/bin/sandbox-exec` present; `process.platform === "darwin"`).
The matrix is the real-kernel GREEN for §6 necessity / ablation.

## §5 — RED only after §3

Per §3 (Branch C-prime PRODUCT_POLICY_DEFECT), the RED targets the
**intent-binding seam** — the gap between the user-facing auto-approval
axis and the Seatbelt network axis. There is no RED for the wiring
because the wiring is provably correct (source-seam-map.md §E).

The RED will be authored **only after §4 confirms the necessity
## §7 — Likely bounded repair rules

If §6 confirms the necessity, the bounded repair is an
**intent-binding change** on the policy axis: when the auto-approval /
YOLO surface is fully on AND Seatbelt is the active mode, the network
axis SHOULD flip from `"deny"` to `"allow"` by default, with the
existing `CLINEMM_SAFE_YOLO_NETWORK=allow` opt-in preserved as an
**explicit** declaration of the same intent for users who want to be
explicit. The current default of `"deny"` only applies when the
auto-approval surface is OFF (manual Act mode).

```text
filesystem confinement = ON                  (unchanged)
network egress          = explicit independent policy

Seatbelted YOLO:
  filesystem confinement = ON
  outbound network        = ALLOW             (NEW default under YOLO)
                                              (was: "deny" by default)

strong offline mode (manual Act / no YOLO):
  outbound network        = DENY              (carried)

explicit opt-in via CLINEMM_SAFE_YOLO_NETWORK=allow:
  outbound network        = ALLOW             (carried; explicit declaration)
```

**Do not encode the recommendation into a repair until §3 (DONE) +
§4/§6 (in flight) confirm Branch C-prime and the necessity relation.**
Per the plan's §7 stop rule: "do not encode that recommendation until
§3 tells us whether this is wiring or product policy."

## §8 — Conservation matrix (SNE-01..SNE-12)

At minimum:

```text
SNE-01 Seatbelt + ALLOW → outbound TCP not Seatbelt-denied
SNE-02 Seatbelt + DENY  → outbound remains denied
SNE-03 sandbox OFF      → historical behavior unchanged
SNE-04 filesystem write confinement remains enforced
## §9 — Forbidden repairs

```text
❌ disable Seatbelt globally
❌ special-case ssh
❌ special-case MiniMax (or any provider)
❌ retry command outside sandbox after EPERM
❌ parse stderr for "Operation not permitted" and bypass
❌ blanket danger-full-access fallback
� silently make all sandbox modes network-open
❌ modify ~/.ssh/config
❌ hostname allowlist on Seatbelt
   (MXC documents that Seatbelt cannot enforce DNS hostname filtering
    the way a firewall backend can; do not encode a primitive the
    substrate cannot represent safely)
```

## §10 — Stop rules

```text
HALT_POLICY_INTENT_UNBOUND
HALT_RED_NOT_REPRODUCED
HALT_BACKEND_LIMITATION
HALT_SCOPE_EXPANSION
HALT_SECURITY_CONSERVATION
```

Only P0 halts.

## §11 — Exit states
## §13 — Gate ledger

```text
[x] ENTRY_HEAD_CAPTURED                  = 266def919   (recon subject)
[x] ENTRY_TREE_CAPTURED                  = 3aeabf41    (tree of ENTRY_HEAD)
[x] LAUNCH_HEAD                          = a76ff4137   (frozen; commit list in §1)
[x] LAUNCH_TREE                          = fa383737f   (tree of LAUNCH_HEAD)
[x] WORKTREE_CLEAN                        (verified `git status --short` empty at both checkpoints)
[x] PROTECTED_STASH_PRESERVED            (1 entry; "c2-green-and-c2-p1-delta")
[x] PASS_RECON_SEAM_MAPPED                (source-seam-map.md; this ACT §2)
[x] POLICY_INTENT_BOUND                   (Branch C-prime; source-seam-map.md §D)
[ ] NECESSITY_RELATION_CONFIRMED          (§6 in flight; needs §4 probes on darwin host)
[ ] RED_REAL_PRODUCTION_SEAM              (deferred to §6 PASS)
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

```text
1. CLINEMM_EXPERIMENTAL_SANDBOX unset (default ON for darwin)
   + CLINEMM_SAFE_YOLO_NETWORK unset (default OFF; network:"deny")
   → ssh command → EPERM  (CURRENT; reproduces the live failure)

2. Same + CLINEMM_SAFE_YOLO_NETWORK=allow (explicit allow)
   → ssh command → proceeds past Seatbelt
                                                    (SNE-01 GREEN)

3. Same as (1) + CLINEMM_EXPERIMENTAL_SANDBOX=off (break-glass)
   → ssh command → proceeds past Seatbelt           (SNE-03 GREEN)

4. Same as (1) + post-repair policy (Branch C-prime repair applied)
   → ssh command → proceeds past Seatbelt
                                                    (post-repair GREEN)
```

## §15 — Stop rules

```text
HALT_RED_NOT_REPRODUCED
HALT_SCOPE_EXPANSION
HALT_NEW_SECURITY_REGRESSION
HALT_BACKEND_LIMITATION
  (the desired policy cannot be represented safely by Seatbelt/MXC)
CAPTURE_INSUFFICIENT
```

## §16 — Allowed exits

```text
PASS_SEATBELT_NETWORK_PRODUCT_POLICY_REPAIR_V1    ★ Branch C-prime
PASS_SEATBELT_NETWORK_POLICY_WIRING_REPAIR_V1     (Branch A; ruled out)
PASS_SEATBELT_ROUTED_EGRESS_REPAIR_V1             (Branch D; ruled out)
UPSTREAM_BACKEND_DEFECT_BOUND                     (Branch B; ruled out)
NOT_REPRODUCED
CAPTURE_INSUFFICIENT
```

## §17 — Provenance

- ACT body derived from the macOS Seatbelt engineer + ClineMM factory
  reviewer spec (2026-08-27 review cycle).
- Recon read from current source at HEAD `266def919` / tree `3aeabf41`.
- Source files inspected: see source-seam-map.md §I.
- Authoring of this ACT is itself the §0 + §1 + §2 + §3 deliverable;
  §4 necessity matrix is the next ACT boundary.


```text
PASS_SEATBELT_NETWORK_POLICY_WIRING_REPAIR_V1
PASS_SEATBELT_NETWORK_PRODUCT_POLICY_REPAIR_V1    ★ TARGET
PASS_SEATBELT_ROUTED_EGRESS_REPAIR_V1
UPSTREAM_BACKEND_DEFECT_BOUND
NOT_REPRODUCED
CAPTURE_INSUFFICIENT
```

## §12 — Queue position

```text
P0 ACTIVE
  SEATBELT-NETWORK-EGRESS-RECON01               ← work now (§4 in flight)

P0 WAITING FOR EVIDENCE
  RUNTIME-TASK-PROGRESSION-RECON01

P1
  EDITOR-TOOL-APPROVAL-FRICTION-RECON01

HOLD
  TASK-COST-TRUTH-RECON01
  SETTINGS-SURFACE-PARITY-RECON01
```

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

relation** (sandbox OFF works, Seatbelt ON fails). If §4 does not
confirm, fire `HALT_RED_NOT_REPRODUCED`.

## §6 — Necessity / ablation

One variable at a time, against the same command:

```text
same command + Seatbelt + network:"deny"   (current policy)
same command + Seatbelt + network:"allow"  (with CLINEMM_SAFE_YOLO_NETWORK=allow)
same command + sandbox disabled            (CLINEMM_EXPERIMENTAL_SANDBOX=off)
```

Desired proof shape:

```text
CURRENT       → EPERM
ALLOW_EGRESS  → connection proceeds past Seatbelt
SANDBOX_OFF   → connection proceeds past Seatbelt
```

We do **not** require SSH authentication success. "Connection no longer
denied by Seatbelt" is enough.


The defect characterization:

```text
ClineMM's auto-approval/YOLO surface (classic policy axis) is NOT
co-extensive with ClineMM's Seatbelt network policy axis.

The Seatbelt network axis defaults to DENY and only flips to ALLOW on
the explicit, undocumented-from-the-user-POV env var
CLINEMM_SAFE_YOLO_NETWORK=allow. The user-facing auto-approval toggle
has no way to express network intent; the env var has no UI surface.

For an operator who has authorized a task as "ALL — this task" and
who expects SSH to work (a normal DevOps command), the kernel returning
EPERM is a product-policy defect, not a wiring or backend defect.
```

Branches A/B/D/E ruled out per source-seam-map.md §D.

## §1 — Entry discipline

Verified at ACT open (recon subject) and at ACT launch (board binding):

```text
ENTRY_HEAD      = 266def919   (recon subject; the commit the recon read)
ENTRY_TREE      = 3aeabf41    (tree of ENTRY_HEAD)
LAUNCH_HEAD     = a76ff4137   (the durable-binding commit for this ACT;
                               see commit list in §1 history below)
LAUNCH_TREE     = fa383737f   (tree of LAUNCH_HEAD)

Commit list for this ACT (chronological):
  4963904e9  launch: ACT + evidence + board + .gitignore
  2be2e8fdd  entry-discipline binding
  a76ff4137  trailing-blank-line cleanup; LAUNCH_HEAD frozen here

WORKTREE        = CLEAN       (no uncommitted tracked changes)
PROTECTED_STASH = PRESERVED   (1 entry; "c2-green-and-c2-p1-delta")
ENTRY_BRANCH    = main        (HEAD; canonical consolidation at d844177bc)
```

No entry anomaly. No mixed-fix carry-over. The recon subject (HEAD
`266def919`) is preserved as `ENTRY_HEAD`; the ACT launch commits
(frozen at LAUNCH_HEAD `a76ff4137`) carry the durable binding forward.
Any future commits to this ACT file MUST NOT change the frozen
LAUNCH_HEAD/TREE; downstream updates should land in new commits that
update the §1 commit list without re-binding LAUNCH_HEAD.
