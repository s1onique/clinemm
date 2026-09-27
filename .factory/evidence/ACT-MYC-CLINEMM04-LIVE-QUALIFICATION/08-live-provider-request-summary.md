PROVIDER BOUND REQUEST — LIVE-AWAITING

PROVIDER_BOUND_REQUEST_CAPTURED=LIVE_UNOBSERVABLE
PROVIDER_BOUND_PRIME_PACKET_COUNT=LIVE_UNOBSERVABLE
PROVIDER_BOUND_SENTINEL_PRESENT=LIVE_UNOBSERVABLE

EVIDENCE_CLASSIFICATION=PENDING
  When the operator runs LIVE-G with the env-flag recipe, the
  classification becomes:
    REAL_PRODUCTION_SEAM (because the existing capture writes are at
    the wire-serialization boundary, see hooks-adapter.ts:339-360 and
    the existing CLINE_CAPTURE_PROVIDER_REQUEST write path).
  It is NOT classified LIVE until a literal run produces the artifact.

WHY THIS ACT CANNOT PROVE LIVE-G WITHOUT A LIVE RUN
  ACT §15 forbids substituting:
    "recorder contents / hook unit tests / synthetic fixture"
  for the provider-bound proof. The diagnostic only stamps a
  captureId; it does not assert the provider-bound payload contained
  the prime_packet. That assertion requires `bun esbuild.mjs`,
  installing the resulting VSIX into a real VS Code with a real
  provider credential, then sending a real task and inspecting the
  capture files. None of those steps are executable in this session.

PRE-RUN ARTIFACT EXISTS (synthetic, NOT a substitute)
  apps/vscode/src/sdk/__tests__/myc-prime-automation.model-visible.c24-c-bridge.test.ts
    - runs the production buildAgentHooks.beforeModel end-to-end against
      a real buildAgentHooks instance with a hand-built
      AgentRuntimeStateSnapshot that has sessionId===conversationId.
    - confirms the prime_packet block is in the returned messages.
    - this is the synthetic bridge; it CANNOT substitute for a live
      provider-bound capture (ACT §15) but it proves the seam is
      wired in production code.

OBSERVABLE PROOF THE OPERATOR MUST GATHER (concrete steps)
  1. Build the dogfood VSIX from 7cbca60b0 (e.g. `cd apps/vscode &&
     bun esbuild.mjs --production && bunx vsce package --out
     dist/clinemm-4.1.16-7cbca60b0.vsix`); record byte size + sha256.
  2. Install it via `code --install-extension
     dist/clinemm-4.1.16-7cbca60b0.vsix`; confirm the Extensions UI
     shows version 4.1.16, identifier s1onique.clinemm.
  3. Export the env-flag recipe:
        export CLINEMM_MYC_PRIME_DIAG=1
        export CLINE_CAPTURE_PROVIDER_REQUEST=full
        export CLINE_CAPTURE_WIRE=true
        export CLINE_CAPTURE_CLEANUP=off
        export CLINE_CAPTURE_DIR=/tmp/clinemm-myc-prime-captures
  4. Launch VS Code with the workspace opened
     (code --extensionDevelopmentPath /path/to/clinemm).
  5. Seed the sentinel into myc as in 03-sentinel-seed.txt.
  6. Start one new task in ClineMM with the mundane prompt from ACT §8.
  7. Inspect:
        /tmp/clinemm-myc-prime-captures/wire/<captureId>.json
     and grep for both
        "<prime_packet source=\"myc\" session=\"" + "<SENTINEL_TOKEN>"
     Both MUST appear in the SAME payload file. captureId is printed
     in the chat view by the diagnostic stamps; copy it from there or
     from getMycPrimeLiveDiag(<sessionId>).capture.captureId.
  8. Copy the diagnostic snapshot by reaching into the extension
     process (dev harness `ext.evaluate` or a temporary probe) and
     serializing getMycPrimeLiveDiag(<sessionId>). Record all four
     sections (acquisition, lookup, injection, capture).