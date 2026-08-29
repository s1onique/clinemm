# ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01

> **Status**: **OPEN / HIGH** (P1) — opens immediately at closure of
> `ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01`
> (`CLOSED / PASS_SEATBELT_SSH_AGENT_AUTHORITY_PRODUCT_POLICY_REPAIR_V1`,
> `IMPLEMENTATION_RED = AUTHORIZED`).
>
> **Contract authority**: `ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01`
> §15 (FROZEN). This ACT inherits the product policy verbatim and
> MAY challenge feasibility only through RED/executable evidence;
> renegotiating the product policy requires a new recon ACT.
>
> **Predecessor**: `ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01`
> (CLOSED) + `ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01` (OPEN /
> POLICY_INTENT_UNBOUND — provides the live network-egress mechanism
> evidence that unblocks this ACT's §RED execution).
>
> **Owning epic**: [`EPIC-SAFE-YOLO-SEATBELT`](../../epics/safe-yolo-seatbelt.md).
> SSH / GnuPG / macOS-keychain are inside the V1 sensitive-read boundary
> of this epic.
>
> **Verdict (target)**: `PASS_SEATBELT_SSH_AGENT_AUTHORITY_V1`.

## §0 — Inherited frozen contract

This ACT does NOT re-derive the contract. The contract is
**FROZEN** at `ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01`
§15. The implementation MUST honor it verbatim:

```text
sshAuthenticationAuthority = deny | agent

DEFAULT
  deny
  SSH_AUTH_SOCK stripped
  raw SSH private keys denied (PRESERVE V1)
  no ssh-agent socket authority

AGENT
  SSH_AUTH_SOCK explicitly reintroduced via
    the capability env allow-list (step 3 of
    `materializeEnvironment` wins over step 4)
  SSH_AGENT_PID still stripped by default
  AF_UNIX system-socket permitted (only the
    AF_UNIX socket() syscall; no other families)
  network-outbound allowed ONLY to:
    path-literal(canonical SSH_AUTH_SOCK)
  canonical = realpath-resolved at capability
    construction time

PRESERVE (across both modes)
  ~/.ssh/id_rsa / id_ed25519 / id_ecdsa /
    id_mldsa44_ed25519 unreadable
  sibling Unix sockets inaccessible
  parent directory gains no filesystem write
    authority and no other socket authority
  unrelated secrets (AWS_*, AZURE_*,
    GITHUB_TOKEN, …) remain stripped
  SECRET_BLOCKLIST globally unchanged
  no executable-name special casing
  no readwritePaths widening
  raw-key reads denied in BOTH modes

SUBSTRATE gate for executable qualification
  of this contract: probeSeatbeltAvailability() === true
  (file presence + round-trip probe of
   (version 1)(allow default) /usr/bin/true
   within the 5-second budget at
   sdk/packages/core/src/runtime/sandbox/macos/
   seatbelt-availability.ts)
```

## §1 — Mission

Implement the frozen contract and prove it executable:

1. Extend `CommandCapability` (`sdk/packages/core/src/runtime/sandbox/types.ts`)
   with `sshAuthenticationAuthority: undefined | { mode: "agent", resolvedAuthSock }`.
2. Wire the Seatbelt backend (`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts`)
   to emit the agent-mode AF_UNIX rules in `§5.1` of the recon contract.
3. Ensure `materializeEnvironment`
   (`sdk/packages/core/src/runtime/sandbox/environment.ts`) reintroduces
   `SSH_AUTH_SOCK` ONLY when the capability explicitly enables agent mode.
4. Add RED + GREEN + conservation tests on a substrate-eligible shell
   (`probeSeatbeltAvailability() === true`).
5. Do **NOT** add `readonly`-identity-file mode in V1 — OUT OF SCOPE.

## §2 — Phases

### §2.1 — Phase 1: RED tests (substrate-gated)

First load-bearing RED — the conjunction, not a single SBPL string test:

```text
agent mode + valid SSH_AUTH_SOCK + substrate
  → child env contains SSH_AUTH_SOCK
  → exact agent socket connect succeeds
  → sibling socket connect fails
  → ~/.ssh/id_rsa remains unreadable
```

Per the reviewer's "Keep SSH-12/SSH-13 executable" guidance, the
implementation progression is:

```text
contract freeze (already done in RECON01)
  → RED profile/parser test (does sandbox-exec accept the profile?)
  → RED exact-socket connect (does the child reach the agent?)
  → GREEN
  → sibling-socket negative (does a sibling fail closed?)
  → raw-key conservation (does id_rsa still EPERM?)
  → real ssh-agent qualification (does ssh auth succeed through agent?)
```

A failure at any step must first discriminate:

```text
profile syntax failure   (escapeSbplString; SBPL parse)
  vs
socket() authority failure  (system-socket rule missing)
  vs
connect() authority failure  (path-literal rule not matching)
  vs
environment propagation failure  (SSH_AUTH_SOCK not in allow list)
```

Do NOT weaken to `subpath` merely because the first profile attempt
behaves unexpectedly. Current Codex intentionally uses `subpath` because
its API grants roots/directories, which is a broader semantic than the
exact-agent-socket contract.

### §2.2 — Phase 2: GREEN implementation

#### §2.2.1 — Capability extension

In `sdk/packages/core/src/runtime/sandbox/types.ts`, add:

```typescript
/**
 * SSH authentication authority — orthogonal to network egress.
 *
 * FROZEN per ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01 §15.
 *
 *   undefined        → DEFAULT (deny). SSH_AUTH_SOCK stripped,
 *                      no ssh-agent socket authority.
 *   { mode: "agent" } → explicit AGENT mode. The backend:
 *                        (a) reintroduces SSH_AUTH_SOCK via the
 *                            env allow list (step 3 of
 *                            materializeEnvironment wins over step 4);
 *                        (b) emits `(allow system-socket
 *                            (socket-domain AF_UNIX))`;
 *                        (c) emits `(allow network-outbound
 *                            (remote unix-socket
 *                             (path-literal "<resolved>")))`.
 *                      SSH_AGENT_PID remains stripped unless

#### §2.2.2 — Seatbelt profile emission

In `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts`:

1. Add a private helper `buildAgentSshRule(capability)` that:
   - returns empty string when capability.sshAuthenticationAuthority
     is undefined;
   - emits exactly the two SBPL rules from RECON01 §5.1:
     ```scheme
     (allow system-socket (socket-domain AF_UNIX))
     (allow network-outbound
       (remote unix-socket
         (path-literal "<RESOLVED_AUTH_SOCK>")))
     ```
   - re-canonicalizes `resolvedAuthSock` through `realpathSync` as
     a fail-closed gate (the caller MUST also canonicalize at
     capability construction, but the backend canonicalizes again
     so a buggy caller cannot inject a non-canonical pathname);
   - uses the existing `escapeSbplString` helper for the literal
     embedding (no new escape primitive needed).

2. In `generateSeatbeltProfile`, append the agent SSH rule after the
   existing network rule:

   ```typescript
   const sshRule = buildAgentSshRule(capability);
   const parts = [
     /* version + deny default + process + file rules + network */
     ...,
     sshRule,
   ].filter((p) => p.length > 0);
   ```

3. Critically: do NOT widen to `subpath`, do NOT emit a `(allow
   file-read*)` for the launchd socket parent directory, do NOT
   add the parent directory to `writableRoots` / `readwritePaths`
   / `createOnlyRoots`. The narrow-grant invariant (SSH-12) depends
   on the parent directory remaining untouched.

#### §2.2.3 — Environment reintroduction

In `sdk/packages/core/src/runtime/sandbox/environment.ts`:

1. Confirm `SSH_AUTH_SOCK` is in `SECRET_BLOCKLIST`
   (already true at line 105 of the current file).
2. Confirm step 3 of `materializeEnvironment` (caller-provided
   `allow` list) wins over step 4 (blocklist emptier). This is
   the FACT that enables the agent capability.
3. The CALLER of `materializeEnvironment` (the agent-mode
   capability path) MUST include `SSH_AUTH_SOCK` in
   `capability.environment.allow` when
   `capability.sshAuthenticationAuthority.mode === "agent"`.

   Concretely, in the command-capability construction site for
   agent mode, prepend `"SSH_AUTH_SOCK"` to the existing
   `allow` list. Do NOT modify `SECRET_BLOCKLIST` globally.

### §2.3 — Phase 3: Conservation suite (SSH-01..SSH-14)

Reuse the recon §16 conservation matrix. Test IDs and assertions:

| ID | Test | Direction |
|---|---|---|
| SSH-01 | default mode → `cat ~/.ssh/id_rsa` returns EPERM | PRESERVE |
| SSH-02 | network-allow alone → raw key reads still EPERM | PRESERVE |
| SSH-03 | agent mode → `env \| grep SSH_AUTH_SOCK` shows the resolved path | NEW |
| SSH-04 | agent mode → `nc -U <resolvedAuthSock>` connect succeeds | NEW |
| SSH-05 | agent mode → `ssh -o BatchMode=yes ubuntu@host` succeeds | NEW |
| SSH-06 | agent mode → `cat ~/.ssh/id_rsa` still EPERM | NEW |
| SSH-07 | agent mode → `env \| grep AWS_` shows nothing | NEW |
| SSH-08 | agent mode + stale/wrong SSH_AUTH_SOCK → child connect fails closed | NEW |
| SSH-09 | flip agent OFF after ON → env stripped, socket authority gone | NEW |
| SSH-10 | agent mode → no executable-name special casing in profile | invariant |
| SSH-11 | sandbox OFF historical behavior unchanged | invariant |
| SSH-12 | agent mode → sibling Unix socket in same parent dir NOT reachable | NEW (load-bearing) |
| SSH-13 | agent mode → resolved path's parent dir NOT writable | NEW |
| SSH-14 | agent mode → no raw key bytes leak through agent capability | invariant |

### §2.4 — Phase 4: Substrate gate

All RED tests must gate on `probeSeatbeltAvailability() === true`:

```typescript
import { describe, it, expect } from "bun:test";

## §3 — Forbidden repairs

These are out of scope for V1 and MUST NOT be added:

1. `readonly`-identity-file mode (per RECON01 §15 — OUT OF SCOPE).
2. Weakening `SECRET_BLOCKLIST` globally.
3. Adding the launchd socket parent directory to `writableRoots`,
   `readwritePaths`, or `createOnlyRoots`.
4. Falling back from `path-literal` to `subpath` "to make the
   test pass." If a platform primitive behaves unexpectedly,
   discriminate (`profile syntax failure` vs `socket() authority`
   vs `connect() authority` vs `environment propagation`) and fix
   the right layer; do NOT widen the grant.
5. Executable-name special casing (`if exec === "ssh" { … }`).
   The capability is capability-based, not executable-based.
6. Re-introducing `SSH_AGENT_PID` by default — it stays stripped
   unless explicitly added to the allow list.

## §4 — Stop rules

Stop and revert any change that:

1. Causes raw-key reads to succeed in either mode (SSH-01/02/06).
2. Causes sibling Unix sockets under the same parent directory to
   become reachable (SSH-12).
3. Causes parent directory of `SSH_AUTH_SOCK` to gain any
   filesystem authority (SSH-13).
4. Removes or weakens `SECRET_BLOCKLIST`.
5. Adds the SSH_AUTH_SOCK parent directory to ANY filesystem grant
   list.

## §5 — Substrate-gate log (HOST_REQUIRED)

This ACT owns the executable RED; it MUST be executed on a
substrate-eligible shell (Terminal.app / iTerm2 / debug-harness).
The current VSCodium session reports
`probeSeatbeltAvailability() === false` (file present, but the
round-trip probe returns EPERM because the shell is itself nested-
sandboxed). Per the recon contract, this is a substrate-gating
fact, not a code defect.

When this ACT is launched on a substrate-eligible shell, capture
exact-head evidence under
`.factory/evidence/ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01/§5-substrate-gate/`
following the same layout as
`.factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01/§4-host-ablation/`.

## §6 — Exit states

```text
CLOSED / PASS_SEATBELT_SSH_AGENT_AUTHORITY_V1
  required: all RED + GREEN + conservation tests pass on a
            substrate-eligible shell; exact-head evidence captured
  required: SSH-12 and SSH-13 negative tests pass (sibling
            socket denied; parent dir not writable)
  required: SSH-08 and SSH-09 negative tests pass (stale
            socket fails closed; flip OFF removes authority)
  required: SECRET_BLOCKLIST unchanged
  required: no readwritePaths / createOnlyRoots widening
  required: no `readonly`-identity-file mode added

DEFERRED
  only if product policy changes (a new recon ACT)
```

## §7 — Acceptance criteria

1. `CommandCapability.sshAuthenticationAuthority` field present
   with the closed union `undefined | { mode: "agent",
   resolvedAuthSock }`.
2. Seatbelt backend emits the two-rule agent SSH pair exactly as
   RECON01 §5.1 specifies, with `path-literal` (NOT filesystem
   `literal`, NOT `subpath`).
3. `materializeEnvironment` reintroduces `SSH_AUTH_SOCK` only when
   the capability's env allow list contains it (step 3 wins over
   step 4); `SSH_AUTH_SOCK` stays in `SECRET_BLOCKLIST`.
4. Substrate-gated RED suite passes on Terminal.app / iTerm2 /
   debug-harness for SSH-03..SSH-14.
5. `readonly`-identity-file mode is NOT added.
6. `SECRET_BLOCKLIST` is unchanged.
7. No launchd socket parent directory is added to any filesystem
   grant list.

## §8 — Provenance

Recon subject (RECON01 ENTRY_HEAD): `911d02177` (the commit that
closed the network-egress §4 correction).

RECON01 closure commit: `<populated at RECON01 closure commit>`.

This ACT opens at RECON01 closure. The handoff is bounded by
RECON01 §15 — no renegotiation permitted.

Exact-head evidence, substrate-gate log, RED/GREEN results, and
sibling-socket negative evidence will be captured under
`.factory/evidence/ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01/`
when this ACT is launched on a substrate-eligible shell.

## §I — Entry-discipline audit trail

```text
<reserved; populated at first commit and at ACT-only commits>
```

import { probeSeatbeltAvailability } from
    "@/runtime/sandbox/macos/seatbelt-availability";

const HAS_SUBSTRATE = probeSeatbeltAvailability();

describe.skipIf(!HAS_SUBSTRATE)(
    "sshAuthenticationAuthority agent mode",
    () => {
        it("SSH-03: SSH_AUTH_SOCK present in child env", ...);
        it("SSH-04: exact agent socket connect succeeds", ...);
        it("SSH-05: ssh authenticates through agent", ...);
        it("SSH-06: ~/.ssh/id_rsa still unreadable", ...);
        it("SSH-07: unrelated secrets still stripped", ...);
        it("SSH-08: stale SSH_AUTH_SOCK fails closed", ...);
        it("SSH-09: capability OFF → env/socket gone", ...);
        it("SSH-12: sibling socket NOT reachable", ...);
        it("SSH-13: parent dir NOT writable", ...);
    }
);
```

The substrate-gated test pattern is reused from
`apps/vscode/src/sdk/__tests__/seatbelt-network-egress-recon01.c4-real-kernel-three-point.test.ts`
(HAS_SUBSTRATE pattern).

On this VSCodium session `probeSeatbeltAvailability() === false` —
the tests will `skipIf` and the implementation MUST be re-exercised
on Terminal.app / iTerm2 / debug-harness before closure.

 *                      explicitly added to the allow list.
 *
 * `resolvedAuthSock` MUST be canonical (realpath-resolved) at
 * capability construction time. Re-resolution per-invocation is
 * INCORRECT — the agent socket is per-host-session.
 */
export type SshAuthenticationAuthority =
    | undefined
    | { readonly mode: "agent"; readonly resolvedAuthSock: string };

export interface CommandCapability {
    readonly readonlyRoots: readonly string[];
    readonly writableRoots: readonly string[];
    readonly denyReadSubpaths?: readonly string[];
    readonly network: SandboxNetwork;
    readonly environment: EnvironmentCapability;
    readonly cwd?: string;
    readonly tempRoot?: string;
    readonly createOnlyRoots?: readonly string[];
    readonly sshAuthenticationAuthority?: SshAuthenticationAuthority;
}
```

The capability field is OPTIONAL. Existing call sites that omit it
get the DEFAULT (deny) behavior — no migration required for V1
non-SSH-agent callers.

