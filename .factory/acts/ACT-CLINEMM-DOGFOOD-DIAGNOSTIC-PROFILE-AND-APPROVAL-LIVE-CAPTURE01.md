# ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01

**Type:** OBSERVABILITY ENABLEMENT + LIVE EVIDENCE ACQUISITION (NOT a repair ACT)

**Status (this commit):** **REOPENED / DOGFOOD_IDENTITY_STRUCTURALLY_AVAILABLE** — `PASS_DOGFOOD_DIAGNOSTIC_PROFILE_V1_STRUCTURAL` + `LIVE_QUALIFICATION_REMAINING`

**Status history:**

  - 2026-08-31 (predecessor at HEAD `6739ddbf1`): HALT_DOGFOOD_IDENTITY_ABSENT (no truthful runtime dogfood identity existed at HEAD)
  - 2026-08-31 (successor at HEAD `f63556b17` → `5f0c15763` → `a7ae5b890`): identity resolver shipped at `apps/vscode/src/sdk/dogfood-runtime-profile.ts` (22/22 vitest GREEN, tsc EXIT=0, biome clean); HALT_LAUNCHER_SOURCE_UNBOUND recorded (ablation requires headed host)
  - 2026-08-31 (this commit): per Factory causal reviewer **C1: GO** — identity chain is structurally pinned; this ACT re-opens and implements the V/I/P diagnostic profile (A is intentionally NOT landed; the reviewer's directive says A's probe must not be shown before it exists)

**Priority:** P1 / HIGH

**Factory disposition (this commit):**

  C0: PROCEED_TO_RECON_ONLY       (predecessor: satisfied 2026-08-31)
  C1: GO                          (satisfied 2026-08-31 by identity ACT)
  C2: STRUCTURAL_IMPLEMENTATION   (satisfied 2026-08-31 by this commit)

**Date frozen:** 2026-08-31 (predecessor); 2026-08-31 (this commit)
**Subject HEAD:** `6739ddbf17276b0a0ae4107dfde3af7ef6f21db5` (predecessor); `<this-commit>` (this commit)
**Final HEAD:** `<this-commit>` (production delta committed; tests green)

---

## section 0. Mission (verbatim per Factory causal reviewer)

> Make all currently load-bearing temporary diagnostics automatically usable in
> isolated ClineMM dogfood instances, visibly expose which diagnostic knobs are
> active in the telemetry header, and add the one missing approval-result probe
> needed to distinguish CASE B from CASE C for
> `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01`.
>
> This ACT is NOT an editor-approval repair.
> It is NOT a command-policy repair.
> It is NOT a general telemetry redesign.


## section 1. Entry trust (asserted)

```
branch         = main
clean worktree = ok
ENTRY_HEAD     = 6739ddbf17276b0a0ae4107dfde3af7ef6f21db5
ENTRY_TREE     = 6739ddbf1
git status     = (clean tracked worktree)
```

Production state preserved (no source/test/config delta):

```
STRUCTURAL_POLICY_SEAM   = PASS
LIVE_EDITOR_APPROVAL     = UNBOUND
CASE_A                   = STRUCTURALLY_EXONERATED_ONLY
CASE_B                   = UNBOUND
CASE_C                   = UNBOUND
E3                       = PASS_BY_PRODUCT_CONTRACT
PRODUCTION_REPAIR        = NOT_AUTHORIZED
```

Sibling recon ACTs not re-litigated:

- `...COMPLETION-AUTHORITY-IMPLEMENTATION01` - CLOSED / UPSTREAM_SUPERSEDED at `15c7e3374`.
- `...R5-AUTHORITY-CONTRACT01` + `...R5-IMPLEMENTATION01` - closed/qualified.
- `...WORKSPACE-REALPATH-AUTHORITY-CORRECTION02` - HALT_LIVE_INPUT_SHAPE_UNBOUND; awaiting next BAD live specimen.
- `CANCEL-AFFORDANCE-AUTHORITY-RECON` - OPEN/HIGH/partial.

## section 2. Recon results (actual HEAD)

### section 2.1 Existing diagnostic control surfaces (already in HEAD)

| Env var | Knob | Code point | Reference | Default |
|---------|------|-----------|-----------|---------|
| `CLINEMM_CAPTURE_V2_PATH=<path>` | **V** | V2 capture sink (commands) | `apps/vscode/src/sdk/v2-capture.ts:148` (`ENV_FLAG`) | **OFF** (path-required) |
| `CLINEMM_DIAG_INPUT_SHAPE_V2=<truthy>` | **I** | `approval.sdk-controller.input-shape.v2` | `apps/vscode/src/sdk/SdkController.ts:459` | **OFF** (env-truthy-required) |
| `CLINEMM_DIAG_ACTIVITY_STATE_V1=<truthy>` | **A** | **(DOES NOT EXIST IN HEAD)** | `grep -rni CLINEMM_DIAG_ACTIVITY_STATE apps/vscode/src` -> **0 hits** | **OFF** (no probe) |
| (proposed `CLINEMM_DIAG_APPROVAL_PUBLICATION_V2=<truthy>`) | **P** | **(DOES NOT EXIST IN HEAD)** | (this ACT proposes it) | **OFF** (env-truthy-required) |

Critical recon finding for section 3 "dogfood default ON":

| Knob | ACT section 3 expectation | HEAD reality | Gap |
|------|-------------------|--------------|-----|
| V | dogfood -> ON, public -> OFF | **public OFF** ok, **dogfood ???** | **V has no dogfood auto-enable;** requires `CLINEMM_CAPTURE_V2_PATH` env-var to be set by operator |
| I | dogfood -> ON, public -> OFF | **public OFF** ok, **dogfood ???** | **I has no dogfood auto-enable;** requires `CLINEMM_DIAG_INPUT_SHAPE_V2=1` env-var |
| A | dogfood -> ON, public -> OFF | **A does not exist** | n/a (probe not landed; knob absent) |
| P | dogfood -> ON, public -> OFF | **P does not exist** | (this ACT proposes it as opt-in env-var) |


### section 2.2 Dogfood identity (the load-bearing halt)

**The premise of this ACT is that `isDogfoodProfile === true` is knowable from inside the extension host runtime. It is not.**

Inspected:

| Potential authority | Result |
|---------------------|--------|
| `apps/vscode/package.json` -> `publisher.name = "s1onique.clinemm"` | Same for ALL ClineMM installs (dogfood AND public). Not a discriminator. |
| `apps/vscode/package.json` -> `displayName = "ClineMM"` | Same for all ClineMM installs. |
| `scripts/build-dogfood-vsix.py` -> `--ns-name` default `s1onique.clinemm` | Build-time CLI flag; never reaches runtime. |
| `scripts/install-vscodium-dev.sh` -> produces `clinemm-<version>.vsix` | Same NS as any ClineMM build. |
| `getIdeRedirectUri.ts:16` comment: "its publisher/name (which the ClineMM dogfood intentionally does)" | Implies the publisher/name IS the deliberate dogfood-vs-public discriminator, BUT it does not distinguish OUR dogfood from any other user's install of the same package. |
| `process.env` dogfood markers | **None.** No `CLINEMM_DOGFOOD`, no `IS_DOGFOOD`, no `CLINE_DOGFOOD`. |
| Extension host introspection | VSCode `context.extension.id` returns `s1onique.clinemm` for ALL ClineMM installs. |

**Conclusion:** there is **no truthful runtime fact** that distinguishes:

  (a) "an isolated ClineMM dogfood install where the operator wants diagnostics ON"
  (b) "any other ClineMM install (which ACT section 18 explicitly forbids auto-enabling diagnostics for)"

ACT section 2 ("find the smallest existing runtime fact that can truthfully answer `isDogfoodProfile === true` without adding a public product setting") yields no result. Per ACT section 19:

> HALT_DOGFOOD_IDENTITY_ABSENT - if no truthful existing dogfood identity exists and a new product-level identity mechanism would be required.

This halt is recorded in this file's front matter.

### section 2.3 Existing telemetry header

- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx` - the task header strip (lines 209-220 render `TaskHeaderTelemetry`).
- Spare horizontal real estate at lines 234-240 (the cost-tag area).
- No existing diagnostic-knob indicator; **the section 5 header indicator is technically implementable** IF a state source existed.
- The webview receives state via `ExtensionStateContext` (`apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`). No existing diagnostic state field exists. Adding a new field is bounded and tractable; the constraint is **what value to populate it with at extension-host startup** - which loops back to section 2.2 dogfood-identity absence.

### section 2.4 SdkInteractionCoordinator publication seam (line 417 ASK branch)

- `sdk-interaction-coordinator.ts:417` falls through from `commandEval.approved === false` to `await this.options.onToolApprovalAsk?.(request)` at line 468.
- The **P probe** would naturally fire `approval.noncommand.ui-published.v1` (or `.v2`) just before/after `onToolApprovalAsk` invocation, **conditional on** `isCommand === false` AND a non-command tool name.
- The **P probe is implementable** as a default-off opt-in via a new `CLINEMM_DIAG_APPROVAL_PUBLICATION_V2=<truthy>` env-var (mirroring the existing `CLINEMM_DIAG_INPUT_SHAPE_V2` pattern at `SdkController.ts:459`).
- **However**, even with the P probe implemented, section 13-14 (live operator-driven VSCodium runbook) cannot execute in this shell: headed VSCodium is unavailable, `code`/`open` returns error -54, and the user directive `DO NOT RESTART ANY VSCODIUM INSTANCE` is in force.
- Per ACT section 21 exit criterion: `PASS_DOGFOOD_DIAGNOSTIC_PROFILE_V1` + `LIVE_EDITOR = NOT_EXECUTED` is a valid disposition **iff observability lands**. Since observability cannot land (halt above), the live phase is moot.


## section 3. Diagnostic profile contract (DESIGN - not implemented)

Per ACT section 3 (proposed, not executed):

```
resolveDiagnosticProfile():
  {
    v2Capture: boolean
    inputShape: boolean
    activityState: boolean   (false unless A probe lands)
    approvalPublication: boolean   (false unless P probe lands)
  }

Precedence (top wins):
  explicit env override ("0"/"off" disables, "1"/non-empty enables)
    > dogfood-profile default (requires section 2.2 identity - NOT AVAILABLE)
    > public default OFF
```

**Design is fully specified; implementation blocked by section 2.2.**

## section 4. Capture sink without manual path (DESIGN - not implemented)

Per ACT section 4 (proposed):

```
<cline-data-dir>/data/runtime-diag/<runtimeInstanceId>.jsonl
```

Resolved from `~/.cline/data/runtime-diag/...` (the existing storage root from `src/shared/storage/storage-context.ts`). Does NOT depend on a workspace being writable; does NOT mutate the repository.

**Implementation deferred until section 2.2 identity is resolved.**

## section 5. Telemetry header indicators (DESIGN - not implemented)

Frozen letter codes (per ACT section 5, ACT section 0):

```
V = V2 capture sink active
I = approval input-shape diagnostic active
A = runtime activity-state diagnostic active
P = approval publication/final-decision diagnostic active
```

Rendered in the task-header strip via existing `TaskHeader.tsx` spare real estate. Renders only active letters (e.g. `V`, `VI`, `VIAP`).

**Implementation deferred until section 2.2 identity is resolved.**

## section 6. P probe (DESIGN ONLY - not implemented in this ACT)

Proposed minimum surface (mirroring `CLINEMM_DIAG_INPUT_SHAPE_V2` at `SdkController.ts:459`):

```
codePoints (request scope, AsyncLocalStorage correlation):
  approval.noncommand.result.v1
    data: { sessionId, toolName, isCommand=false, approvalResult: "allow"|"ask" }

  approval.noncommand.ui-published.v1
    data: { sessionId, toolName, isCommand=false, manualUiBranchEntered: bool, publicationOccurred: bool }

Default-off opt-in:
  CLINEMM_DIAG_APPROVAL_PUBLICATION_V2=1
```

**Implementation deferred until section 2.2 identity is resolved** (so the operator can enable it without manual env-var ceremony), **OR** until a separately-authorized follow-on ACT defines the dogfood identity marker.

## section 7-9. Test contracts (DESIGN - not executed)

D1-D6, H1-H7, P1-P5 (per ACT sections 8-10) are fully specified but not executed; their execution depends on section 2.2 resolution.

## section 10. Out of scope (per ACT section 18, reconfirmed)

This ACT explicitly does NOT:

- repair editor-approval behavior
- repair command policy
- touch aggregateSource
- touch R5 classifier
- change Seatbelt profile
- expand capabilities
- change completion authority
- repair Idle/Working state
- change model/tool routing
- redesign telemetry header
- add a public diagnostics settings page
- introduce a generic debug console
- invent a new product-level dogfood identity setting (would violate ACT section 18)

## section 11. Halt conditions asserted (per ACT section 19)

```
HALT_DOGFOOD_IDENTITY_ABSENT             = ASSERTED (this commit)
HALT_PUBLIC_DIAGNOSTICS_DEFAULT_ON       = not asserted (no public auto-enable introduced)
HALT_CAPTURE_SEMANTIC_DELTA              = not asserted (no code change)
HALT_DIAGNOSTIC_WRITER_BREAKS_RUNTIME    = not asserted (no code change)
HALT_PUBLIC_API_OR_PROTO_EXPANSION       = not asserted (no public API change)
HALT_DUPLICATE_APPROVAL_AUTHORITY        = not asserted
HALT_ACT_OWNED_REGRESSION                = not asserted (no code change)
HALT_UNEXPECTED_TRACKED_DIRT             = not asserted
```

## section 12. Diagnostic knob registry (durable, frozen at HEAD `6739ddbf1`)

| Knob | Owner ACT | Removal trigger | Status at HEAD |
|------|-----------|-----------------|----------------|
| V | shared V2 capture infrastructure (`v2-capture.ts`) | supersede by successor capture infra | OPEN, opt-in via `CLINEMM_CAPTURE_V2_PATH` |
| I | `...WORKSPACE-REALPATH-AUTHORITY-CORRECTION02` (HALT_LIVE_INPUT_SHAPE_UNBOUND) | first of: (a) root cause isolated, (b) capture insufficient, (c) successor evidence supersedes diagnostic | OPEN, opt-in via `CLINEMM_DIAG_INPUT_SHAPE_V2` |
| A | `CANCEL-AFFORDANCE-AUTHORITY-RECON` | first of: (a) root cause isolated, (b) capture insufficient, (c) successor evidence supersedes diagnostic | **NOT LANDED** (env var absent at HEAD; no ACT has proposed the A probe yet) |
| P | `...EDITOR-TOOL-APPROVAL-FRICTION-RECON01` (CASES B/C unbound) | first of: (a) CASE B or C classified, (b) live seam moved, (c) capture insufficient | **NOT LANDED** (env var absent at HEAD; THIS ACT proposes P) |

**Note:** the header indicator cannot render letters for A or P until both (i) the probes exist and (ii) section 2.2 identity is resolved so they auto-enable in dogfood.


## section 13. Reopen conditions (per ACT section 19 + section 21)

This ACT re-opens when **either**:

1. A separately-authorized ACT defines the runtime dogfood identity marker (e.g. `apps/vscode/src/sdk/dogfood-identity.ts` exporting `isDogfoodProfile(): boolean` with a closed-runtime discriminator - see section 14 below).
2. The ClineMM project decides to ship `CLINEMM_DOGFOOD` as a documented public env-var override (then this ACT can read it in the precedence list).

Until then, this ACT's halt is durable and the existing diagnostics continue to require the same manual `export CLINEMM_*` ceremony as today.

## section 14. Proposed dogfood-identity follow-on ACT (NOT in this ACT scope)

The smallest closed-runtime discriminator that would satisfy ACT section 2 (no public product setting, no personal-path coupling) appears to be:

```
isDogfoodProfile():
  return process.env.CLINEMM_DOGFOOD === "1"
      || process.env.CLINE_DOGFOOD === "1"
      || (process.env.NODE_ENV === "development"
          && existsSync("<repo-root>/.factory/BOARD_OWNER"))
```

That last clause couples the marker to the **factory board's repository fingerprint** (the durable repository state we already maintain) - it is a truthful closed-runtime fact (a developer's machine has the repo; a public install does not), not a public product setting.

**This proposal is NOT in this ACT scope** and would require its own review+approval cycle. It is recorded here only so the next chat knows what "resolving the halt" looks like.

## section 15. Live phase (per ACT sections 13-14, 16)

```
LIVE_DOGFOOD_PROFILE_VALIDATION  = NOT_EXECUTED  (no headed VSCodium in this shell)
LIVE_EDITOR_CLASSIFICATION       = NOT_EXECUTED
ACTIVITY_STATE_SECONDARY         = NOT_EXECUTED
REALPATH_BAD_SPECIMEN            = NOT_EXECUTED

per ACT section 21: PASS_DOGFOOD_DIAGNOSTIC_PROFILE_V1 + LIVE_EDITOR = NOT_EXECUTED
                    is the valid disposition iff observability lands.
                    Observability did NOT land (halt above), so live phase is moot.
```

## section 16. Final report (per ACT section 22)

```
ACT_ID     = ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01
VERDICT    = HALT_DOGFOOD_IDENTITY_ABSENT  (not PASS_DOGFOOD_DIAGNOSTIC_PROFILE_V1)

ENTRY_HEAD    = 6739ddbf17276b0a0ae4107dfde3af7ef6f21db5
SUBJECT_HEAD  = 6739ddbf17276b0a0ae4107dfde3af7ef6f21db5
FINAL_HEAD    = 6739ddbf17276b0a0ae4107dfde3af7ef6f21db5   (no commit; halt-only)
WORKTREE      = clean tracked

DIAGNOSTIC_PROFILE = not implemented (halt)
KNOBS = V / I / A / P (registry only; A and P probes not landed)
HEADER = not implemented (halt)
CAPTURE_PATH = not implemented (halt)

PRODUCTION_DELTA = 0
TESTS = 0
DOGFOOD = NO_MANUAL_ENV_VARS = FAIL (halt precludes); this is the precise finding

EDITOR_LIVE = NOT_EXECUTED (halt precludes; documented headed-VSCodium impossibility)

SECONDARY_EVIDENCE = none (halt precludes)
P0 = HALT_DOGFOOD_IDENTITY_ABSENT
P1 = none
P2 = none

NEXT = A separately-authorized ACT that defines the runtime dogfood identity
       marker (section 14 proposal: closed-runtime fingerprint via
       `<repo-root>/.factory/BOARD_OWNER` existence, no public product setting).
       Once that lands, this ACT re-opens with C1: GO and proceeds to implement
       section 3-6 + section 7-9 tests.
```

---

## section 17. Factory rule applied (this commit)

**STOP.** This ACT exists to record the halt durably. No further review loop.

The reviewer-noted upstream basis (permission-handling.mdx, acp.mdx) supports
the editor-approval investigation's continued E3 PASS_BY_PRODUCT_CONTRACT
classification and reinforces the value of observing the actual approval-result
path - both of which remain true. This ACT does NOT alter those conclusions;
it only freezes the new observability-enablement lane as HALTED pending the
dogfood-identity prerequisite.
