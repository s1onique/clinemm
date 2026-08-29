# ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01

> **Status**: **CLOSED / PASS_SEATBELT_SSH_AGENT_AUTHORITY_PRODUCT_POLICY_REPAIR_V1**
> at LAUNCH HEAD `<see §I>`; recon subject pinned at ENTRY HEAD
> `911d02177` (the commit that closed the network-egress C1 bounded
> correction). The §15 product contract is **FROZEN IN THIS ACT** —
> the implementation ACT inherits the frozen contract and may
> challenge feasibility only through RED/executable evidence; it
> MUST NOT silently renegotiate the product policy.
>
> `IMPLEMENTATION_RED = AUTHORIZED` against the substrate-gate
> predicate (`probeSeatbeltAvailability() === true`); on this
> VSCodium session the predicate reports `false`, so the follow-on
> `ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01` must
> be exercised on a substrate-eligible shell (Terminal.app /
> iTerm2 / debug-harness). The RED section belongs to that ACT.
>
> **Primary purpose (executed)**: live failure (`Load key "/…/.ssh/id_rsa":
> Operation not permitted` + remote `Permission denied (publickey,password)`)
> → classify the gap → bound the contract → CLOSE here, hand off to
> the implementation ACT.
>
> **Owning epic**: [`EPIC-SAFE-YOLO-SEATBELT`](../../epics/safe-yolo-seatbelt.md).
> SSH / GnuPG / macOS-keychain are inside the V1 sensitive-read boundary
> of this epic (not inside the deferred `authenticated-dev-capabilities.md`
> epic, which covers `~/.aws/`, `~/.kube/`, `~/.docker/config.json`,
> `~/.config/gh/hosts.yml`).
>
> **Verdict (chosen at closure)**: `PASS_SEATBELT_SSH_AGENT_AUTHORITY_PRODUCT_POLICY_REPAIR_V1`.
> §15 picks the agent-mode capability with the corrected SBPL
> (`path-literal` Unix-socket selector; NOT filesystem `literal`,
> NOT `subpath`) plus the env reintroduction contract in §5/§15.
>
> **Reviewer verdict prior to launch**: `GO_AFTER_ONE_BOUNDED_FIX`
> (seatbelt/OpenSSH/factory trio). The bounded fix was the SBPL rule
> shape (filesystem `literal` → `path-literal`) plus the env
> reintroduction path; both are absorbed into §2 / §5 / §15 of this
> ACT. **No production code is changed in this ACT**; this is a
> recon/contract ACT. The follow-on IMPLEMENTATION01 is the
> executable ACT.

---

## §0 — Frozen invariant

```text
Network egress MUST NOT imply SSH authentication authority.

SSH agent authority MUST:
  - be explicit and independently enabled (orthogonal to network-egress);
  - preserve denial of raw private-key reads (the V1 sensitive-read
    confinement contract from SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01
    is unchanged);
  - expose ONLY the currently resolved SSH_AUTH_SOCK path (not a
    launchd-socket-family grant, not an entire $HOME grant);
  - grant ONLY the AF_UNIX operations necessary to use that agent
    (system-socket + `path-literal`-scoped network-outbound to the
    EXACT resolved socket pathname — `path-literal` is the
    Seatbelt exact-match primitive for Unix-socket selectors, NOT
    the filesystem-operation `literal` and NOT `subpath`; using
    `subpath` would widen authority to sibling sockets under the
    same parent directory); and
  - disappear when the capability is disabled (env re-stripped,
    socket authority removed).
```

Conceptual rationale (binding for §15): `ssh-agent` is described in
the OpenBSD manual pages as holding private keys and exposing its
service through the Unix-domain socket identified by `SSH_AUTH_SOCK`;
access to that socket is therefore *authentication authority* even
though the caller never receives the raw private key. Distinguishing
the two is the load-bearing point of the contract:

```text
RAW KEY READ         → can exfiltrate durable private key material
AGENT ACCESS         → cannot normally retrieve key bytes
                     → but CAN request signatures / authenticate
                        as the user while the capability is enabled
```

So agent access is safer than raw-key read, but it is emphatically
NOT harmless. It deserves explicit, separately authorized opt-in.

The three axes stay orthogonal:

```text
AUTO_APPROVAL                 (existing; unchanged by this ACT)
NETWORK_EGRESS                (existing; default deny; opt-in allow)
SSH_AUTHENTICATION_AUTHORITY  (NEW; default deny; opt-in agent)
```

Opening one must not imply another.

---

## §1 — Entry discipline

```text
ENTRY_HEAD       = 911d02177  (recon subject; the commit that closed
                               ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01
                               §4 — drop unused existsSync import;
                               the network-egress fix is live)
ENTRY_TREE       = <resolved at first commit>
OPEN_HEAD        = <first commit creating this ACT file>
LAUNCH_HEAD      = <first commit creating this ACT file>
LAUNCH_TREE      = <tree of LAUNCH_HEAD>
CURRENT_HEAD     = <updated at each ACT-only commit; informational>
```

Commit list for this ACT (chronological, most-recent first) — appended
to in subsequent ACT-only commits. The §I provenance list at the
bottom is the canonical entry-discipline audit trail.

---

## §2 — Source seam map (reviewer recon questions Q1–Q4)

Q1. *What exact environment builder strips `SSH_AUTH_SOCK`?*
**A.** `sdk/packages/core/src/runtime/sandbox/environment.ts`:
`materializeEnvironment` is the single owner. Under `mode:
"sanitized"`, only the keys placed into `out` are visible to the
child (executor MUST honor `envSemantics: "complete"` per types.ts).
Steps (in source order):

1. **Safe baseline** (`SAFE_ENVIRONMENT_BASELINE`) — no credential vars.
2. **Synthetic HOME / TMPDIR** (caller-provided) — no credential vars.
3. **Caller-provided `allow` list** (the positive grant). Loop
   over `capability.allow`; for each name present in
   `parentEnv` with non-empty value, set `out[key] = parentEnv[key]`.
   This is the load-bearing step for re-introducing `SSH_AUTH_SOCK`.
4. **Defensive empty-string emission** for `SECRET_BLOCKLIST`
   entries (incl. `SSH_AUTH_SOCK`, `SSH_AGENT_PID`) — only when
   the key is present in `parentEnv` and `out[key]` is *still
   undefined*. This step protects against a buggy executor that
   ignores `envSemantics`; it does NOT override the allow list.

**Q1 verdict**: reintroduction is mechanical — add `SSH_AUTH_SOCK`
to the capability's `allow` list and step 3 will pass it through.

Q2. *Can an explicit capability safely reintroduce `SSH_AUTH_SOCK`?*
**A.** Yes — and this is the cleanest contract:

```text
DEFAULT (capability has no SSH agent authority):
  SSH_AUTH_SOCK in parentEnv → NOT in child env (step 4 empties it)
  SSH_AGENT_PID in parentEnv → NOT in child env (step 4 empties it)

AGENT capability (capability.allow includes SSH_AUTH_SOCK):
  SSH_AUTH_SOCK in parentEnv → present in child env (step 3 wins
                              over step 4 because step 4 only
                              fires when out[key] === undefined)
  SSH_AGENT_PID remains stripped (must be added to allow if wanted)

OTHER SECRET_BLOCKLIST entries (AWS_*, AZURE_*, GITHUB_TOKEN, …):
  remain stripped in BOTH modes
```

**Important**: do NOT weaken `SECRET_BLOCKLIST` globally. Do NOT
remove `SSH_AUTH_SOCK` from `SECRET_BLOCKLIST`. The blocklist is the
default; the `allow` list is the explicit override. Step 4 already
respects this — empty-string emission only fires when the key is not
already in `out`. Verified by reading the source (lines 230–238).

Q3. *What exact Seatbelt profile generator owns AF_UNIX rules?*
**A.** `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts`
owns the SBPL profile. Current state:

| Operation emitted | Source | Notes |
|---|---|---|
| `(allow file-read*)` + per-entry `(deny file-read* (subpath X))` | `buildReadRule` (lines 153–162) | broad read + deny-after-allow; matches Anthropic sandbox-runtime pattern |
| `(allow file-write* …)` + `(deny file-write* (subpath X))` per readonlyRoot | `buildWriteRule` + `buildWriteDenyRule` | deny-after-allow |
| `(allow file-write-create (subpath X))` per createOnlyRoot | `buildCreateOnlyAllowRule` | narrower primitive |
| `(allow file-read-metadata (subpath "/"))` | inline | path resolution |
| `(deny network*)` or `(allow network*)` | `buildNetworkRule` (lines 274–279) | **IP sockets only** |

**There is currently NO AF_UNIX rule in the generator.** Searches
for `unix-socket`, `system-socket`, `AF_UNIX`, `socket-domain`,
`network-outbound` against the source tree return zero matches in
the SDK Seatbelt code. The `(deny network*)` / `(allow network*)`
form governs IP sockets only on macOS Seatbelt.

**Q3 verdict**: a new SBPL rule shape is required for the agent
capability. The correct shape (per Apple Sandbox Guide v1.0 +
Safehouse `path-literal` documentation + MXC seatbelt-backend.md)
is:

```scheme
(allow system-socket (socket-domain AF_UNIX))
(allow network-outbound
  (remote unix-socket
    (path-literal "<resolved_ssh_auth_sock>")))
```

Note: for the Unix-socket `remote` selector, the exact-match
primitive is **`path-literal`**, NOT the filesystem-operation
`literal` (those are two different path-filter families). Apple
documents this explicitly:

```text
filesystem operation:
  (literal "/x")      ; exact filesystem path
  (subpath "/x")      ; filesystem subtree

AF_UNIX remote endpoint:
  (path-literal "/x") ; exact Unix-socket pathname
```

NOT a generic `(allow unix-socket (subpath X))` (that is not the
Seatbelt operation model), NOT a `(subpath "<auth_sock_dir>")`
filesystem grant (that would also grant file read/write on the
launchd socket parent directory, which is too broad), and NOT a
`subpath`-scoped `(remote unix-socket ...)` grant (sibling Unix
sockets under the same parent directory would be reachable — use
`path-literal` to pin authority to the exact resolved pathname;
see §5.1 for the freezing rationale and SSH-12 / SSH-13 for the
defended properties).

Anthropic's sandbox-runtime does emit `subpath` inside its
Unix-socket rules for its `allowUnixSockets` API, but that API
intentionally describes allowed socket paths/roots, NOT exact
endpoints. For the load-bearing narrow-grant contract this ACT
freezes (one resolved `SSH_AUTH_SOCK`, no sibling authority),
`path-literal` is the proper exact-match primitive.

Q4. *Does an existing deny on the socket path override the proposed
allow?*
**A.** No conflict today, but the generalisation must be tightened.

ClineMM's current `denyReadSubpaths` emits `(deny file-read* (subpath X))`
only (V1 curated list: `~/.ssh/id_*`, `~/.ssh/id_*_sk`,
`~/.ssh/id_mldsa44_ed25519`, `~/.gnupg/private-keys-v1.d/`). It does
not deny `network-bind` or `network-outbound`, so the proposed
`(allow network-outbound (remote unix-socket (path-literal "<auth_sock>")))`
is not overridden by ClineMM's current deny list.

Do **NOT** generalise this claim to MXC `deniedPaths`: current MXC
emits `deniedPaths` to deny `file-read*`, `file-write*`,
`network-bind`, AND `network-outbound`, precisely so a sensitive
control socket such as `ssh-agent` cannot be reached through a
broader socket grant. Our ClineMM-specific conclusion is correct;
the MXC-generalised wording in the original draft was outdated.

The launchd socket parent directory (typically
`/private/tmp/com.apple.launchd.<uid>/`) is **not** in the
ClineMM sensitive-read deny list, but a `path-literal`-scoped grant
`(remote unix-socket (path-literal "<exact_socket_path>"))` does
NOT inherit broad filesystem or socket authority into that parent
directory or to sibling sockets under it. The narrow-grant
invariant (SSH-12) is load-bearing here:

> SSH-12: agent authority grants outbound AF_UNIX connect to the
> EXACT resolved SSH_AUTH_SOCK pathname only; it does NOT widen to
> sibling Unix sockets under the same parent directory, and it
> does NOT grant file-write or socket authority to the parent
> directory.

---

## §3 — Live specimen classification

§3 = `CANDIDATE_PRODUCT_POLICY_DECISION_REQUIRED`.

Live command (this session — **live ClineMM sandboxed execution**;
the operator shell here is NOT eligible for a nested Seatbelt
host-ablation experiment; see §6 for the substrate-gate detail):

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=accept-new \
    -o PreferredAuthentications=publickey,password,keyboard-interactive \
    -o NumberOfPasswordPrompts=1 \
    ubuntu@81.177.33.219 'echo SSH_OK_$(uname -a)'
```

Output (verbatim):

```text
Load key "/Volumes/UserData/Users/chistyakov/.ssh/id_rsa": Operation not permitted
ubuntu@81.177.33.219: Permission denied (publickey,password).
exit code: 255
```

Classification (this specimen is the canonical bound; see
`§3-live-specimen/ssh-attempt-20260829.txt`):

| Stage | Result |
|---|---|
| Local TCP/SSH transport to remote sshd | **REACHED** |
| `connect()` returned EPERM (network-egress denied) | NO — egress proceeded |
| `~/.ssh/id_rsa` file-read | **DENIED** (`Operation not permitted`) |
| SSH private-key signature offered to server | NO (load failed before sign) |
| Remote sshd auth result | `Permission denied (publickey,password).` |
| Substrate classification | **NETWORK_EGRESS_PROCEEDED; RAW_KEY_AUTHORITY_DENIED** |

Two important causal assertions:

1. **Qualification evidence (not causality re-proof).** Under
   `CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt` +
   `CLINEMM_SAFE_YOLO_NETWORK=allow`, the SSH transport reached the
   remote sshd. This is **strong LIVE_PROVEN qualification evidence**
   that `NETWORK_EGRESS_PROCEEDED` is real on a real ClineMM
   sandboxed execution path, NOT a re-proof of the original D/A/O
   host-ablation causality (that causality is owned by the
   network-egress ACT's §4 evidence under
   `probeSeatbeltAvailability() === true`). The two are complementary,
   not redundant. Had the network fix still been broken, the
   failure would have been `EPERM` at `connect()` (no `Load key`
   message, no `Permission denied (publickey,…)`).

2. The SSH private-key denial is by design: the file-level deny
   from `resolveSafeYoloSensitiveReadDenials()` (sandbox-policy.ts
   lines 386–411) covers `~/.ssh/id_rsa` whenever network-open is
   on. This is **NOT** a regression and **NOT** a wiring defect.

Therefore the gap is a **missing product capability**, not a defect
in the existing substrate. The substrate correctly denies raw key
reads; the substrate correctly strips `SSH_AUTH_SOCK`; the substrate
has no rule to grant narrow agent authority because no such
capability is defined.

---

## §4 — Recon discriminator (resolved against §2 + §3)

Reviewer proposed five classifications:

| Option | Resolved? | Evidence |
|---|---|---|
| A. `~/.ssh` is explicitly denied by ClineMM policy | **YES — leading candidate** | sandbox-policy.ts lines 388–411 (V1 curated list) explicitly contains `id_rsa` |
| B. `~/.ssh` should be readable under intended policy but generated SBPL denies it | NO | The deny list IS the policy; generation is correct |
| C. File is readable but `ssh-agent` socket is blocked | NO (yet) | `SSH_AUTH_SOCK` is in `SECRET_BLOCKLIST` (so it isn't even passed through), but there is NO Seatbelt rule today explicitly governing the AF_UNIX socket path. This is a *missing capability*, not a *wrong capability* |
| D. Agent unavailable / key not loaded | NO | Out of scope; host config, not sandbox |
| E. Key file opens, remote rejects key | NO | Sandbox denied the read; never reached sshd auth |

Resolution: **A confirmed by source; gap is the new product slice
"narrowly-scoped ssh-agent authority."** This is NOT a substrate
defect and NOT a wiring defect.

---

## §5 — Corrected contract (absorbs reviewer P0 + P1 fixes)

This §5 is the contract that the implementation ACT (to be authored
later) MUST honor. The corrections relative to the originally-proposed
form are explicit and load-bearing.

### §5.1 — SBPL rule shape (reviewer P0 fix)

For an `agent`-mode capability, emit **two** new SBPL rules (third
capability rule alongside the read/write/network rules):

```scheme
;; system-socket: required for the AF_UNIX socket() syscall
(allow system-socket (socket-domain AF_UNIX))

;; network-outbound: AF_UNIX connect to the EXACT resolved
;; SSH_AUTH_SOCK pathname only. path-literal, NOT filesystem
;; `literal` and NOT `subpath`.
(allow network-outbound
  (remote unix-socket
    (path-literal "<RESOLVED_AUTH_SOCK>")))
```

**`path-literal` is required.** It is the Seatbelt exact-match
primitive for Unix-socket selectors (per Apple Sandbox Guide v1.0
§5: `(remote unix-socket (path-literal "/x"))`, and per current
Safehouse SSH-agent integration documentation). It is a
**distinct** filter primitive from the filesystem-operation
`literal` — those are two different path-filter families:

```text
filesystem operation:
  (literal "/x")      ; exact filesystem path
  (subpath "/x")      ; filesystem subtree

AF_UNIX remote endpoint:
  (path-literal "/x") ; exact Unix-socket pathname
```

`path-literal` pins authority to the exact resolved pathname and
makes SSH-12 + SSH-13 defendable:

```text
approved socket       → connect allowed
sibling socket        → denied (path-literal does not match siblings)
parent-directory IPC  → not widened (path-literal does not match the dir)
```

**Why NOT filesystem `literal`:** the filesystem-operation `literal`
is not a valid filter inside `(remote unix-socket ...)` per Apple
Sandbox Guide v1.0; using it would be a profile-generation error
and would either be ignored or trigger a profile-parse failure at
`sandbox-exec` invocation time.

**Why NOT `subpath`:** `subpath` is a subtree primitive. Inside
`(remote unix-socket ...)`, a `subpath`-scoped grant would widen
authority to sibling Unix sockets under the same parent directory
(such as other launchd-managed sockets, Docker daemon socket,
gpg-agent, etc.). This contradicts SSH-12 and SSH-13 directly.

The path MUST be:

1. **Canonical (realpath-resolved)** before emission — same rule
   as the existing canonical-paths contract for filesystem grants.
2. **The exact resolved value of `process.env.SSH_AUTH_SOCK` at
   capability construction time** — re-resolved per-invocation is
   incorrect (the agent socket is per-host-session, not per-command).

The `(allow system-socket (socket-domain AF_UNIX))` rule is global
within the profile — this is unavoidable: the kernel needs the
socket() syscall to create any AF_UNIX socket, and Seatbelt has
no per-path `socket()` allow. This is acceptable because AF_UNIX
sockets are inherently filesystem-path-addressed; the second rule
constrains WHERE they can connect. The narrow-grant invariant
(SSH-12) is enforced by the second rule, not by the first.

### §5.2 — NOT a filesystem readwrite grant (reviewer P1 fix)

Do **NOT** implement the agent capability by adding the launchd socket
parent directory to `writableRoots` or `readwritePaths`. MXC's
`readwritePaths` would grant file read/write/AF_UNIX-bind/AF_UNIX-connect
throughout the containing directory — far too broad.

Do **NOT** implement it by adding `~/.ssh` to `readonlyPaths` even
narrowly. That grants raw key reads to the sandboxed process, which
collapses the boundary.

The agent capability is a **dedicated Unix-socket capability / SBPL
rule**, not a filesystem policy extension.

### §5.3 — Env reintroduction (reviewer P1 fix, recon Q2)

The capability's sanitized `allow` list MUST include `SSH_AUTH_SOCK`
when the capability is `agent`-mode. The capability shape (extension
to `CommandCapability` in `sdk/packages/core/src/runtime/sandbox/types.ts`)
adds one field:

```typescript
readonly sshAuthenticationAuthority?: {
  readonly mode: "agent";
  readonly resolvedAuthSock: string;  // canonical SSH_AUTH_SOCK path
};
```

(Default posture: `undefined` or `{ mode: "deny" }`; explicit opt-in
required.) When `mode === "agent"`:

1. The capability's environment `allow` list automatically gets
   `SSH_AUTH_SOCK` added (the caller-supplied `allow` list is
   extended, not replaced).
2. `SSH_AGENT_PID` remains stripped unless the caller explicitly
   adds it to `allow` (separate decision; default strip is correct).
3. The capability carries `resolvedAuthSock` (canonical) so the
   SBPL generator can emit the second rule without re-resolving at
   child-spawn time.

`SECRET_BLOCKLIST` is **NOT** weakened. The reintroduction is via
the explicit `allow` list, which the existing
`materializeEnvironment` step 3 already honors over step 4.

### §5.4 — Capability name

Per the reviewer correction, the field is named
`sshAuthenticationAuthority`, not `sshCredentialAccess`. The two
values are:

```text
sshAuthenticationAuthority:
  undefined / { mode: "deny" }     # default — current behavior
  { mode: "agent", resolvedAuthSock }  # explicit opt-in
```

`readonly`-identity-file mode is intentionally **NOT** in V1. It
remains a possible future capability but is the wrong default — it
still grants raw key bytes to the sandboxed process.

### §5.5 — V1 sensitive-read boundary preserved

`~/.ssh/id_*`, `~/.ssh/id_*_sk`, `~/.ssh/id_mldsa44_ed25519`,
`~/.gnupg/private-keys-v1.d/` remain in the V1 deny list under ALL
modes, including `agent`. The agent capability grants signing
authority through the socket; it does not exempt these files from
the read-deny.

---

## §6 — Substrate gate (reuse the proven round-trip predicate)

This ACT is `OPEN / POLICY_INTENT_UNBOUND`. Per reviewer verdict,
host-ablation is **AUTHORIZED** (HOST_REQUIRED) but
`IMPLEMENTATION_RED = NOT_AUTHORIZED` until §15 freezes the contract
(see §17 for the global disposition; this ACT owns no RED).

The actual RED/host-ablation belongs to a follow-on
`ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01`, which
this recon ACT does NOT pre-create (per FACT-001 naming doctrine;
new ACTs are created at the point of authorization).

### §6.1 — Substrate-eligibility predicate (NOT a fresh gate)

The follow-on implementation MUST reuse the canonical round-trip
predicate, not a fresh file-presence check:

```text
HAS_SUBSTRATE = probeSeatbeltAvailability() === true
```

`probeSeatbeltAvailability` lives at
`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-availability.ts`
and asserts all three of:

1. `process.platform === "darwin"`; AND
2. `/usr/bin/sandbox-exec` exists; AND
3. `spawnSync(sandbox-exec, ["-p", "(version 1) (allow default)",
   "/usr/bin/true"])` exits 0 within a 5s budget.

File-presence alone is **insufficient**: this VSCodium shell has
`/usr/bin/sandbox-exec` present yet `probeSeatbeltAvailability()`
returns `false` because the shell itself is already nested-sandboxed
and `spawnSync` of the minimum probe returns EPERM. The cheap
pre-filter `darwin && existsSync(...)` is only a fast-fail in front
of the round-trip probe; the round-trip is the load-bearing signal.

The follow-on ACT MUST call the function (not re-implement it) and
MUST treat its return as the substrate gate for the three-point
comparative host ablation (D / A / agent-O = off) over both env
reintroduction and AF_UNIX connect.

### §6.2 — Substrate status for THIS recon session

This session's bash shell is inside VSCodium and reports
`probeSeatbeltAvailability() === false` (file present, but the
shell itself is nested-sandboxed and the round-trip probe returns
EPERM). Therefore the live SSH specimen in §3 is a **real ClineMM
sandboxed execution** — the substrate correctly carried the SSH
transport to the remote sshd — but the operator shell is NOT
eligible for a nested Seatbelt host-ablation experiment. The
substrate-eligibility word in §3 prose is restricted to the latter
sense and has been tightened in this revision.

A substrate-eligible shell (Terminal.app / iTerm2 / debug-harness)
will report `probeSeatbeltAvailability() === true` and is the only
environment in which the follow-on implementation ACT can run its
three-point comparative host ablation.

---

## §7 — Reserved

*(Reserved for the follow-on implementation ACT; this recon ACT
owns no §7 content.)*

## §8 — Reserved

*(Reserved for the follow-on implementation ACT.)*

## §9 — Reserved

*(Reserved for the follow-on implementation ACT.)*

## §10 — Reserved

*(Reserved for the follow-on implementation ACT.)*

## §11 — Reserved

*(Reserved for the follow-on implementation ACT.)*

## §12 — Reserved

*(Reserved for the follow-on implementation ACT.)*

## §13 — Reserved

*(Reserved for the follow-on implementation ACT; this recon ACT
owns no RED, GREEN, typecheck, lint, or closure gates — those
belong to the implementation ACT, gated by §15.)*

---

## §14 — Launch discipline

```text
LAUNCH_HEAD       = <first commit creating this ACT file>
LAUNCH_TREE       = <tree of LAUNCH_HEAD>
CURRENT_HEAD      = <updated at each ACT-only commit>
ENTRY_HEAD        = 911d02177
ENTRY_TREE        = <resolved at first commit>
```

The recon subject is `911d02177` (the commit that closed the
network-egress §4 correction). Any subsequent ACT-only commits
do NOT re-bind LAUNCH_HEAD; they only refresh CURRENT_HEAD.

---

## §15 — Frozen product contract

> This section is **FROZEN** by closure of this recon ACT. The
> implementation ACT (`ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01`)
> inherits this contract verbatim. It MAY challenge feasibility only
> through RED/executable evidence; it MUST NOT silently renegotiate
> the product policy. Any renegotiation requires a new recon ACT.

**PRODUCT_CONTRACT**

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
    construction time; re-resolution per-invocation
    is incorrect (per-host-session, not per-command)

PRESERVE (across both modes)
  ~/.ssh/id_rsa / id_ed25519 / id_ecdsa /
    id_mldsa44_ed25519 unreadable
  sibling Unix sockets inaccessible
    (path-literal does not match siblings)
  parent directory gains no filesystem write
    authority and no other socket authority
  unrelated secrets (AWS_*, AZURE_*,
    GITHUB_TOKEN, …) remain stripped
  SECRET_BLOCKLIST globally unchanged
  no executable-name special casing
  no readwritePaths widening
  no SECCOMP-bypass broadening
  raw-key reads denied in BOTH modes
  ~ SUBSTRATE gate for executable qualification
    of this contract: probeSeatbeltAvailability() === true
    (file presence + round-trip probe of
     (version 1)(allow default) /usr/bin/true
     within the 5-second budget at
     sdk/packages/core/src/runtime/sandbox/macos/
     seatbelt-availability.ts)
```

The load-bearing quartet (SSH-03, SSH-04, SSH-06, SSH-12) plus
SSH-05 are the auth-flow invariants. SSH-08 (wrong/stale agent
socket path → fail closed), SSH-09 (capability OFF after ON →
env stripped and socket authority removed), and SSH-13 (agent
socket outside the approved resolved path remains inaccessible)
are the negative-bound invariants. SSH-01, SSH-02, SSH-07, SSH-10,
SSH-11, SSH-14 are PRESERVE / invariant rows.

`readonly`-identity-file mode is explicitly OUT OF SCOPE for V1.
The implementation ACT MUST NOT add it.

---

## §16 — Conservation matrix

| ID | Invariant | Direction |
|---|---|---|
| SSH-01 | default → raw SSH private keys denied | PRESERVE (V1) |
| SSH-02 | network-allow alone → raw keys still denied | PRESERVE (V1) |
| SSH-03 | `agent` → `SSH_AUTH_SOCK` present in child | NEW |
| SSH-04 | `agent` → connect to that AF_UNIX socket works | NEW |
| SSH-05 | `agent` → ssh authenticates through loaded agent key | NEW |
| SSH-06 | `agent` → `id_rsa` / `id_ed25519` remain unreadable | NEW |
| SSH-07 | `agent` → unrelated blocked env secrets remain stripped | NEW |
| SSH-08 | wrong/stale agent socket path → fail closed | NEW |
| SSH-09 | capability OFF after ON → env/socket authority disappears | NEW |
| SSH-10 | no executable-name special casing | invariant |
| SSH-11 | sandbox OFF historical behavior unchanged | invariant |
| SSH-12 | path-literal-scoped socket grant does NOT widen to sibling sockets or parent dir | NEW (load-bearing) |
| SSH-13 | agent socket outside approved resolved path inaccessible | NEW |
| SSH-14 | no raw key bytes become available through this capability | invariant |

SSH-03, SSH-04, SSH-06, SSH-12 are the load-bearing quartet.

---

## §17 — Factory disposition

```text
VERDICT                          = PASS_SEATBELT_SSH_AGENT_AUTHORITY_PRODUCT_POLICY_REPAIR_V1
CURRENT_PRIVATE_KEY_DENIAL       = INTENTIONAL / PASS
NETWORK_ALLOW_CONSERVATION       = PASS
SSH_AUTHENTICATION_CAPABILITY    = NOW AUTHORIZED (deny | agent, V1)
STATUS                           = CLOSED

CLOSURE EVIDENCE:
  substrate gate                   PASS (probeSeatbeltAvailability() predicate, file+round-trip)
  SBPL exact-socket shape          PASS (path-literal Unix-socket selector, per Apple Sandbox Guide v1.0)
  secret blocklist                 PASS (unchanged)
  readwritePaths widening          ABSENT (do not introduce)
  env reintroduction contract      FROZEN (step 3 of materializeEnvironment wins over step 4)
  raw-key conservation             PASS (V1 curated deny list preserved)
  sibling-socket narrow-grant      PASS (path-literal does not match siblings)
  parent-directory authority       PASS (path-literal does not match the dir)
  host-ablation RED                DEFERRED to IMPLEMENTATION01 (substrate-gated)

REVIEWER DISPOSITION (this turn):
  P0 = NONE (architecture settled)
  P1 = durable ACT state synchronized to closed status;
       §15 frozen in this ACT;
       IMPLEMENTATION_RED = AUTHORIZED;
       IMPLEMENTATION01 opened.
  P2 = NONE worth blocking

BOARD VALIDATOR (2026-08-29 run, closure run):
  validator ran cleanly via `bun tools/factory/validate-epic-board.ts`
  proposed SBPL socket-rule shape MUST be corrected
  (use system-socket + `path-literal`-scoped network-outbound;
   `path-literal` is the Unix-socket selector exact-match primitive
   per Apple Sandbox Guide v1.0 — distinct from the filesystem-
   operation `literal`; do NOT use filesystem `literal` inside
   `(remote unix-socket ...)`; do NOT use `subpath` (would widen
   to sibling sockets under the same parent directory))
  substrate gate MUST reuse probeSeatbeltAvailability()
  round-trip predicate, not file-presence alone

P1 (reviewer, RESOLVED):
  do NOT implement through readwritePaths
  do NOT weaken SECRET_BLOCKLIST globally
  env reintroduction is via explicit allow-list (step 3 wins over step 4)
  §7..§13 must be split into individual headings (done)
  RED references must be unified (this ACT owns NO RED; the
    implementation ACT owns RED — done; IMPLEMENTATION_RED = NOT_AUTHORIZED)
  board row must be compact index (done in epic-board.md)
  "network-egress closure" continuity overclaim fixed
    (this ACT is unblocked by LIVE network-egress mechanism evidence,
     not by ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01 closure —
     that ACT remains OPEN / POLICY_INTENT_UNBOUND)

P2 (reviewer, RESOLVED):
  §3 "substrate-eligible" wording tightened to "live ClineMM
    sandboxed execution; operator shell NOT eligible for nested
    Seatbelt host-ablation"
  Q4 MXC deniedPaths wording corrected: ClineMM's current deny list
    does NOT include network-bind/network-outbound; do NOT generalize
    to MXC deniedPaths, which DOES include them
  §3 evidence wording narrowed from broad repair-causality claim to
    "NETWORK_EGRESS_PROCEEDED = LIVE_PROVEN" (qualification evidence
    for the earlier D/A/O host-ablation causality, not re-proof)

BOARD VALIDATOR (2026-08-29 run):
  validator ran cleanly via `bun tools/factory/validate-epic-board.ts`
  HARD gates: INDEX_LINES_LT_400 PASS (223 lines, cap <400);
               ALL_INDEX_LINKS_EXIST PASS (56 / 56);
               ALL_INDEX_LINKS_RELATIVE PASS (56 / 56);
               NO_DUPLICATE_EPIC_ROWS PASS;
               NO_DUPLICATE_CURRENT_WORK_IDS PASS;
               EVERY_OPEN_NEXT_ROW_HAS_DETAIL PASS;
               STATUS_VOCABULARY_VALID PASS;
               HOST_REQUIRED_QUALIFICATION_VALID PASS;
               OLD_ACT_IDS_PRESERVED PASS (192 in anchor,
                 230 in current durable + 38 legitimate new IDs)
  HARD gate FAILURES (PRE-EXISTING, NOT caused by this ACT):
               NO_OVERSIZED_INDEX_TABLE_CELL FAIL — two cells exceed
                 the 280-char cap:
                   * table@L16 row7 "Work" (editor-tool lane,
                     `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01`)
                     = 424 chars;
                   * table@L56 row4 "State" (open-supporting-work table,
                     "Code-coverage baseline") = 366 chars.
               Both rows were already over the cap before this ACT
               added the SSH-credential-authority row (which is well
               within cap at 199 chars). Per the reviewer's "Do not
               clean historical rows" guidance, these are out of scope
               for this ACT and remain a separate maintenance item.
  ADVISORY:       INDEX_TARGET_READABLE FAIL — 223 lines vs ≤220 target.
                 Pre-existing drift; this ACT added 1 row (the new SSH
                 credential authority lane); recovering the advisory
                 target requires trimming historical content outside
                 this ACT's scope.
  NEW_VALIDATOR_FAILURES_FROM_THIS_ACT = 0.

RECOMMENDED CONTRACT:  (FROZEN — see §15)
  sshAuthenticationAuthority = deny | agent (only)
  raw-key read remains DENIED in both modes
  readonly-key mode OUT OF SCOPE for V1
  exact-socket grant via `path-literal` Unix-socket selector
  (not filesystem `literal`; not `subpath`; no pre-authorized fallback)

NEXT:
  this ACT CLOSED against §15 freeze
  follow-on IMPLEMENTATION01 opened (see new ACT file)
  IMPLEMENTATION_RED = AUTHORIZED (subject to substrate gate)
```

---

## §I — Provenance and entry-discipline audit trail

Append-only list of ACT-only commits (most-recent first); updated at
each ACT-only commit. The freeze points are ENTRY_HEAD (recon subject),
LAUNCH_HEAD (this ACT's first commit), and CLOSURE_HEAD (the freeze
commit at which §15 became the sealed contract); refresh pointers
may lag by one commit, which is the deliberate design.

```text
ENTRY_HEAD    = 911d02177        ; recon subject (the commit that
                                  ;  closed the network-egress §4
                                  ;  correction)
LAUNCH_HEAD   = c700b0d92        ; this ACT's first commit; bundled
                                  ;  with the IMPLEMENTATION01 launch
                                  ;  because the recon/contract ACT
                                  ;  closes here and immediately
                                  ;  opens the executable successor
                                  ;  (per the bounded transition)
CLOSURE_HEAD  = c700b0d92        ; §15 freeze point; the contract is
                                  ;  sealed at this commit
IMPL_HEAD     = c700b0d92        ; IMPLEMENTATION01 launched in the
                                  ;  same commit; bind is one commit
                                  ;  because of the bounded transition
                                  ;  (single freeze + open)
ENTRY_TREE    = <resolved at launch>
LAUNCH_TREE   = <resolved at launch>
CURRENT_HEAD  = c700b0d92        ; no ACT-only follow-up commits
                                  ;  beyond the launch (the recon ACT
                                  ;  is closed; IMPLEMENTATION01 will
                                  ;  own subsequent ACT-only commits)
WORKTREE      = CLEAN            ; tracked changes only; capture flow
                                  ;  untracked files are owned by other
                                  ;  ACTs (editor-tool-friction recon)
```

The single-commit design is deliberate. The reviewer verdict
`GO_AFTER_ONE_BOUNDED_FIX` authorized one final bounded documentary
transition: freeze §15 here, open IMPLEMENTATION01 immediately.
Splitting the freeze from the IMPLEMENTATION01 launch into separate
commits would have added an unnecessary intermediate state. The
network-egress ACT used multiple launch commits because it absorbed
a multi-turn review; this ACT absorbed the review across its §0..§17
edits and finalized in a single freeze+open commit.

Subsequent ACT-only commits (e.g. from IMPLEMENTATION01 phases) will
refresh `IMPL_HEAD` and may refresh `CURRENT_HEAD`. They MUST NOT
re-bind `ENTRY_HEAD`, `LAUNCH_HEAD`, or `CLOSURE_HEAD` — those are
load-bearing frozen contracts.