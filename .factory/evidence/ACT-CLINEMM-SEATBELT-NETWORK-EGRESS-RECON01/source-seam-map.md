# ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01 — source-seam-map

> **Status**: §2 PASS at ENTRY HEAD `266def919` / ENTRY TREE `3aeabf41`
> (recon subject); ACT LAUNCH commit `4963904e9` / LAUNCH TREE
> `bb3667c17` (board + ACT + evidence + .gitignore whitelist).
> Recon read from current source, not inferred. Production seam traced
> end-to-end. §3 classification below.
>
> **Frozen invariant** (frozen at ENTRY):
>
> ```text
> For an authorized command that legitimately requires outbound network:
>
>   if ClineMM policy intends outbound ALLOW:
>       Seatbelt must not deny connect() solely because sandboxing is enabled.
>
>   if ClineMM policy intentionally intends outbound DENY:
>       that denial must be an explicit product policy,
>       not an accidental consequence of an omitted/default policy.
>
> Filesystem/process confinement and network egress are independent axes.
> ```

## §A — The five-line inspection table (the recon answer)

For the **live SSH specimen** (`ssh -o BatchMode=yes -o ConnectTimeout=5 ubuntu@81.177.33.219 hostname`, requested by the user, routed to `45.8.228.212:22`, denied by `(deny network*)`):

```text
NETWORK_INTENT_SOURCE              = resolveSafeYoloNetworkOptIn()
                                     (apps/vscode/src/sdk/sandbox-policy.ts:196)
NETWORK_POLICY_OBJECT              = CommandCapability.network
                                     (sdk/packages/core/src/runtime/sandbox/types.ts:45,
                                      closed union: "deny" | "allow")
ALLOW_OUTBOUND                     = network === "allow" iff
                                     process.env.CLINEMM_SAFE_YOLO_NETWORK === "allow"
                                     AND resolveExperimentalSandboxMode()
                                          === "seatbelt-experimental"
NETWORK_DEFAULT                    = "deny"   (capability-construction default;
                                              CLINEMM_SAFE_YOLO_NETWORK unset ⇒ "deny")
BACKEND_SELECTED                   = "seatbelt-experimental" on darwin host when
                                     CLINEMM_EXPERIMENTAL_SANDBOX is unset/"seatbelt"
BACKEND_AVAILABLE                  = SeatbeltSandboxBackendExperimental.isAvailable()
                                     (cached; darwin + /usr/bin/sandbox-exec +
                                      minimal probe round-trip)
## §B — The full production seam (verbatim source citations)

```text
ClineMM command authorization (SdkController / run_commands tool)
  │
  │  AutoApprove: true (per-session override="all" OR persisted.actions.*)
  ▼
apps/vscode/src/sdk/command-job-manager.ts:554
   resolveExperimentalSandboxMode()
     → "seatbelt-experimental" on darwin host
        (apps/vscode/src/sdk/sandbox-policy.ts:127-154;
         unset / "" / "seatbelt" → "seatbelt-experimental";
         "off" → undefined; anything else → THROWS InvalidSandboxConfigurationError)

   if sandboxMode === "seatbelt-experimental":
     │
     │  apps/vscode/src/sdk/command-job-manager.ts:576
     │   sandboxBackendResolver(sandboxMode)
     ▼
apps/vscode/src/sdk/sandbox-policy.ts:532-548
   defaultSandboxBackendResolver
     → getSandboxBackend("seatbelt-experimental",
                         { mode: "seatbelt-experimental" })
     → SeatbeltSandboxBackendExperimental
       (apps/vscode/src/sdk/sandbox-policy.ts:544)

     │
     │  apps/vscode/src/sdk/command-job-manager.ts:594-597
     │   buildExperimentalReconCapability({
     │     cwd: options.cwd,
     │     workspaceRoots: this.experimentalSandboxWorkspaceRoots,
     │   })
     ▼
apps/vscode/src/sdk/sandbox-policy.ts:600-642
   buildExperimentalReconCapability
     → network: resolveSafeYoloNetworkOptIn() === "allow" ? "allow" : "deny"
                (sandbox-policy.ts:632)
     → environment: { mode: "sanitized", allow: Object.keys(SAFE_ENVIRONMENT_BASELINE) }
     → writableRoots: [...input.workspaceRoots]
     → denyReadSubpaths: [...resolveSafeYoloSensitiveReadDenials()]
                (curated credential deny list; ACTIVE only when
                 resolveSafeYoloNetworkOptIn() === "allow";
                 see sandbox-policy.ts:441-502)
     → readonlyRoots: []

   capability = CommandCapability { network: "deny", ... }

     │
     │  apps/vscode/src/sdk/command-job-manager.ts (post-capability)
     │   backend.prepare({ capability, command: invocation })
     ▼
sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts:94-403
   SeatbeltSandboxBackendExperimental.prepare
     → canonicalizeSandboxRoot for every path in capability
     → synthesize tempRoot (if not provided)
     → generateSeatbeltProfile({...cap, readonlyRoots, writableRoots, ...})
        │
        ▼
sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:297-334
   generateSeatbeltProfile
     → emits (version 1), (deny default), (allow process-exec/fork/signal/sysctl-read/mach-lookup)
     → buildReadRule(denyRead)             (broad allow + deny-subpath carve-outs)
     → buildWriteRule(...)                 (workspace write + tempRoot + readonlyRoots deny)
     → (allow file-read-metadata (subpath "/"))
     → buildNetworkRule(network)           (lines 274-279):
## §C — Site inventory (the load-bearing question)

```text
NETWORK_INTENT_SOURCE         = apps/vscode/src/sdk/sandbox-policy.ts:196
                                (resolveSafeYoloNetworkOptIn, single owner)
NETWORK_POLICY_OBJECT         = sdk/packages/core/src/runtime/sandbox/types.ts:45
                                (SandboxNetwork = "deny" | "allow", closed union)
NETWORK_ALLOW_OUTBOUND        = network === "allow" iff
                                process.env.CLINEMM_SAFE_YOLO_NETWORK === "allow"
                                  AND resolveExperimentalSandboxMode()
                                       === "seatbelt-experimental"
NETWORK_ALLOW_LOCAL           = (no separate field; "allow" is blanket)
NETWORK_DEFAULT               = "deny"
BACKEND_SELECTED              = apps/vscode/src/sdk/sandbox-policy.ts:127-154
                                (resolveExperimentalSandboxMode; darwin host default
                                 ON for unset/empty/"seatbelt"; break-glass = "off")
BACKEND_AVAILABLE             = SeatbeltSandboxBackendExperimental.isAvailable()
                                (sdk/packages/core/src/runtime/sandbox/macos/
                                 seatbelt-backend.ts:94+
                                 + sdk/packages/core/src/runtime/sandbox/macos/
                                 seatbelt-availability.ts: cached probe)
PREPARED_POLICY               = sdk/packages/core/src/runtime/sandbox/macos/
                                seatbelt-profile.ts:274 (buildNetworkRule) +
                                :297 (generateSeatbeltProfile)
```

**The one and only site** that flips `network` from `"deny"` to `"allow"`:

```text
apps/vscode/src/sdk/sandbox-policy.ts:196
  resolveSafeYoloNetworkOptIn()
    returns "allow" iff
      process.env.CLINEMM_SAFE_YOLO_NETWORK === "allow"
      AND resolveExperimentalSandboxMode() === "seatbelt-experimental"

consumed at sandbox-policy.ts:632
  network: resolveSafeYoloNetworkOptIn() === "allow" ? "allow" : "deny"
```

**There is NO other code path** that sets `network: "allow"`. Search across the
repo:

- `sandbox-policy.ts`: only this site.
- `safe-yolo-network-open01.c1-green.test.ts`: RED/GREEN test fixture only.
- `safe-yolo-workspace-write01.c1-green.test.ts`: workspace-write only; does
  not touch network.
## §D — §3 classification matrix — LIVE specimen

```text
A. NETWORK_POLICY_WIRING_DEFECT
   ClineMM intends ALLOW but generated MXC/Seatbelt policy is DENY/omitted
   ─────────────────────────────────────────────────────────────────────
   NOT THIS BRANCH.
   The Seatbelt profile generator correctly emits "(deny network*)" when
   network === "deny" and "(allow network*)" when network === "allow"
   (CORRECTION01 R4 PASS; sdk/packages/core/src/runtime/sandbox/
   correction01-red.test.ts:347-431). The wiring is correct: a
   network:"allow" capability would actually open egress (verified by
   the SAFE-YOLO-NETWORK-OPEN01 green test, darwin-seatbelt-safe-yolo-
   network-open01.c1-green.test.ts:81-249).

B. SEATBELT_BACKEND_DEFECT
   ClineMM intends ALLOW, generated policy explicitly allows outbound,
   but kernel returns EPERM
   ─────────────────────────────────────────────────────────────────────
   NOT THIS BRANCH (cannot be — see §A, generated policy is "(deny
   network*)", which is what the kernel returns EPERM for). The
   profile generator emits the right rule for the policy it received.

C. PRODUCT_POLICY_DEFECT
   ClineMM currently intends DENY/default-deny, generated policy matches
   ─────────────────────────────────────────────────────────────────────
   ★ THIS BRANCH ★ (with the "Branch C-prime" caveat below).
   The capability-construction default is network:"deny". The operator
   has not set CLINEMM_SAFE_YOLO_NETWORK=allow. The Seatbelt profile
   faithfully emits "(deny network*)". The kernel faithfully returns
   EPERM. The behavior is internally consistent; the "defect" is at
   the PRODUCT POLICY seam: the network axis is silently defaulting to
   "deny" in a path that the operator's mental model classifies as
   "YOLO = everything runs".

   Branch C-prime (load-bearing distinction):
     - The user's mental model says: "I turned on YOLO / auto-approve;
       SSH is a normal DevOps command; it should run."
     - The product policy says: "Seatbelt is on; network egress is
       default-DENY unless the operator has separately authorized it
       via CLINEMM_SAFE_YOLO_NETWORK=allow."
     - These two are disjoint. The "intents ALLOW" axis only fires
       after the operator has set an env var they have likely never
       heard of. The defect is that the auto-approval/YOLO surface is
       NOT co-extensive with the Seatbelt network policy.

D. ROUTED_EGRESS_POLICY_DEFECT
   Command routed through a ProxyJump/ProxyCommand path; only that path
   denied
   ─────────────────────────────────────────────────────────────────────
   NOT THIS BRANCH (the deny is blanket — see §E below; routing
   indirection is irrelevant when network:* is denied).

E. CAPTURE_INSUFFICIENT
   ─────────────────────────────────────────────────────────────────────
   NOT THIS BRANCH — the policy intent is bound (§A + §C).
```

**§3 verdict: Branch C-prime (PRODUCT_POLICY_DEFECT)**.

The smallest, most-precise characterization is:

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

## §E — Discriminator evidence (causal-pair shape)

This §E is the discriminator that distinguishes Branch A (wiring) from
Branch C (product). It is purely a **structural** observation from the
source — no kernel call needed; the discriminator is the textual
content of the generated SBPL profile.

```text
For the live specimen (CLINEMM_SAFE_YOLO_NETWORK unset):

  buildExperimentalReconCapability({cwd, workspaceRoots})
## §F — Conservation shape (target invariant for the repair)

The minimum bounded repair MUST preserve the following axes:

```text
SNE-01  Seatbelt + network="allow" → outbound TCP not Seatbelt-denied
                                      (ALREADY PROVEN; SAFE-YOLO-NETWORK-OPEN01
                                      C1 GREEN at HEAD 266def919)
SNE-02  Seatbelt + network="deny"  → outbound remains denied
                                      (ALREADY PROVEN; SAFE-YOLO-NETWORK-OPEN01
                                      C1 GREEN; SAFE-YOLO-YOLO-QUALIFICATION01
                                      C1 GREEN)
SNE-03  sandbox OFF                → historical behavior unchanged
                                      (no-sandbox-backend is byte-equivalent;
                                      seatbelt-backend.ts:204-216)
SNE-04  filesystem write confinement remains enforced
                                      (broad-read + writableRoots + readonlyRoots
                                      unchanged across the repair)
SNE-05  denyReadSubpaths remain denied
                                      (curated credential deny list independent;
                                      sandbox-policy.ts:627,441-502)
SNE-06  local loopback policy conserved
                                      ("allow" is blanket — loopback works under
                                      "allow" and is denied under "deny"; both
                                      intentional under their respective policies)
SNE-07  ordinary commands without network unchanged
                                      (the network field only affects network
                                      syscalls; filesystem/process axes
                                      independent — see seatbelt-profile.ts:303-333)
SNE-08  SSH direct path (no ProxyJump/ProxyCommand) conserved
                                      (no SSH-specific special-case; the fix
                                      operates on the network field, which is
                                      SSH-agnostic)
SNE-09  SSH ProxyJump/ProxyCommand path conserved
                                      (same as SNE-08)
SNE-10  no provider/model-specific branch
                                      (fix is on the capability, not on the
                                      tool/model layer; this avoids the
                                      provider-string-matching anti-pattern)
SNE-11  Seatbelt unavailable → existing fail-closed behavior conserved
                                      (getSandboxBackend returns undefined when
                                      substrate missing; command-job-manager.ts:
                                      577-589 returns sandbox-unavailable)
## §G — Recon exclusions (what we did NOT need to look at)

```text
- MCP OAuth / Cline OAuth capture paths:
    The "Operation not permitted" observed for SSH is at the child-process
    connect() layer (EPERM from sandbox-exec), not at any openExternal()
    interception layer. The capture / OAuth paths are unrelated.

- ~/.ssh/config content / SSH config indirection:
    The 81.177.33.219 → 45.8.228.212 indirection may be a ProxyJump or
    ProxyCommand (the operator's DevOps workflow); it is irrelevant to
    the policy seam. The blanket (deny network*) denies the connect()
    regardless of routing. We do NOT need to parse SSH config.

- Hostname allowlist on Seatbelt:
    MXC's Seatbelt backend does not support DNS-hostname filtering the
    way a firewall can (per upstream docs); we do NOT propose
    per-host/per-port allowlisting as the fix. The repair is on the
    network field ("deny" vs "allow"), which is policy-axis only.

- MiniMax / provider-specific branches:
    Provider string matching is an anti-pattern (per
    .clinerules/general.md). The fix is capability-axis, not
    provider-axis.

- Sandbox disable fallbacks:
    The "forbidden repairs" list (§9 of the plan) explicitly forbids
    disabling Seatbelt globally, special-casing ssh, retrying outside
    the sandbox, or making all sandbox modes network-open. The repair
## §H — Live specimen freeze

```text
LIVE_SPECIMEN = SSH_EGRESS_01

requested command (verbatim from operator):
  ssh -o BatchMode=yes -o ConnectTimeout=5 \
      ubuntu@81.177.33.219 hostname

requested host:
  81.177.33.219

observed connect destination (from stderr):
  45.8.228.212:22

result:
  ssh: connect to host 45.8.228.212 port 22:
  Operation not permitted

user-facing approval state:
  auto approval: ALL — this task
  session override: not set (default; persisted.actions.* may or may not
                    be all-on; "ALL — this task" is the task-scoped grant)

Seatbelt state at execution time:
  CLINEMM_EXPERIMENTAL_SANDBOX = unset (default ON for darwin host)
  CLINEMM_SAFE_YOLO_NETWORK   = unset (default OFF; capability.network = "deny")
  CLINEMM_SAFE_YOLO           = unset (filesystem opt-in independent)

evidence class:
  command/result            = LIVE
  Seatbelt causation         = STRONG_SUPPORT  (denial is at connect() under
                                             sandbox-exec; the policy emits
                                             the deny rule; the kernel
                                             returns EPERM for that rule)
  policy intent              = BOUND           (Branch C-prime; the intent
## §I — Provenance

- Recon read from current source at ENTRY HEAD `266def919` /
  ENTRY TREE `3aeabf41`. ACT launch commit `4963904e9` / LAUNCH TREE
  `bb3667c17` (board + ACT + evidence + .gitignore whitelist; no
  production code changed by this ACT).
- Source files inspected:
  - `apps/vscode/src/sdk/sandbox-policy.ts` (642 lines) — full read.
  - `apps/vscode/src/sdk/command-job-manager.ts:440-720`
    — capability construction + backend resolver seam + per-command
      channel mapping (no network-axis override).
  - `sdk/packages/core/src/runtime/sandbox/types.ts` (314 lines) — full read.
  - `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts:1-403`
    — full read.
  - `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:1-336`
    — full read (network rule builder at line 274-279).
  - `sdk/packages/core/src/runtime/sandbox/sandbox-backend.ts` (136 lines)
    — full read.
  - `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-availability.ts`
    — cached availability probe (darwin + /usr/bin/sandbox-exec + minimal
      `(version 1) (allow default)` profile).
  - `apps/vscode/src/sdk/session-auto-approval.ts:100-200`
    — YOLO predicate (isYoloSessionRequested at line 153;
      deriveExplicitCompletionAuthority at line 191).
  - `apps/vscode/src/sdk/__tests__/darwin-seatbelt-safe-yolo-network-open01.c1-green.test.ts`
    — SAFE-YOLO-NETWORK-OPEN01 GREEN evidence (canonical reference).
  - `sdk/packages/core/src/runtime/sandbox/correction01-red.test.ts:347-431`
    — CORRECTION01 R4 (the historical RED for `(allow network*)`).
- Predecessor epics / ACTs read:
  - `.factory/epic-board.md` — current frontier at HEAD (entry discipline
    from `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01.md`; this
    ACT follows the same HEAD/TREE + launch-commit convention).
  - `.factory/acts/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01.md`
    — §1 entry discipline template.
  - `.factory/epics/safe-yolo-seatbelt.md:1-46` — closed-substrate
    state and the deferred network hardening lane.
- Companion ACTs in the Safe-YOLO family (all CLOSED):
  - `ACT-CLINEMM-SEATBELT-DEFAULT-ON01` (selector contract)
  - `ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01` (+ CORRECTION01)
  - `ACT-CLINEMM-SAFE-YOLO-SEATBELT-NETWORK-OPEN01` (this is the
    closed V1; the deferred row at safe-yolo-seatbelt.md:31
    anticipates exactly this kind of hardening)
  - `ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01` (+ CORRECTION01)
  - `ACT-CLINEMM-SAFE-YOLO-YOLO-QUALIFICATION01` (YOLO does NOT widen
    filesystem authority; the network axis was NOT explicitly part of
    that qualification)
- Companion open ACTs (NOT replaced by this ACT):
  - `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` (P1; editor-tool
    approval surface — independent of command seam)
  - `ACT-CLINEMM-CLASSIC-PROTECTION-RECON01` (P1; classic non-Seatbelt
    approval protection — orthogonal lane)
  - `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` (P1; background-
    command liveness — orthogonal)

                                             axis is observable end-to-end
                                             without needing to run)
```

    is a bounded, intent-binding change to the policy axis.
```

SNE-12  manual Act vs Seatbelted YOLO policy distinction preserved
                                      (the fix must NOT collapse the two;
                                      manual Act = classic, seatbelted YOLO
                                      = Seatbelt + opt-ins)
```

The load-bearing pair is **SNE-01 + SNE-04**: opening the network axis
must not accidentally turn Seatbelt into no-sandbox.

    → returns {network: "deny", ...}

  generateSeatbeltProfile({...cap, network: "deny", ...})
    → emits "...\n(deny network*)\n"        (verbatim seatbelt-profile.ts:276)

  ssh child invoked under /usr/bin/sandbox-exec -f <profile> ...
    → connect(45.8.228.212:22)            → EPERM (Operation not permitted)
                                                (the "(deny network*)" rule fires)

  buildExperimentalReconCapability({cwd, workspaceRoots})
    with CLINEMM_SAFE_YOLO_NETWORK=allow
    → returns {network: "allow", ...}

  generateSeatbeltProfile({...cap, network: "allow", ...})
    → emits "...\n(allow network*)\n"      (verbatim seatbelt-profile.ts:278)

  ssh child invoked under /usr/bin/sandbox-exec -f <profile> ...
    → connect(45.8.228.212:22)            → proceeds past Seatbelt
                                                (no SBPL network rule denies)
```

The textual difference between the two SBPL outputs is exactly one line:
`(deny network*)` vs `(allow network*)`. The textual difference between
the two `CommandCapability` objects is exactly one field:
`network: "deny"` vs `network: "allow"`. The textual difference between
the two upstream choices is exactly one env var:
`process.env.CLINEMM_SAFE_YOLO_NETWORK`.

**There is NO place in the seam where the network field is silently
mis-mapped.** The "wiring" is correct end-to-end. The "product
policy" is the seam.

- `safe-yolo-yolo-qualification01.c1-qualify.test.ts`: GREEN assertion
  `expect(resolveSafeYoloNetworkOptIn()).toBe("allow")` at line 89, with
  the env var set in beforeEach; the YOLO override alone does NOT
  flip it.
- `correction01-red.test.ts`: profile-generator unit test (R4 — the
  historical RED for explicit `(allow network*)`); test fixture only.
- `seatbelt-profile.test.ts`: profile-generator unit test; fixture only.
- `seatbelt-backend.test.ts`: backend unit test; fixture only.
- `no-sandbox-backend.test.ts`: irrelevant (no-sandbox path).

The auto-approval setting `ALL — this task` (auto-approve all commands for
this task) and the session override `all` (YOLO) are **classic policy
axis** inputs (see `apps/vscode/src/sdk/session-auto-approval.ts:153-167`,
`isYoloSessionRequested`). Neither touches the Seatbelt policy axis.

         network === "deny"  → "(deny network*)"
         network === "allow" → "(allow network*)"
     → profile = "<lines joined by \n>\n"

     → materialize env, allocate profile temp dir, write profile
     → return SandboxPreparedInvocation {
         executable: "/usr/bin/sandbox-exec",
         args: ["-f", profilePath, cmd.executable, ...cmd.args],
         cwd, env, envSemantics, backendId: "seatbelt-experimental",
         cleanup: async () => { rm profile dir, rm synthesized tempRoot }
       }
```

PREPARED_POLICY                    = generateSeatbeltProfile(...) →
                                     buildNetworkRule(network):
                                       "deny"  → "(deny network*)"
                                       "allow" → "(allow network*)"
                                     (sdk/packages/core/src/runtime/sandbox/
                                      macos/seatbelt-profile.ts:274, CORRECTION01)

For the live specimen (CLINEMM_SAFE_YOLO_NETWORK unset, "ALL — this task"):
  NETWORK_INTENT                  = ALLOW       (user approved; operator's mental model)
  ALLOW_OUTBOUND                  = "deny"      (CLINEMM_SAFE_YOLO_NETWORK not set)
  BACKEND                         = SeatbeltSandboxBackendExperimental
  GENERATED_SEATBELT_NETWORK_RULE = "(deny network*)"
```
