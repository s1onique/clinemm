# ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01

> **Status (at open)**: OPEN / HIGH / RECON / HOST_REQUIRED
>
> **Predecessor**: `ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01`
> (CLOSED / `PASS_SEATBELT_NETWORK_POLICY_BOUND_NO_REPAIR_V1` /
> §15-frozen; the §15 product contract = Option C with DENY default,
> explicit user opt-in, persisted-toggle authoritative; runtime
> default (`"deny"`) IS the contract default at closure).
>
> **Adjacent predecessor**: `ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-
> REGRESSION01` (CLOSED at `PASS_LEGACY_HYDRATION_REPAIR_V1` /
> `LIVE_REGRESSION = NOT_REPRODUCED_IN_CURRENT_SOURCE_PATH`; H2 RED
> reproduced then GREEN; reviewer disposition `FURTHER_PRECOMMIT_
> REVIEW = NOT_AUTHORIZED`; the reviewer-prescribed "next steps"
> rule reads: *"The next network investigation should only reopen if
> a freshly built live artifact again produces `UI=true -> deny`;
> otherwise resume the upstream-sync work when transport is
> available."* This ACT IS that reopen — the operator session
> reports exactly `UI=true -> deny` on a fresh build).
>
> **Owning epic**: [`EPIC-SAFE-YOLO-SEATBELT`](../../epics/safe-yolo-seatbelt.md)
> — the network-egress row (currently CLOSED) reopens as a
> downstream-recon row. This ACT does NOT contest the §15 freeze;
> the reopen is bounded to "the new live evidence is DOWNSTREAM of
> the policy seam, not AT it."
>
> **Mission (precise question)**:
>
> ```text
> sandboxBackend.prepare() should receive capability.network="allow";
> where between that boundary and the macOS kernel does the real live
> command regain network-deny semantics?
> ```
>
> The ACT captures, in order, the four facts on the production seam
> with one shared correlation id:
>
> ```text
> 1. StateManager.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork")
> 2. safeYoloCapabilitySource().network
> 3. CommandCapability.network at sandboxBackend.prepare
> 4. generated SBPL network clause (or absent)
> ```
>
> Expected (if persistence + capability + profile generation all hold):
>
> ```text
> true -> true -> "allow" -> "(allow network*)"
> ```
>
> The first value that diverges owns the bug. If all four hold and
> the kernel still returns `EPERM`, the failure is BELOW the
> profile boundary (substrate invocation / canonicalisation /
> sandbox-exec argv / SBPL->kernel ingestion / kernel policy
> enforcement), NOT above it.
>
> **Verdict framing (predeclared, not pre-decided)**:
>
> ```text
> NET01_ARTIFACT_IDENTITY_BINDING = REQUIRED (this §0 gate)
> NET01_DOWNSTREAM_DIVERGENCE    = OPEN (the question)
> NET01_SETTINGS_REPAIR           = NOT_AUTHORIZED (H2 frozen / not
>                                    the live cause; reviewed at §3)
> NET01_PROFILE_REPAIR            = NOT_AUTHORIZED_UNTIL_DOWNSTREAM_
>                                    DIVERGENCE_BOUND
> NET01_INVOCATION_REPAIR         = NOT_AUTHORIZED_UNTIL_PROFILE_BOUND
> UPSTREAM_SYNC_RECON             = PAUSED (per factory disposition)
> ```
>
> **Authorisation rule (carried from LIVE-REGRESSION01 reviewer
> disposition)**: do not reopen the H2 hydration ACT in this ACT;
> do not reopen the §15 product-contract freeze in this ACT; do
> not change user-facing Settings in this ACT.

## §0 - Frozen invariant (inherited)

Inherited verbatim from `ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01`
§0:

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

The §15 freeze (Option C with deny-default + explicit user
opt-in) is NOT contested by this ACT. The reopen is bounded to:
"when the user EXPLICITLY opts in via the Settings UI
(`clinemmSafeYoloAllowNetwork=true`) AND the runtime still
denies, where exactly is the divergence?"

## §1 - Artifact identity binding (REQUIRED gate before §2)

This §1 is the load-bearing gate. The reopen hypothesis
("fresh source-bound live artifact") is only valid if the
current repository state is byte-equivalent to the H2-repaired
commit and the live artifact was built from that source.

```text
SOURCE_HEAD                = fe3be36fed1fa354ed8bc0cb3cc36a30de29691a
                              (fix(settings): preserve absent Sandbox
                              capability state; merged at 2026-08-30)
SOURCE_PARENT              = b25636e6d1f9a949e71ac37dc08e91356e5063d2
                              (docs(factory): editor-tool live
                              qualification attempt + headless halt)
SOURCE_HEAD_TREE           = (capture at closure commit; recorded
                              in §15 commit list of the new closure
                              commit for this ACT)
SOURCE_WORKTREE_STATUS     = clean (verified at ACT open: `git
                              status --short` is empty; `git diff
                              --stat HEAD` is empty)
LIVE_ARTIFACT_HEAD         = NOT_VERIFIED_HERE (the operator
                              session that produced the live
                              `bind: Operation not permitted`
                              observation has not been verified
                              to be built from fe3be36fe in this
                              shell; the operator's evidence pack
                              MUST bind this before §2 opens; see
                              §1.1)
```

### §1.1 - Live artifact identity verification (operator-side, before §2 opens)

The operator must produce a four-line artifact-identity pack
bound to the live session that observed the failure. This is a
HARD GATE for §2 to open:

```text
VSIX_SHA256                       = <from the live session's installed extension>
INSTALLED_EXTENSION_PATH          = <from the live session>
SOURCE_dist/extension.js_SHA256    = <built from SOURCE_HEAD above; rebuild required>
INSTALLED_dist/extension.js_SHA256 = <from the live session's installed bundle>

SOURCE_INSTALLED_BYTE_EQUAL       = YES | NO
```

If `SOURCE_INSTALLED_BYTE_EQUAL = NO`:

```text
HALT_STALE_LIVE_ARTIFACT
  -> rebuild from SOURCE_HEAD = fe3be36fe
  -> reinstall
  -> re-run §1.1
  -> only then proceed to §2
```

This is not paranoia — it is the reviewer-prescribed
"freshly built live artifact" gate from
`ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01` §528-533
("next steps" rule).

### §1.2 - Why the binding matters (rationale)

`fe3be36fe` and `4be0d0d86` are the same logical change
(H2 hydration repair at the same parent
`b25636e6d1f9a949e71ac37dc08e91356e5063d2`); they differ only
in SHA due to amend/recreate discipline. The H2 repair landed
the schema-default change from `false` to `undefined` for
`clinemmSafeYoloAllowNetwork` so legacy absence stays
undefined through hydration. If the live artifact predates
this commit, the live failure is NOT source-bound and §2 must
HALT.

## §2 - Pipeline map (downstream of sandboxBackend.prepare)

The captured production seam, end-to-end, with the **four capture
points** this ACT discriminates on. Source citations are
read-only references to the current source tree at
`SOURCE_HEAD = fe3be36fe`.

```text
[1] StateManager.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork")
    ↳ apps/vscode/src/sdk/SdkController.ts:1216 (closure binding)
    ↳ apps/vscode/src/core/storage/StateManager.ts (read API)
    ↳ apps/vscode/src/shared/storage/state-keys.ts (key definition,
       defaults to undefined since fe3be36fe)

        ↓

[2] safeYoloCapabilitySource().network
    ↳ apps/vscode/src/sdk/SdkController.ts:1216 (closure:
       () => ({ network: ..., sshAgent: ... }))
    ↳ apps/vscode/src/sdk/command-job-manager.ts:639
       (const snap = this.safeYoloCapabilitySource())

        ↓

[3] CommandCapability.network at sandboxBackend.prepare boundary
    ↳ apps/vscode/src/sdk/sandbox-policy.ts:822-829
       (resolveSafeYoloCapabilityFromState: true->"allow",
        false->"deny", undefined->undefined)
    ↳ apps/vscode/src/sdk/command-job-manager.ts:640-646
       (resolveSafeYoloCapabilityFromState(snap) ->
        buildExperimentalReconCapability({networkOverride: ...}))
    ↳ apps/vscode/src/sdk/sandbox-policy.ts:693-694
       (network = networkFromOverride !== undefined
                  ? networkFromOverride
                  : resolveSafeYoloNetworkOptIn() === "allow"
                      ? "allow"
                      : "deny")
    ↳ apps/vscode/src/sdk/command-job-manager.ts:681-698
       (await backend.prepare({ capability: {...capability,
                  ...(createOnlyRootsForThisJob.length > 0
                      ? { createOnlyRoots: ... }
                      : {})},
                  command: {...} }))

        ↓

[4] generated SBPL network clause
    ↳ sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:274-279
       (buildNetworkRule: "deny" -> "(deny network*)",
        anything else -> "(allow network*)")
    ↳ sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:377-380
       (networkRule appended to profile lines if non-empty)
    ↳ sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts:402-417
       (generateSeatbeltProfile called with cap.network + canonicalised paths)
    ↳ sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts:435-450
       (profilePath written to temp dir; profilePath = join(profileDir,
        `profile-${randomBytes(6).toString("hex")}.sb`))

        ↓

[5] sandbox-exec invocation (out of §2 scope; downstream probe
    territory; §4)
    ↳ sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts:476-504
       (executable: SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";
        args: ["-f", profilePath, cmd.executable, ...cmd.args])

        ↓

[6] macOS kernel policy enforcement (out of §2 scope; downstream
    probe territory; §4)
    ↳ kernel sees the SBPL profile; (allow network*) -> connect() proceeds;
      (deny network*) -> connect() returns EPERM with sandbox_apply:
      Operation not permitted in stderr.
```

### §2.1 - Known-good capture witness (already proven)

The H2-repair ACT's CORRECTION02 c4-red-explicit-true-path test
captures **the exact [3] boundary** with the production closure
shape. Already proven in the current source tree at
SOURCE_HEAD = `fe3be36fe`:

```text
apps/vscode/src/sdk/__tests__/sandbox-capabilities-live-regression01
  .c4-red-explicit-true-path.test.ts:213-247
```

Witnesses (per the test):

```text
w1.safeYoloCapabilitySource().network   === true
                                         (production closure, verbatim
                                          from SdkController.ts:1216)
w2.backend.prepare.__captured.cap.network === "allow"
                                         (CommandCapability at the
                                          prepare boundary)
```

That is the [2] -> [3] arm. The H2 reviewer's c2-red-production-
chain test additionally proves [1] -> [2] -> [3] (real
StateManager round-trip). **The first two and a half capture
points are SOURCE_PROVEN as `[1]=true, [2]=true, [3]="allow"` in
the current source tree at fe3be36fe** — they cannot be the
defect.

The remaining half — [4] the generated SBPL network clause
on disk — is the **first seam that has NOT been live-captured
in a "true->profile"(allow) flow**. The seatbelt-profile.ts
generator is unit-tested with all three inputs but the
PRODUCTION-SEAM-generated profile file on disk has not been
SHA-bound to the upstream chain in any test.

## §3 - Capture protocol (HOST_REQUIRED)

Per the prior ACTs' `HOST_REQUIRED` modifier, this section
describes the **operator-side** capture sequence to be executed
on the darwin host that produced the live observation. The
captures are deterministic, bounded, and correlation-id-bound.

### §3.1 - Correlation identity

One run id per capture, formatted
`<RUN_ID>__<TIMESTAMP>` where `<RUN_ID>` is the operator's
chosen identifier and `<TIMESTAMP>` is `date -u +%Y%m%dT%H%M%SZ`.

### §3.2 - Capture sequence (four probes, one correlation id)

```text
[P1] StateManager cache read
     Location: post Settings UI toggle ON; before launching any command.
     Method:
       - In the operator's extension-host process (via VscodeSessionHost
         -> SdkController), capture the live value of
         StateManager.getGlobalSettingsKey("clinemmSafeYoloAllowNetwork").
       - The diagnostic hook is `ext.evaluate` in the debug harness
         with `awaitPromise: true`:
           globalThis.__clineDebugSafeYoloCapability?.()
         (Hook must be wired by an EXT-eval-only diagnostic in the
         extension host; this ACT does NOT introduce such a hook —
         the hook must be supplied by the operator's existing
         dev instrumentation, otherwise the capture is impossible
         and §2 remains unbinding.)
     Expected: true (the operator's claim is "UI toggle ON").
     If false: HALT — UI toggle is NOT persisted; §2 moot.

[P2] safeYoloCapabilitySource().network
     Location: same extension-host process; immediately before
     the next CommandJobManager.start call.
     Method:
       - Capture the closure's return value.
       - The closure is verbatim from SdkController.ts:1216.
     Expected: true (mirrors [P1]).
     If diverges from [P1]: HALT — cache<->closure seam defect;
       §2 finding: cache->closure.

[P3] CommandCapability.network at sandboxBackend.prepare
     Location: inside a CommandJobManager.start invocation.
     Method:
       - Instrument the production CommandJobManager with a
         capture backend (mirrors `makeCaptureBackend` in
         sandbox-capabilities-live-regression01.c4).
       - Trigger the operator's failing command verbatim.
       - Read capture.__captured.cap.network.
     Expected: "allow" (mirrors [P2] via resolveSafeYoloCapabilityFromState
       true -> "allow" -> networkFromOverride="allow" -> network="allow").
     If diverges: HALT — closure->capability seam defect;
       §2 finding: closure->capability.

[P4] Generated SBPL network clause
     Location: profilePath from the same backend.prepare.
     Method:
       - Capture profilePath (it is join(profileDir, `profile-<rand>.sb`)).
       - Read the file. Extract the line matching
         /^\(deny network\*\)$/ or /^\(allow network\*\)$/.
     Expected: (allow network*) (mirrors [P3] via buildNetworkRule
       which emits "(allow network*)" when network !== "deny").
     If diverges: HALT — capability->profile seam defect;
       §2 finding: capability->profile.

[P5] Live kernel outcome (out of §2 scope; first downstream probe)
     Location: the actual command's stderr/stdout/exit.
     Method:
       - Use the exact command from the operator's live failure
         (the dig/nslookup/curl that produced "bind: Operation
         not permitted").
       - Capture exit code, stdout, stderr, signal.
     Expected: command proceeds past the kernel EPERM (if [P4] is
       "(allow network*)"; if [P4] is "(deny network*)", the EPERM
       is policy-conforming and this §3 capture shows it).
```

### §3.3 - Capture decision table

The four-fact discriminator table for §2 closure (mirrors the
"D/A/O" pattern from prior recon ACTs):

```text
                | [P1]    | [P2]    | [P3]    | [P4]                | finding
                |----------|----------|----------|----------------------|-------------------
  CASE_ALLOW_OK | true     | true     | "allow"  | (allow network*)     | NET01_PASS_PROFILE_BOUND
                                                                              (then run §4 kernel)
  CASE_H2_LIVE  | true     | true     | "allow"  | (deny network*)      | NET01_PROFILE_GENERATOR_DEFECT
                                                                              (FIRST DOWNSTREAM DIVERGENCE)
  CASE_CLOSURE  | true     | true     | "deny"   | (deny network*)      | NET01_RESOLVE_REGRESSION
                                                                              (closure->capability defect,
                                                                               H2 analogous but distinct)
  CASE_CACHE    | true     | false    | "deny"   | (deny network*)      | NET01_CACHE_CLOSURE_DEFECT
                                                                               (cache<->closure seam)
  CASE_SETTINGS | false    | false    | "deny"   | (deny network*)      | SETTINGS_NOT_PERSISTED
                                                                              (UI is not the runtime source;
                                                                               §2 HALT)
  CASE_ALLOW_OK | any      | any      | any      | (allow network*)     | NET01_SUBSTRATE
   SUBSTRATE                                                                           (kernel denies despite allow;
                                                                                       down to §4)
```

### §3.4 - Required evidence files

Each run drops the following under
`.factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01/<RUN_ID>/`:

```text
correlation.txt             (RUN_ID + correlation timestamp + operator)
[P1]-state-cache.log        (raw return from StateManager)
[P2]-closure-return.log     (raw return from safeYoloCapabilitySource())
[P3]-prepare-cap.txt        (captured.cap.network, full snapshot if possible)
[P4]-profile.sb             (the actual generated SBPL, verbatim from profilePath)
[P4]-profile-network-rule.txt (extracted network line + sha256)
[P5]-live-kernel-stdout.log
[P5]-live-kernel-stderr.log
[P5]-live-kernel-exitcode.txt
env.txt                     (process.env snapshot from extension host;
                             CLINEMM_SAFE_YOLO_NETWORK, CLINEMM_EXPERIMENTAL_SANDBOX,
                             SSH_AUTH_SOCK if set, PATH minimum)
artifact-identity-pack.txt  (from §1.1; VSIX sha256, installed extension
                             sha256, source bundle sha256, byte-equal verdict)
```

## §4 - Downstream kernel ablation (HOST_REQUIRED)

Conditional on `§3 CASE_ALLOW_OK` (i.e., the upstream four
captures all read `allow` and the profile file on disk contains
`(allow network*)`). If §3 finds a divergence at [P2]/[P3]/[P4],
§4 does not open — the divergence owns the bug and §2 closes
with `PASS_PROFILE_BOUND` or one of the defect cases.

### §4.1 - Same-profile ablation on the live command

For the operator's failing command verbatim, run the same
profile through the same `sandbox-exec -f <profile> <cmd>`
invocation **outside** the extension-host loop, and discriminate
using a TCP probe (NOT ICMP / `ping` — `ping` uses raw
sockets and fails for reasons unrelated to ordinary TCP
egress denial; a clean TCP `connect()` is the canonical
discriminator). The probe should be mechanically identical
across all three cases except for the network axis:

```text
A  network="allow"  + same profile as [P4]
                    + same cwd, same env
                    + same destination (e.g. 1.1.1.1:443)
                    -> nc -vz -w 3 1.1.1.1 443 succeeds past Seatbelt

B  network="deny"   + regenerated profile with (deny network*)
                    + same cwd, same env, same destination
                    -> nc -vz -w 3 1.1.1.1 443 returns EPERM
                       (policy-conforming)

C  no Seatbelt envelope (sandbox off; CLINEMM_EXPERIMENTAL_SANDBOX=off)
                    + same cwd, same env, same destination
                    -> nc -vz -w 3 1.1.1.1 443 succeeds (no kernel denial)
```

The operator may use `curl -fsS --max-time 3 https://1.1.1.1/`
as a richer alternative probe; the discriminator must remain
"TCP connect/handshake succeeded" vs "TCP denied at connect
syscall" — anything that adds application-layer DNS / TLS
noise may obscure the kernel-level signal we are trying to
isolate.

Required discriminators (mirrors the §6 necessity table from
`ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01`):

```text
A TCP succeeds, B TCP EPERM, C TCP succeeds
    -> Network selector works. The production executor's
      sandbox-exec invocation must be doing something wrong
      (argv mismatch / wrong profilePath / wrong env / different
      cwd / wrong backend). First divergence: invocation.

A TCP succeeds, C TCP EPERM
    -> Suspicious: the host blocks network at the substrate level
      even without Seatbelt. External host/network substrate
      defect (firewall, DNS, TLS, etc). NOT a ClineMM defect.

A TCP EPERM, B TCP EPERM, C TCP succeeds
    -> Seatbelt allow profile/path defective (but §3 [P4] showed
      the profile file contains "(allow network*)" — so this
      case is the most likely DOWNSTREAM profile-loading defect).
      First divergence: SBPL->kernel ingestion.

A TCP EPERM, B TCP EPERM, C TCP EPERM
    -> External host/network substrate defect. NOT a ClineMM defect.

A TCP succeeds, B TCP EPERM, C TCP EPERM
    -> SUSPICIOUS — sandbox-exec invocation diverges from
      outside-Sandbox invocation. Investigate argv identity and
      profile loading order.

D TCP succeeds (i.e. the deny case A actually connects)
    -> Deny policy itself broken. NEW P0 — escalate immediately;
      the runtime is allowing network egress despite the deny
      profile, which means profile generation OR the Seatbelt
      kernel enforcement is leaking authority upward. Capture
      this case as a SEPARATE defect, distinct from the
      down-stream "deny-when-allow" failure the operator
      reported.
```

### §4.2 - Existing real-kernel probes (already on disk)

The following real-kernel tests already exercise the full
production seam and already pass on a substrate-eligible host:

```text
apps/vscode/src/sdk/__tests__/darwin-seatbelt-safe-yolo-network-open01
  .c1-green.test.ts (REAL PRODUCTION SEAM, lines 217-249)
  -> drives CommandJobManager.start with CLINEMM_SAFE_YOLO_NETWORK=allow
    and a parent-owned TCP listener; the child script's stdout
    discriminates `CONNECTED:${TOKEN}\n` vs `DENIED\n`.
  -> substrate-gated via describe.skipIf(!HAS_SUBSTRATE).

apps/vscode/src/sdk/__tests__/darwin-seatbelt-default-on-real-kernel01
  .c1-green.test.ts (REAL kernel, sandbox default ON)
  -> the companion default-on kernel matrix.
```

These prove the **legacy env-only path** works on a
substrate-eligible host. They do NOT prove the
**persisted-Settings path** (i.e., `safeYoloCapabilitySource()
= { network: true }` flow), which is the seam the operator's
live failure exercises. The §4 ablation matrix above is
designed to bound the persisted-Settings path on the same
real kernel.

## §5 - RED (NOT_AUTHORIZED at open)

This ACT opens as RECON, not as RED. A RED is only authorised
at §5 closure if §3 and §4 find a defect:

```text
[scenario]                          | authorised RED
------------------------------------|--------------------------------------
§3 CASE_H2_LIVE  (profile generator | YES — RED targets
defect: cap.network="allow" but     | seatbelt-profile.ts buildNetworkRule
profile contains "(deny network*)") | OR the seatbelt-backend.ts compose
                                    | path
§3 CASE_CLOSURE  (closure seam      | YES — RED targets the closure shape
defect: cap.network="deny" despite  | in SdkController.ts / vscode-session-
UI=true / closure=true)             | host.ts / sandbox-policy.ts
§3 CASE_CACHE    (cache<->closure   | YES — RED targets StateManager
seam defect: cache=true but         | getGlobalSettingsKey or the closure
closure=false)                      | binding
§3 CASE_SETTINGS (UI not persisted) | DEFER to upstream-settings-parity
                                    | recon (this is a UI round-trip
                                    | defect, out of §5 scope)
§3 CASE_ALLOW_OK + §4 case A EPERM  | YES — RED targets the sandbox-exec
(production allow profile but       | invocation path or the SBPL->kernel
kernel denies)                      | ingestion in seatbelt-backend.ts
§3 CASE_ALLOW_OK + §4 case C EPERM  | NO — external host/network substrate;
(external host blocks network)      | not a ClineMM defect
```

§5 RED is `NOT_AUTHORIZED` at ACT OPEN. Authorisation happens
at §5 closure once §3 + §4 results land.

## §6 - Repair (NOT_AUTHORIZED at open)

§7 in the predecessor ACT was `SUPERSEDED_BY_§15_FREEZE` and
this ACT does not reopen that freeze. Any repair authorised
by §5 will be **bounded to the downstream seam identified by
the §3 + §4 finding** — never touching:

- the H2 hydration schema defaults (`undefined` is FROZEN)
- the §15 product contract (Option C / deny-default / explicit
  user opt-in is FROZEN)
- the Settings UI surface (out of scope for this ACT)
- the upstream-sync path (paused per factory disposition)

## §7 - Closure form (predeclared)

At closure, this ACT will assert exactly one of:

```text
PASS_PROFILE_BOUND_NO_DOWNSTREAM_DEFECT
  (CASE_ALLOW_OK + §4 case A succeeds + §4 case C succeeds)
  -> closure without repair; the production seam is correct
    end-to-end; the live failure was either substrate-unrelated
    (kernel/firewall/TLS/DNS) or §1.1 was NOT_BYTE_EQUAL and
    the live artifact was stale.

PASS_PROFILE_BOUND_WITH_SUBSTRATE_FINDING
  (CASE_ALLOW_OK + §4 case A succeeds + §4 case C EPERM)
  -> closure WITHOUT ClineMM repair; the substrate blocks network
    for reasons outside ClineMM's authority; the live failure
    is non-actionable inside the product.

NET01_PROFILE_GENERATOR_DEFECT_FOUND
  (CASE_H2_LIVE)
  -> RED + bounded repair at seatbelt-profile.ts:274-279 +
    maybe seatbelt-backend.ts:402-417; ship a CORRECTION01 ACT.

NET01_CLOSURE_SEAM_DEFECT_FOUND
  (CASE_CLOSURE)
  -> RED + bounded repair at SdkController.ts:1216 closure
    composition OR sandbox-policy.ts:693-694 precedence
    between networkFromOverride and env fallback.

NET01_CACHE_CLOSURE_DEFECT_FOUND
  (CASE_CACHE)
  -> RED + bounded repair at StateManager getGlobalSettingsKey
    or the closure binding.

NET01_INVOCATION_REPAIR_FOUND
  (CASE_ALLOW_OK + §4 case A EPERM + §4 case C succeeds)
  -> RED + bounded repair at sandbox-exec argv assembly
    (seatbelt-backend.ts:476-484) or cwd/env composition
    downstream of prepare.

HALT_STALE_LIVE_ARTIFACT
  (§1.1 SOURCE_INSTALLED_BYTE_EQUAL = NO)
  -> ACT HALTED until rebuild + reinstall + re-run §1.1.
```

## §14 - Live qualification (HOST_REQUIRED)

Per `.factory/epics/_index-contract.md` §2 status vocabulary
modifier, the §3 capture protocol and the §4 ablation matrix
are `HOST_REQUIRED`. They require:

- a substrate-eligible shell (Terminal.app / iTerm2 /
  debug harness); NOT a VSCodium-descended shell
- a freshly built live artifact (the §1.1 gate)
- the persisted `clinemmSafeYoloAllowNetwork = true` in the
  Settings UI (the operator's claim)
- a `correlation.txt` per run

This shell (`/Volumes/UserData/.../clinemm` on darwin but
descended from a sandboxed editor process) is
`HOST_SUBSTRATE_UNAVAILABLE` for the live half — same posture
as `ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01` §4
`HALT_HOST_SUBSTRATE_UNAVAILABLE` and
`ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01`
`FULL_HOST_PATH = NOT_EXECUTED`. The structural evidence
(§2 pipeline map + §3.4 evidence format + §4.2 existing
real-kernel probes) is authored in this shell; the
captures are operator-executed.

## §15 - Closure commit list

To be authored at ACT closure. Per the precedent of
`ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01` §463-495,
the closure commit will carry:

- the verdict (one of §7)
- the §1.1 artifact-identity pack SHA256s (source SHA,
  installed bundle SHA, byte-equal verdict)
- the §3 + §4 capture-pack filenames and sha256s
- the targeted source files (if any repair lands)
- the test surface additions and PASS counts
- the typecheck/lint residue posture

## §17 - Commit / freeze plan

This ACT opens with the §1.1 gate unfilled. The operator must
produce the artifact-identity pack before §2 opens. Until
then, the ACT is in the same posture as the prior
LIVE-REGRESSION01 closure commit's
`CURRENT_REPAIRED_SOURCE_LIVE_ARTIFACT = NOT_BUILT` —
**the source is ready, the live verification is operator-
bound**.

## §18 - Out of scope (carried forward)

The following are EXPLICITLY out of scope for this ACT and
must NOT be touched in any closure commit:

1. **H2 hydration schema defaults** (`undefined` for both
   `clinemmSafeYoloAllowNetwork` and
   `clinemmSafeYoloAllowSshAgent`): FROZEN by
   `ACT-CLINEMM-SANDBOX-CAPABILITIES-LIVE-REGRESSION01`
   CORRECTION02.
2. **§15 product contract** (Option C / deny-default /
   explicit user opt-in): FROZEN by
   `ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01` §15.
3. **Settings UI surface** (`SandboxCapabilitiesSection.tsx`):
   owned by
   `ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01`
   V2 closure; reopen only via upstream-settings-parity recon.
4. **Upstream sync** (transport-bound): PAUSED per factory
   disposition; resume when transport available.
5. **Legacy env path** (`resolveSafeYoloNetworkOptIn`): FROZEN
   in legacy back-compat posture; may be referenced in §4
   ablation matrix but not changed.
6. **Seatbelt `auto-approve all` axis** (independent of network
   axis per §0 frozen invariant): FROZEN.
7. **ssh-agent authority** (`ACT-CLINEMM-SEATBELT-SSH-AGENT-
   AUTHORITY-IMPLEMENTATION01`): independent ACT family;
   not touched.
8. **Workspace-write contract** (`ACT-CLINEMM-SAFE-YOLO-
   WORKSPACE-WRITE01`): independent ACT family; not touched.

## §19 - Operator runbook (terminal-quality)

For an operator who wants to drive §3 captures on a
substrate-eligible host:

```bash
# 0. From a substrate-eligible shell (Terminal.app / iTerm2 /
#    debug harness), NOT a sandboxed editor descendant:

cd /path/to/clinemm

# 1. Verify the source HEAD and worktree:
git log -1 --format='%H %s'
# Expected: fe3be36fed1fa354ed8bc0cb3cc36a30de29691a fix(settings): preserve absent Sandbox capability state
git status --short
# Expected: empty

# 2. Build the extension from the verified source:
IS_DEV=true bun esbuild.mjs

# 3. Compute source bundle SHA:
shasum -a 256 dist/extension.js > /tmp/source-bundle.sha256

# 4. Install the bundle in the operator's VS Code user data dir;
#    compute installed bundle SHA:
cp dist/extension.js \
   ~/.vscode/extensions/s1onique.clinemm-4.1.10/dist/extension.js
shasum -a 256 \
   ~/.vscode/extensions/s1onique.clinemm-4.1.10/dist/extension.js \
   > /tmp/installed-bundle.sha256

# 5. Compare:
diff /tmp/source-bundle.sha256 /tmp/installed-bundle.sha256 \
   && echo BYTE_EQUAL=YES \
   || echo BYTE_EQUAL=NO
```

```bash
# 6. Launch VS Code; open Cline; toggle the "Allow outbound
#    network" Settings UI switch to ON; observe the chat row
#    that runs dig / nslookup / curl.

# 7. While the failing command runs, capture:
#    - [P1] StateManager cache value (via ext.evaluate with the
#           diagnostic hook the operator supplies)
#    - [P2] safeYoloCapabilitySource().network (same hook)
#    - [P3] CommandCapability.network at sandboxBackend.prepare
#           (same hook, or a capture backend mirroring the
#           existing c4 test pattern)
#    - [P4] Generated SBPL network clause (read profilePath
#           the hook captures)
#    - [P5] Live kernel outcome (the failing command's actual
#           exit code + stdout + stderr)

# 8. Drop the captures under
#    .factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-LIVE-
#    DOWNSTREAM-RECON01/<RUN_ID>/ per §3.4.

# 9. If §3 finds a divergence at [P2]/[P3]/[P4], the §2 finding
#    is bound; close the ACT with the matching §7 verdict and
#    a targeted repair commit.

# 10. If §3 finds the upstream four holds and the kernel still
#     denies, run §4 same-profile ablation on the operator's
#     host; close with the matching §7 verdict.

# 11. If §1.5 BYTE_EQUAL=NO, halt and rebuild — the source
#     is correct but the live artifact is stale.
```

This runbook is terminal-quality: an operator with the
source tree, a substrate-eligible shell, and the operator's
own diagnostic hook can drive §3 + §4 without further
factory-side intervention.

## §20 - Status (open)

```text
ACT_ID                              = ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01
OPEN_HEAD                           = fe3be36fed1fa354ed8bc0cb3cc36a30de29691a
OPEN_TREE                           = (capture at closure commit)
WORKTREE_STATUS                     = clean (verified at ACT open)
ARTIFACT_IDENTITY                   = UNBOUND_PENDING_§1.1 (operator-side;
                                     §1.1 requires the operator to
                                     produce the VSIX/source/installed-
                                     bundle identity pack before §2
                                     opens; the reopen IS source-bound
                                     on the SOURCE_HEAD side but is NOT
                                     yet bound to any operator-side
                                     installed extension bundle)
PIPELINE_MAP                        = PASS_SOURCE_BOUND (§2 structural)
EVIDENCE_FILES                      = DIRECTORY_CREATED (.factory/evidence/
                                     ACT-CLINEMM-SEATBELT-NETWORK-LIVE-
                                     DOWNSTREAM-RECON01/ exists; empty
                                     at ACT open; populated per §3.4)
PRODUCTION_SEAM_TEST                = SOURCE_PROVEN_2_OF_4
                                     ([P2]/[P3] proven via existing
                                      c4-red-explicit-true-path test;
                                      [P1] proven via c2-red-production-
                                      chain test; [P4] structurally
                                      proven via seatbelt-profile.test.ts
                                      but NOT in the production-seam
                                      flow)
LIVE_KERNEL_TEST                    = NOT_EXECUTED (HOST_REQUIRED;
                                     this shell is substrate-unavailable
                                     for the production-seam live half)
SETTINGS_REPAIR                     = NOT_AUTHORIZED (H2 closed)
PROFILE_REPAIR                      = NOT_AUTHORIZED_UNTIL_DOWNSTREAM_DIVERGENCE_BOUND
INVOCATION_REPAIR                   = NOT_AUTHORIZED_UNTIL_PROFILE_BOUND
UPSTREAM_SYNC                       = PAUSED
```
