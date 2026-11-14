# C6 — Terminal verdict

**ACT:** `ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01`
**Branch:** `main`
**Entry HEAD:** `2dcceb6d22f66ee724f1986f95f7a27502ba9d80`
**Entry tree:** `1678d92e540db7cba7cc117ef582f219415ad2b7`
**Predecessor:** `ACT-CLINEMM-POSTMERGE-VSCODE-REACHABILITY-SECURITY-QUAL01`
(`PASS_WITH_NONBLOCKING_RESIDUE`, 0 P0 / 0 P1 / 15 P2) — consumed, not redone.

---

## C6.1 Verdict

# `PASS_STRUCTURAL_ONLY`

> **The charter's success criterion is:** *"An external client retrieves
> the same session identity and authoritative status as the running
> ClineMM extension, with no new execution owner."*
>
> **What is proven:** the source/test seam is proven, and it is proven
> against **real production classes** — a real AF_UNIX listener, a real
> `SdkSessionLifecycle`, a real `ClineCore`-equivalent snapshot chain,
> a real MCP stdio server. An external client over a real socket
> retrieves **the same record the extension host itself reads**, with
> **no second execution owner** (no new `ClineCore`, no new session, no
> new runtime).
>
> **What is NOT proven:** observation against the **running installed
> extension**. No ClineMM extension is installed on this host, and the
> repository's debug harness could not launch Electron here (the child
> died with `SIGSEGV` under this sandbox). The operator is running the
> live bundle manually.
>
> Hence `PASS_STRUCTURAL_ONLY` rather than `PASS_READONLY_CONTROL_SEAM`:
> the seam is proven **structurally and against real production seams**,
> and the installed-instance observation is **pending**. The ACT's own
> charter makes this distinction explicit — it lists
> `PASS_STRUCTURAL_ONLY` as "source/test seam proven; installed
> observation pending", and it instructs that "If an installed instance
> is unavailable, preserve `LIVE_UNOBSERVABLE`." It is.

---

## C6.2 The charter's questions, answered

### Can Codex safely observe the existing ClineMM VS Code runtime? — **Yes.**

The seam reads the runtime's own owner. `clinemm_get_run` returns the
`ActiveSession` the controller's `SdkSessionLifecycle` already holds,
plus the canonical runtime status from the existing
`VscodeSessionHost.runtimeSnapshot()` → `ClineCore` →
`LocalRuntimeHost` → `AgentRuntime.snapshot()` chain. Nothing is
reconstructed, no second runtime is created, and the seam holds no
subscription — so it cannot become a third authority.

### Can Codex subsequently *control* it? — **Not in this ACT, by design.**

The ACT explicitly forbids enabling `start_act`, `send_feedback` or
`cancel_run`, and it does not. The operation registry is a frozen
two-entry literal whose type admits only `mutating: false`; the MCP
server registers exactly two tools; and the payload allow-list rejects
every key outside the six identity/status fields. **There is no
reachable mutation path from the seam's module graph.**

### Is the transport safe? — **Yes, with one operational constraint.**

Default OFF; AF_UNIX only (no TCP); a `0700` private directory with
`0600` socket and token files; an explicit constant-time bearer
authorization on every request; no credential or transcript in any log
line; no public protocol/API change (`0` files changed under `proto/`,
`package.json` or `registry.ts`); full cleanup on extension
deactivation through the production `Controller.dispose()` path.

**The constraint:** an AF_UNIX `sock_path` is 104 usable bytes on
macOS, so the seam requires a `CLINE_DIR` short enough to host the
socket. The seam now fails closed with an actionable message rather
than an opaque `EINVAL`.

---

## C6.3 Why not the other verdicts

| Verdict | Why not |
|---|---|
| `PASS_READONLY_CONTROL_SEAM` | Requires observation against the **running extension**. No installed instance is available on this host, and the debug harness's Electron launch died with `SIGSEGV`. The charter instructs: "If an installed instance is unavailable, preserve `LIVE_UNOBSERVABLE`." |
| `NOT_A_GOOD_CONTROL_SEAM` | The architecture does **not** prevent safe integration. The real owner was identified, the observation is read-only and request-time, and no duplication is required — the seam reads the existing session owner rather than standing up a second runtime. |
| `CAPTURE_INSUFFICIENT` | The evidence is sufficient for the question this ACT was chartered to answer. 29 executed witnesses against real production classes, a bundle-level reachability proof, a clean typecheck/lint/build, and a fully bounded diff surface. The only missing piece is the installed-instance observation, which is a **known environment limitation**, not an evidence gap — and it is recorded as `LIVE_UNOBSERVABLE` rather than papered over. |
| `HALT_<reason>` | **No new P0 was demonstrated.** No security boundary was broken; no pre-existing semantic was disturbed. |

---

## C6.4 Risk register

| Severity | Count | Items |
|---|---|---|
| **P0** | **0** | — |
| **P1** | **0** | — |
| **P2** | **2** | See below |

### P2 items

| # | Item | Disposition |
|---|---|---|
| R-A | **The AF_UNIX path-length constraint.** An operator who enables the seam needs a `CLINE_DIR` short enough for a `sock_path` (≤100 bytes). | **Accepted with a fail-closed, actionable error.** The default `~/.cline` satisfies it on a normal home directory. Successor: the successor mutation-control ACT may move the socket to a shorter, fixed location (e.g. under `$TMPDIR`) — but that changes the trust boundary and therefore needs its own review. |
| R-B | **The seam adds a server-side MCP surface** using `@modelcontextprotocol/sdk@1.30.0`, which the predecessor ACT recorded (R-06) as below the fix floor for five advisories. | **Accepted.** The new surface is a **stdio server** with **no OAuth, no redirect, no HTTP, no SSE** — there is no origin to bind and no redirect to follow, so none of the predecessor's client-side sub-cases are reachable through it. The surface is default-off and local. The R-06 advisory itself is **carried forward unchanged**. |

### Carried forward unchanged from the predecessor

| # | Item |
|---|---|
| R-02 | The cloud start path's open local gate. Untouched by this ACT. |
| R-03 | The SDK file-read executor's workspace containment gap. Untouched; the seam exposes no file read. |
| R-06 | The `@modelcontextprotocol/sdk` version floor. Untouched (see R-B above for the delta assessment). |
| R-07 | MCP stdio spawn authority unchanged. This ACT adds **no** stdio spawn on the VS Code side. |
| R-08 | The Hub is CLI-only. The seam binds the **local** host chain only. |
| — | The MCP OAuth / redirect advisory. The seam performs no OAuth and no redirect. |
| — | The file-read containment gap and the editor executor RED matrix (cases C/D/E). Both untouched and unmodified. |

---

## C6.5 The decision on the next mutation-control contract

**A separate ACT may authorize tightly scoped mutations, contingent on
this evidence.** The specific contract that this evidence supports:

> **The next ACT may add mutating operations to the SAME seam — the
> same AF_UNIX transport, the same default-off enablement, the same
> bearer authorization — provided it satisfies the conditions below.**

### What this evidence already establishes for that successor

1. **The observation seam is sound.** A default-off, local-only,
   explicitly-authorized, read-only, request-time observation surface
   over the real session owner is proven against real production
   classes. The transport, the trust boundary and the cleanup lifecycle
   do not need to be re-litigated.
2. **The authority boundary is the right place to extend.** The seam
   holds READ closures only. Adding a mutation means adding a closure
   that reaches an existing controller mutator — and therefore means the
   seam stops being observation-only and starts sharing the controller's
   authority. That is the review signal, and it should be the ACT's
   explicit subject.
3. **The success criteria to hold a mutation to** (recommended, derived
   from the C4 matrix):
   - the mutation must be reachable ONLY through the same bearer
     authorization, so the unauthorized-client property (C4.2) keeps
     holding;
   - the mutation must be **scoped to the active session** the seam
     already reads, so the foreign-session property (C4.3) keeps
     holding;
   - the mutation must be **idempotent-safe** or explicitly
     non-idempotent-aware, so the read-idempotence property (C4.4) is
     not silently broken by a write;
   - the mutation must NOT be able to reach `run_commands`, the editor
     executor, the file-read executor, or any other tool executor
     directly — it must go through the existing approval gate, so the
     approval and cancellation paths (C4.6) keep holding;
   - the disconnect property (C4.5) must be re-proved for the
     mutating case: a client that dies mid-mutation must not leave the
     run in a half-mutated state.

### What the successor must re-open (this ACT's evidence does NOT cover)

| Item | Why it is not covered here |
|---|---|
| The **approval gate** for a mutation | The seam currently cannot reach it. A mutating operation that bypasses `SdkInteractionCoordinator.handleRequestToolApproval` would be a P0. The successor must route through it and prove it. |
| **Session-ownership fences** on the mutation | The read path is naturally fenced (it reads *the* active session). A mutation must be fenced against a session that was replaced mid-flight. |
| **Idempotence / exactly-once** for the mutation | C4.4 proves read idempotence only. A write needs its own cardinality argument (the C9/C10 and CCARD precedents are the in-repo models). |
| **Partial-failure recovery** | If a mutation is applied and the client dies before receiving the response, the runtime's state must remain coherent. The disconnect property (C4.5) is a *read* property; a write needs its own. |
| The **Elm / BCB / C10** interaction | The read path deliberately avoids the Elm arbiter selection (§C4.8). A mutation that changes a phase would have to go through the Elm arbiter, which is a materially different contract. |
| **The live installed-instance observation** | Still `LIVE_UNOBSERVABLE` on this host. The successor should attempt it, and it is a **precondition** for authorizing a mutation — a mutation must not ship on a seam that has never been observed against a running extension. |

### The recommended sequencing

```
THIS ACT (read-only, default-off, source/test seam proven)
   -> LIVE installed-instance observation   [operator-run; a PRECONDITION]
      -> SUCCESSOR ACT: tightly scoped mutations, contingent on
         (a) this ACT's C1-C4 evidence, and
         (b) the live observation, and
         (c) explicit remediation or isolation of:
             * the approval gate,
             * the session-ownership fence,
             * write idempotence,
             * partial-failure recovery,
             * the Elm/BCB/C10 interaction.
```

---

## C6.6 Explicit non-claims

- **No live observation is claimed.** Every behavioural statement rests
  on an executed witness against a real production class, or on
  source-level analysis of the shipped bundle.
- **The 29 passing tests do not prove the seam is *safe*.** They prove
  the specific properties enumerated in §C4. The trust argument in
  §C2.5 rests on the *absence* of reaching references, which is a
  structural argument about the diff surface.
- **The predecessor's 558-commit analysis was not repeated.** Its
  R-02/R-03/R-06/R-07/R-08 findings are carried forward verbatim.
- **Nothing was pushed, released, packaged, or installed.** No VSIX was
  produced or replaced; the existing VSIX artifacts are byte-identical.
- **No Hub migration, no broad refactor, no unrelated cleanup.** The
  production diff is one file plus one new directory.

---

## C6.7 Evidence index

| File | Content |
|---|---|
| `00-identity.md` | C0 — identity, predecessor consumption, protected state, installed-build identity, toolchain |
| `01-controller-boundary.md` | C1 — the exact controller/session-host source map, the six method families, the three observation classes, the no-second-`ClineCore` proof |
| `02-transport-decision.md` | C2 — the transport decision (7 options considered), the seven required properties, the trust boundary, the advisory delta, the AF_UNIX path-length finding |
| `03-read-only-proof.md` | C3 — the implementation inventory, the exposure allow-list, the executed probe, the negative controls |
| `04-security-conservation.md` | C4 — all seven security/conservation requirements, plus the conservation argument for C9/C10, BCB, Elm, editor, approval, session ownership |
| `05-evidence-closure.md` | C5 — the source map index, the executed commands + exit codes, the SHA-256 identities, the label summary, the removal trigger |
| `06-verdict.md` | C6 — this file |
| `SHA256SUMS.txt` | The evidence package's own hashes |
