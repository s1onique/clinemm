# EPIC-AUTHENTICATED-DEV-CAPABILITIES

> Authenticated access to developer credential surfaces — `~/.aws/`, `~/.kube/`, `~/.docker/config.json`, `~/.config/gh/hosts.yml`, etc. — without simply exposing those credentials to the model. Distinct from `safe-yolo-seatbelt.md` (which establishes the read/deny boundary under YOLO) and from `approval-protection.md` (which covers command + editor/tool approval semantics). See `.factory/epic-board.md` for the active index.

## Current status

- Status: DEFER (intentionally not current execution debt; do **not** auto-promote without a fresh ACT — see reopen conditions below).
- Priority: P1 (P1 because it is gated on a bounded design space, not because it is the next ACT to run)
- Current frontier: design-space ACT (working label `AUTH-DEV-CAP-DESIGN01`); no implementation ACT is queued.
- Blocked by: the V1 sensitive-read confinement contract (per `safe-yolo-seatbelt.md`) was deliberately scoped to **SSH / GnuPG / macOS-keychain** and **excluded** `~/.aws/`, `~/.kube/`, `~/.docker/config.json`, `~/.config/gh/hosts.yml`. The design ACT for the deferred family below must propose how to handle the excluded surfaces without breaking the V1 boundary.

## Contract / durable conclusions

- **V1 boundary is preserved.** Per `safe-yolo-seatbelt.md`, the V1 sensitive-read confinement is **curated-deny-list under the opt-in**, not blanket denial. The V1 list is SSH / GnuPG / macOS-keychain. The `~/.aws/`, `~/.kube/`, `~/.docker/config.json`, `~/.config/gh/hosts.yml` paths were *deliberately* excluded from V1 (not overlooked). Any new ACT in this epic must not silently widen the V1 list.
- **The right primitive is a capability, not raw credential access.** The model should never read raw credentials. The intended design space:

```text
agent       → request capability  → host-side executor   → short-lived result
credentials → stay at host   (or, when the user opts in,
                                through a credential helper /
                                SSO / exec-plugin / agent framework)
```

  Pattern references: agent/credential-helper/SSO/exec-plugin style access rather than exposing credential bytes to the model.
- **Per-credential-family design.** Each credential family is its own design slice. Do not bundle AWS + Kubernetes + Docker + GitHub into one ACT.

  ```text
  ~/.aws/                       → credential_process / SSO / exec-plugin / agent
  ~/.kube/                      → exec credential plugin; kubeconfig auth-providers; never raw token
  ~/.docker/config.json         → credential helpers (osxkeychain, ecr-login, gcr, etc.)
  ~/.config/gh/hosts.yml        → gh auth token / `gh auth status` over a CLI rather than file read
  ```

- **User opt-in is mandatory.** No ACT in this epic may default-on. The default posture for these surfaces remains **out of scope** until the user explicitly opts in per-family.
- **Audit-trail parity.** Every capability invocation must log: ACT ID, source HEAD, credential family, capability name, host-side executor identity, start/end wall time, success/failure, captured-output **metadata** (not credential bytes). Logs append to `.factory/evidence/<ACT>/` (local-by-default).

## ACT ledger

| ACT / ID | Verdict | Head | Purpose |
|---|---|---|---|
| `AUTH-DEV-CAP-DESIGN01` (working label) | DEFER | — | Design-space ACT: enumerate the credential families, propose the host-side executor pattern per family, and propose the audit-log contract; produce *no* code in this ACT |
| `AUTH-DEV-CAP-AWS01` (working label) | DEFER on design | — | AWS surface: credential_process / SSO / exec-plugin / agent integration |
| `AUTH-DEV-CAP-KUBE01` (working label) | DEFER on design | — | Kubernetes surface: kubeconfig exec credential plugin + auth-provider integration |
| `AUTH-DEV-CAP-DOCKER01` (working label) | DEFER on design | — | Docker surface: credential helper integration (`osxkeychain`, `ecr-login`, `gcr`, etc.) |
| `AUTH-DEV-CAP-GH01` (working label) | DEFER on design | — | GitHub surface: `gh auth status` / `gh auth token` via host CLI rather than `~/.config/gh/hosts.yml` file read |

## Open work

- **`AUTH-DEV-CAP-DESIGN01`** (design space only). The deliverable is a markdown document under `.factory/epics/authenticated-dev-capabilities.md` (this file) that names: each credential family, the proposed host-side executor pattern, the audit-log contract, and an explicit **per-family opt-in surface** the user would toggle. No source code, no credential bytes, no live invocation in the design ACT.

Reopen / new-work conditions (i.e. when this epic auto-promotes from DEFER):

- The user asks for an authenticated capability that the current ClineMM cannot provide safely (→ the design ACT gets prioritized).
- An upstream Cline-- change exposes a credential surface that conflicts with the V1 boundary (→ the design ACT must precede any bridge ACT).
- A bounded credential-helper integration is proven safe in another ClineMM epic and can be reused (→ unblock the corresponding per-family ACT).

## Deferred work

The four per-family implementation ACTs (`AUTH-DEV-CAP-AWS01`, `AUTH-DEV-CAP-KUBE01`, `AUTH-DEV-CAP-DOCKER01`, `AUTH-DEV-CAP-GH01`) are all explicitly DEFER on the design ACT landing. They are listed here only so a maintainer reading the backlog can see the full shape of the deferred family, not because any of them is current execution debt.

## Historical detail

Epic opened by `ACT-CLINEMM-FACTORY-FUTURE-BACKLOG-CENSUS01` (this commit). The deferred family was identified during the Sensitive-Read V1 contract (`safe-yolo-seatbelt.md`): the V1 list was deliberately scoped to SSH / GnuPG / macOS-keychain, and the four other paths were deferred so a fresh ACT could address them with the host-side-executor pattern instead of a blanket deny. This epic gives those four paths a canonical detail file so they cannot be silently widened or forgotten.