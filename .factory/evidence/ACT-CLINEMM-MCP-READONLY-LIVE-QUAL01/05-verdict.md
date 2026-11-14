# C5 — Terminal verdict

**ACT:** `ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01`
**Branch:** `main`
**ENTRY_HEAD:** `cc6aa0987c92c90fd3b3156552931bce12d1367e` (RECON01)
**FINAL_HEAD:** `bbf8d7b6116d9f04023691e98dc91f5292046b50`
**FINAL_HEAD tree:** `863d5128879c8c21bd71a278841e0037070f302f`
**PUSHED:** NO  **RELEASED:** NO  **BRANCH CREATED:** NO  **NEW DEPENDENCIES:** 0

---

## C5.1 Verdict

# `PASS_STRUCTURAL_ONLY`

> The charter's success criterion is:
> *"exact-head installed extension and real Codex handshake proven."*
>
> **What is proven:** the bounded P1 correction is complete and proven by
> **50 executed witnesses** against the **real production classes** and the
> **real AF_UNIX transport**; the exact-head VSIX is built, packaged, and
> its embedded `extension.js` is **byte-identical** to the qualified
> production bundle; the VSIX **installs successfully** into a disposable
> VSCodium instance; the **real Codex CLI** registers, resolves and enables
> the `clinemm` MCP server through the documented configuration; and the
> **real MCP stdio handshake** — the exact transport Codex Desktop uses —
> proves tool discovery (exactly two tools), successful status reads,
> foreign-session refusal, disconnected-instance failure, and no new agent
> execution.
>
> **What is NOT proven:** observation against a **running installed
> extension host**, and a **real Codex Desktop agent turn**. Both are
> blocked by **host-level environment conditions** that were proven by
> execution, reproduced with stock tooling, and have nothing to do with
> this ACT's code:
>
>   1. The Electron extension host dies with `SIGSEGV` (exit 139) when
>      launched from this agent shell. Other VSCodium instances, launched
>      outside this shell, DO run on this host — but the operator's live
>      instances are `EPERM`-protected from this agent.
>   2. Every Codex configuration-load path fails with *"Failed to
>      synchronize managed preferences"* because Codex loads **macOS MDM
>      managed preferences** and no MDM domain exists on this host. The
>      **stock Codex with no MCP server at all** fails identically.
>
> Hence `PASS_STRUCTURAL_ONLY` rather than `PASS_READONLY_LIVE`. The
> charter's own escape hatch applies: *"If the installed host cannot run in
> the execution environment, record `LIVE_UNOBSERVABLE` and provide the
> exact operator procedure. Do not fabricate the receipt."* It is recorded
> as `LIVE_UNOBSERVABLE`; the exact operator procedure is
> `OPERATOR-PROCEDURE.md`; and no receipt is fabricated.

---

## C5.2 Why not the other verdicts

| Verdict | Why not |
|---|---|
| `PASS_READONLY_LIVE` | Requires the **exact-head installed extension** to be observed **and** a **real Codex Desktop handshake**. The installed extension host cannot be launched on this host (SIGSEGV) and the Codex agent turn cannot start (macOS MDM config-load failure). Both are proven environment conditions, not gaps in the evidence. |
| `HALT_<reason>` | **No new P0 was demonstrated.** The four defects this ACT corrected were **P1** transport/lifecycle defects in a default-off, read-only, local-only diagnostic seam. The correction closed all four in one cycle. No security boundary was broken; no pre-existing product semantic was disturbed; the C9/C10, BCB, Elm, approval-gate and session-ownership surfaces are byte-unchanged. |
| `CAPTURE_INSUFFICIENT` | The evidence **is** sufficient for the C1/C2 and the transport-level C3/C4 questions, and it is sufficient to establish the binding at the transport layer (the same `sessionId`/`taskId`/`runId` the runtime owns, over the same AF_UNIX socket the extension host binds). What it cannot establish is the **installed-instance** binding and the **Codex Desktop agent-turn** binding — and those are blocked by **proven environment limits**, not by thin capture. The charter explicitly directs `LIVE_UNOBSERVABLE` + an operator procedure for exactly this case. |

---

## C5.3 What was delivered

| # | Item | State |
|---|---|---|
| 1 | Explicit instance ownership (`owner.json`, live-owner fail-closed, ownership-scoped cleanup, `CLINEMM_CONTROL_SEAM_FORCE` escape hatch) | **DONE** |
| 2 | Every outstanding request settled (response / close / error / FIN / timeout / dispose / dead-transport) | **DONE** |
| 3 | Bounded NDJSON (64 KiB accumulated line, oversized unauthenticated input rejected, connection closed) | **DONE** |
| 4 | Validated opt-in record (parsed; `enabled: true` required) | **DONE** |
| 5 | The two-operation read-only registry | **PRESERVED** |
| 6 | Real AF_UNIX transport tests with all four required negative controls | **DONE** — 21 new witnesses, 50/50 total |
| 7 | Focused tests, typecheck, lint, bundle build | **DONE** — all exit 0 |
| 8 | VSIX produced, identity recorded, embedded bundle matched | **DONE** |
| 9 | Installed-instance qualification | **`LIVE_UNOBSERVABLE`** — operator procedure provided |
| 10 | Real Codex handshake | **PARTIAL** — MCP server registered and resolved by the real Codex CLI; the MCP stdio handshake itself proven; the **agent turn** is `LIVE_UNOBSERVABLE` |
| 11 | The epic board | **updated ONCE** |

---

## C5.4 The executed evidence, at a glance

```
Focused tests        50/50 PASS  (4 files; 21 new QUAL01 + 21 RECON01 + 5 proxy + 3 production-shape)
TypeScript           EXIT 0      (tsc --noEmit; tsconfig.vscode-compat.json)
Lint                 EXIT 0      (biome, 14 control-seam files; 2821 files package-wide; proto-lint clean)
Webview build        EXIT 0      (built in 51.38s)
Extension bundle     EXIT 0      (28 047 098 bytes; sha256 63e79d80f3b216ad7009e1ed5ab8f1c0951d742a791fc95632b3e21b0cf6fa1b)
VSIX                 EXIT 0      (65 335 668 bytes; sha256 7825199be6e0270dfd2c1fce0e090048e83c05385924954199fcdf5dd64333c5)
Embedded bundle      IDENTICAL   (same sha256 as the qualified production build)
VSIX install         EXIT 0      ("was successfully installed" into disposable VSCodium 1.143.17232)
Real Codex CLI       REGISTERED  (codex mcp get/list/doctor → clinemm, enabled, stdio, "MCP servers 1")
Real MCP handshake   PROVEN      (2 tools; capabilities; get_run; foreign refused; no_instance on disconnect)
Live AF_UNIX         PROVEN      (0700 dir, 0600 socket/token/owner; concurrent instance refused; owner intact)
```

---

## C5.5 Risk register

| Severity | Count | Items |
|---|---|---|
| **P0** | **0** | — |
| **P1** | **0** | — (the four C1 defects are closed) |
| **P2** | **2** | See below |

### P2 items

| # | Item | Disposition |
|---|---|---|
| R-A | The AF_UNIX path-length constraint (104 usable bytes on macOS). | **Carried forward unchanged** from RECON01. The fail-closed actionable error is preserved; `OPERATOR-PROCEDURE.md` §1 mandates a SHORT `CLINE_DIR`. |
| R-B | `@modelcontextprotocol/sdk@1.30.0` is below the fix floor for five advisories. | **Carried forward unchanged.** This ACT adds NO new MCP surface and changes NO protocol behaviour. The seam's server-side MCP surface (a local stdio server with no OAuth, no redirect, no HTTP, no SSE) is unchanged. |

### Carried forward unchanged from RECON01 / the predecessor

| # | Item |
|---|---|
| R-02 | The cloud start path's open local gate. |
| R-03 | The SDK file-read executor's workspace containment gap. |
| R-07 | MCP stdio spawn authority unchanged. |
| R-08 | The Hub is CLI-only. |
| — | The MCP OAuth / redirect advisory. |

---

## C5.6 Explicit non-claims

- **No installed-instance observation is claimed.** No `clinemm_get_run`
  result in this evidence was produced by a running installed extension
  host.
- **No real Codex Desktop agent turn is claimed.** The `codex exec` /
  `thread/start` invocations failed at configuration load; the tool calls
  were made through a real MCP stdio client against the real proxy, which
  is the same transport and the same protocol, but it is **not** a Codex
  Desktop turn and is not described as one.
- **The 50 passing tests do not prove the seam is *safe*.** They prove the
  enumerated properties. The trust argument rests on the **absence** of
  reaching references — a structural argument about the diff surface.
- **The predecessor's 558-commit analysis was not repeated.** Its
  R-02/R-03/R-06/R-07/R-08 findings are carried forward verbatim.
- **Nothing was pushed, released, or published.** A VSIX was produced in
  the repo-local `dist/`; no marketplace publication and no install into
  the operator's real VSCodium profile occurred.
- **No upstream integration was re-reviewed** and **the MCP control plane
  was not redesigned**, per the charter.
- **The operator's live VSCodium instances were not touched** — the
  attempts to install into them failed with `EPERM` and changed nothing.

---

## C5.7 The successor gate — UNCHANGED

The charter says: *"Only after `PASS_READONLY_LIVE`, authorize design of the
first narrowly scoped mutation operation, with separate approval,
idempotency, session-fencing and partial-failure contracts."*

**This ACT did not reach `PASS_READONLY_LIVE`.** The mutation-operation
design is therefore **NOT authorized** by this ACT. The operator procedure
in `OPERATOR-PROCEDURE.md` closes the gap: once the operator records the
installed-instance observation and the real Codex Desktop handshake, the
verdict can be re-evaluated as `PASS_READONLY_LIVE` and the successor may
be considered — **with separate approval, idempotency, session-fencing and
partial-failure contracts**, as RECON01 §C6.5 already specified.

---

## C5.8 Evidence index

| File | Content |
|---|---|
| `00-identity.md` | C0 — identity, predecessor consumption, protected state, toolchain |
| `01-correction.md` | C1 — the four defects, the correction, the executed witnesses, the conservation argument |
| `OPERATOR-PROCEDURE.md` | C3/C4 — the exact operator procedure that closes `LIVE_UNOBSERVABLE` |
| `03-build-and-package.md` | C2 — the gates, the VSIX identity, the embedded-bundle match |
| `04-live-qualification.md` | C3/C4 — what was observed, what was not, and the proven causes |
| `05-verdict.md` | C5 — this file |
