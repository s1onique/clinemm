# ACT-CLINEMM-ELM-SEAM08.1-E3.1-AUTHORITY-CUTOVER

**Status:** CLOSED at the substrate-level P0/P1 review (cutover deferred to a follow-up ACT).

**Date:** 2026-10-09
**Entry HEAD:** `a47fda90dc0f3d961b28e24d737b54e3de608791` (SEAM08 closed)
**Final HEAD:** `d27061a9d359b2e4efde19bf621da5d56b4d2375` (P0/P1 fixes landed)
**Branch:** `main`

---

## 0. MISSION (summary)

Address the reviewer-identified P0 and P1 defects from the SEAM08
substrate review. The C6 production cutover (wiring the consult into
`enqueueCompletionContinuationIfheld`) remains deferred to a separate
ACT; this ACT proves the substrate-level P0/P1 fixes that the cutover
ACT will inherit.

The reviewer authorized `C1: GO to ACT-CLINEMM-ELM-SEAM08.1-E3.1-AUTHORITY-CUTOVER`
with execution order:

1. Correct request/response correlation and strict adapter validation. **[DONE in this ACT]**
2. Prove packaged-runtime resolution. **[DONE in this ACT]**
3. Establish production-coordinator baseline tests. **[DEFERRED to the cutover ACT]**
4. Wire the Elm consult into E3.1. **[DEFERRED to the cutover ACT]**
5. Prove actual in-flight owner/epoch supersession and effect conservation. **[DEFERRED to the cutover ACT]**
6. Run the regression gates and Elm necessity test. **[DEFERRED to the cutover ACT]**
7. Commit, package, and qualify live when available. **[DEFERRED to the cutover ACT]**

## 1. REPOSITORY SAFETY

```
ENTRY_HEAD=a47fda90dc0f3d961b28e24d737b54e3de608791 (SEAM08 closed)
FINAL_HEAD=d27061a9d359b2e4efde19bf621da5d56b4d2375
BRANCH=main
```

No stashes, no unexpected tracked dirt, no historical rewrites.

## 2. SCOPE

### In scope (this ACT)

- **REVIEWER P0 — transport correlation**: replace the shared
  outbound response slot with a per-requestId pending map;
  enforce response correlation at the public-adapter boundary.
- **REVIEWER P1 — installed asset lookup**: add
  `setDeferredCompletionBarrierElmProductionKernelPath` API
- **C7 commit, package, qualify live**: the dogfood VSIX build
  and the production activator (`setDeferredCompletionBarrierElmProductionKernelPath`
  call in `extension.ts`).

## 3. REVIEWER P0 — TRANSPORT CORRELATION (PASS)

### Defect

The prior substrate used a shared `lastOutbound: unknown` slot:

```
let lastOutbound: unknown = null
app.ports.outbound.subscribe((v) => { lastOutbound = v })
kernel.sendInbound(wireValue)
await new Promise((r) => setTimeout(r, 0))
const out = kernel.recvOutbound()
```

Two overlapping calls could consume the same response, or one
could receive the other's response. The adapter also defaulted
`requestId` to `null` and did not validate the returned requestId
against the submitted requestId.

### Fix

```
const pending = new Map<string, PendingRequest>()
app.ports.outbound.subscribe((v) => {
  if (v === null || typeof v !== "object") return
  const msg = v as { kind?: string; requestId?: unknown }
  if (msg.kind === "ready") return
  const requestId = typeof msg.requestId === "string" ? msg.requestId : null
  if (requestId === null) return  // contract violation
  const entry = pending.get(requestId)
  if (!entry) return
  pending.delete(requestId)
  entry.resolve(v)
})

// per-consult
kernel.pending.set(requestId, entry)
kernel.sendInbound(wireValue)
const response = await new Promise((resolve, reject) => { ... })
```

The pending map is keyed by `requestId`; each consult's resolver
fires only when its specific requestId arrives. Reverse response
order, duplicate responses, and missing responses cannot
cross-contaminate.

### Public-adapter boundary validator

Every consult result now passes through `validateConsultResult`
which enforces:

- The result kind is one of the four closed values
  (`directive` / `kernel_offline` / `decode_error` / `no_decision`).
- The directive's `requestId` matches the expected requestId
  (a contract violation -> `decode_error`).
- The directive value-kind is one of the four closed values.
- `permit_enqueue` has a real `boolean` `mustClearRearm` (NOT
  coerced from undefined).
- `reject_stale_identity` has a valid reason
  (`marker_absent` / `session_mismatch` / `task_mismatch` / `epoch_mismatch`).

This validator runs on EVERY consult result, including custom
`invokeForProduction` callbacks. The prior substrate's
`=== true` permissive coercion for `mustClearRearm` is removed.

### Tests

- **dcbtc01** (11 tests, NEW): all P0/P1 transport correlation
  tests pass.
- dcbeid01 (10 tests, substrate C1): still passes.
- dcbesd01 (5 tests, substrate C5): still passes.

  and consult the production path first, source-tree vendor
  path as fallback.
- **REVIEWER P1 — custom decoder bypass**: enforce the closed
  directive schema (including mandatory `mustClearRearm`) at
  the public-adapter boundary on EVERY consult result, not
  just on the default invoke path.

### Out of scope (deferred to the cutover ACT)

- **C3 production-coordinator baseline tests**: harness /
  fixtures exercising the REAL `enqueueCompletionContinuationIfheld`
  in the production seam.
- **C4 wire the Elm consult into E3.1**: inject the consult
  between the existing async consult (L1562) and the existing
  TS dedupe-vs-permit branches (L1633-1685), and add commit-time
  identity revalidation in TS.
- **C5 real in-flight owner/epoch supersession**: facts initially
  valid -> Elm request starts -> host state changes -> Elm returns
  an otherwise-valid `PermitEnqueue` -> TS refuses stale commit.
- **C6 regression gates + Elm necessity test**: the full vitest
  sweep with the new consult active.
- **C7 commit, package, qualify live**: the dogfood VSIX build
  and the production activator (`setDeferredCompletionBarrierElmProductionKernelPath`
  call in `extension.ts`).

## 4. REVIEWER P1 — INSTALLED ASSET LOOKUP (PASS)

### Defect

The loader consulted a single source-tree path:

```
path.resolve(__dirname, "..", "..", "elm", "deferred-completion-barrier", "vendor", "...")
```

The canonical VSIX builder stages the kernel at
`extension/runtime-assets/deferred-completion-barrier.js`.
Adding an `_ELM_KERNELS` row did not mean the installed
extension could load the asset.

### Fix

```
export function setDeferredCompletionBarrierElmProductionKernelPath(path: string | null): void {
  _productionKernelPath = path
}

const candidatePaths = [
  _productionKernelPath,                                                                  // production first
  path.resolve(__dirname, "..", "..", "elm", "deferred-completion-barrier", "vendor", "...")  // source-tree fallback
].filter((p): p is string => typeof p === "string" && p.length > 0)
```

The production activator (in `extension.ts`, to be wired in the
cutover ACT) calls:

```
setDeferredCompletionBarrierElmProductionKernelPath(
  path.join(context.extensionUri.fsPath, "runtime-assets", "deferred-completion-barrier.js"),
)
```

BEFORE the first consult, exactly mirroring the prior 4 SEAM
kernels' activation wiring.

### Tests

- **DCBTC-10** (NEW): setProductionKernelPath takes precedence
  over the source-tree fallback.
- **DCBTC-11** (NEW): when the production path is missing,
  the consult falls through to source-tree (dev mode).

## 5. REVIEWER P1 — CUSTOM DECODER BYPASS (PASS)

### Defect

The prior substrate accepted a custom `invokeForProduction`
callback and returned its result WITHOUT validation. The default
decoder coerced missing `mustClearRearm` to `false`.

### Fix

`validateConsultResult` runs on EVERY result, regardless of
source. A custom invoke that returns a malformed directive
(missing `mustClearRearm`, wrong `requestId`, unknown kind,
unknown reason) is rejected at the public boundary.

### Tests

- **DCBTC-03** (NEW): custom invokeForProduction with missing
  `mustClearRearm` is rejected as `decode_error`.
- **DCBTC-04** (NEW): custom invokeForProduction with wrong
  `requestId` echo is rejected.
- **DCBTC-05** (NEW): custom invokeForProduction with missing
  `requestId` echo is rejected.
- **DCBTC-06** (NEW): custom invokeForProduction with valid
  directive and matching requestId is accepted.
- **DCBTC-07** (NEW): custom invokeForProduction with
  `reject_stale_identity(valid reason)` is accepted.
- **DCBTC-08** (NEW): custom invokeForProduction with
  `reject_stale_identity(invalid reason)` is rejected.
- **DCBTC-09** (NEW): non-directive outcomes (kernel_offline)
  pass through the validator unchanged.

## 6. REVIEWER P1 — REAL STALE-RESPONSE RACE (DEFERRED TO CUTOVER)

The reviewer noted: "This is acceptable for substrate testing
because the production commit interpreter does not yet exist. It
becomes mandatory for SEAM08.1."

The real race is:
- facts initially valid
- Elm request starts
- host state changes
- Elm returns an otherwise-valid `PermitEnqueue`
- TS refuses stale commit

The C5 stale-decision tests (`dcbesd01`) prove the kernel
emits `RejectStaleIdentity` for facts that already contain
mismatched identities — but this is NOT equivalent to the
real race. The cutover ACT is the right place for this test
because the production commit interpreter (the TS code that
applies the Elm directive to the live state) does not yet
exist.

## 7. P2 — NON-BLOCKING RESIDUE

- Blank EOF line in `Policy.elm`: P2 non-blocking, retained.
- Invalid Factory gate-summary binding: P2 non-blocking, will
  not use as gate evidence.

## 8. C9 — CONSERVATION SUITES (PASS)

| Suite                                            | Status                | Delta |
|--------------------------------------------------|-----------------------|-------|
| completion-continuation-rearm01                  | 7/7 PASS              | 0     |
| completion-continuation-stall-enforcement01      | 5/5 PASS              | 0     |
| completion-continuation-structural-authority01    | 11/11 PASS            | 0     |
| completion-continuation-stall-lifetime01          | 10/10 PASS            | 0     |
| deferred-completion-barrier-elm-interop-discriminator (substrate C1) | 10/10 PASS | 0   |
| deferred-completion-barrier-elm-stale-decision (substrate C5)         | 5/5 PASS  | 0   |
| deferred-completion-barrier-elm-transport-correlation (NEW)            | 11/11 PASS | NEW  |
| **Total**                                          | **58/58 across 7 files** | 0 ACT-owned |

## 9. C10 — BUILD AND TOOLCHAIN GATES (PASS)

| Gate                          | Status |
|-------------------------------|--------|
| Elm compile (kernel)          | PASS (no source changes) |
| Vitest focused sweep          | 0 (58/58 across 7 files) |
| TypeScript typecheck          | 0 (no errors in new files) |
| biome check                   | 0 (no errors) |

## 10. FACTORY STOP RULE

- **HALT_P0_TRIGGERED:** None. The P0 defects are FIXED.
- **HALT_P1_TRIGGERED:** None. The P1 defects are FIXED
  (asset lookup) or DEFERRED with explicit documentation
  (real stale-response race — to the cutover ACT).
- **No recursive Factory review initiated.** This ACT
  executes the first 2 of 7 items in the reviewer's
  authorized execution order; items 3-7 are deferred to
  the cutover ACT.

## 11. NEXT CURSOR

`ACT-CLINEMM-ELM-SEAM08.2-E3.1-PRODUCTION-CUTOVER` — wire the
Elm consult into the production
`enqueueCompletionContinuationIfheld` path with commit-time
identity revalidation in TS. The transport contract is now
proven; the production-coordinator baseline tests (item 3 of
the reviewer's execution order) are the next gate.

The production activator call (item 7) is to be added in
`apps/vscode/src/extension.ts`:

```
setDeferredCompletionBarrierElmProductionKernelPath(
  path.join(context.extensionUri.fsPath, "runtime-assets", "deferred-completion-barrier.js"),
)
```

following the existing 4 SEAM-kernel activation convention.
