32-strategy-c-entitlement.md
=============================

# Entitlement feasibility for `com.apple.developer.endpoint-security.client` — CORRECTION01

## What Apple documents

The `com.apple.developer.endpoint-security.client` entitlement is the
ONLY entitlement under which an EndpointSecurity client may be created.

Reference: Apple Developer documentation,
  https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.developer.endpoint-security.client

Per the documentation:
  - The entitlement is required for any process that creates an ES
    client (`es_new_client`, `es_new_client_with_config`,
    `es_new_descendants_client`).
  - The entitlement is requested from Apple; Apple grants it on a
    per-developer-account basis. Apple may reject the request if the
    use case is not aligned with Apple's policies.
  - The entitlement is NOT the same as root. An entitled process can
    create ES clients without running as root, but the binary still
    must be signed by a Developer ID identity that the entitled team
    owns.
  - Distribution grants may differ from development grants (Apple
    capability guidance notes that the same capability may require
    a separate grant for Developer ID distribution vs. local
    development). Keep distribution feasibility UNKNOWN until
    explicitly checked.

## What this means for ClineMM

For ClineMM to exercise `es_new_descendants_client()` on the current
Factory substrate, the following gates must all be cleared:

  G1. The Team that signs the helper must hold the entitlement.
      Status: UNKNOWN (not requested; not granted).

  G2. The signing identity must be a Developer ID (not linker-signed
      adhoc). Status: NOT_CURRENTLY (helper is linker-signed adhoc;
      re-signing requires the Developer ID certificate chain).

  G3. The runtime host must be on an Apple beta SDK generation /
      macOS 27-era runtime that ships `es_new_descendants_client()`.
      Status: NOT_CURRENTLY (Factory substrate is macOS 14.7.4
      Sonoma, which does not expose the symbol — and per Apple the
      symbol is Beta; per external implementation work it is a
      macOS 27-era API absent from macOS 26.x SDK/runtime).
      CORRECTION01: this gate is NOT "macOS 15+"; it is "current
      Apple beta SDK / macOS 27-era runtime". Do not infer "macOS 15"
      from SDK 14 lacking the symbol.

  G4. The descendants-client API is documented as "Beta". ClineMM
      product policy on Beta-only Apple APIs: PENDING (no prior
      decision recorded in the Factory ACTs for ES Beta APIs).

If any of G1/G2/G3 is FALSE, Strategy C cannot be exercised at all on
that host. On the current Factory substrate, G2 and G3 are both FALSE
right now, so Strategy C is doubly-gated. The live
`es_new_client() rc=5` evidence correctly proves the current signing
state lacks the entitlement, NOT that a future ClineMM build must
use the current signing formulation.

## What this ACT recommends

ClineMM should pursue Strategy C as a SEPARATE RESEARCH TRACK:

  - File an entitlement request with Apple at the appropriate
    time (when the ClineMM team has a Developer ID identity and an
    Apple Developer account that wants this entitlement).
  - Re-evaluate Strategy C when the Apple beta graduates to a
    release that ships on a ClineMM-supported macOS floor and the
    ClineMM team has both a Developer ID signing identity and an
    Apple-granted entitlement. (This is a moving target; do not
    assume "macOS 15" is the floor.)
  - Until all of G1/G2/G3/G4 are cleared, the production contract
    is Strategy B.

This ACT does NOT fake-sign the entitlement. The substrate-level
test we ran (es_new_client rc=5 with the existing adhoc-signed
helper) confirms the kernel correctly rejects unentitled clients; no
production change should try to bypass that gate.

## Classification

  ENTITLEMENT_AVAILABILITY      = UNKNOWN
  DISTRIBUTION_FEASIBILITY      = UNKNOWN (may differ from dev grant)
  CURRENT_APPLE_BETA_API_FLOOR = macOS 27 / current beta SDK generation
  CURRENT_SONOMA_SUBSTRATE     = UNAVAILABLE
  BETA_API_ACCEPTANCE          = PENDING

  STRATEGY_C = ARCHITECTURALLY_PROMISING
             / CURRENTLY UNAVAILABLE
