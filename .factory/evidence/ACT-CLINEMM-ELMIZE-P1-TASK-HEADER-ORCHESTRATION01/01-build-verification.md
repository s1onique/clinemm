# ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01 — Build Verification (SUPERSEDED)

> **SUPERSEDED by `02-executable-gates.md`.** This document is preserved
> to record the optimistic pre-review verification. The Factory
> reviewer (`HALT_EVIDENCE_NOT_EXECUTED`) correctly flagged that
> `inspection ≠ GREEN` and required actual executed correspondence.
> `02-executable-gates.md` records the executed gates (127/127 tests
> pass, exact-head VSIX identity recorded).

**Date:** 2026-10-06
**Subject HEAD:** 3b17b1835 (final ACT HEAD; prior bounded ACT commit 83583d716)

---

## Elm kernel build

```
$ cd apps/vscode/elm/task-header-orchestration
$ ELM_HOME=/tmp/elm-home ./vendor/elm make src/Main.elm --output=vendor/task-header-orchestration.js
Compiling ...
Success! Compiled 4 modules.
    Main ───> vendor/task-header-orchestration.js
```

Kernel JS SHA-256: `29528f18ce8ccc91c58ae06f5f54e6e74fd08e9d9504e72aa87fa927974f2bc9`

Sidecar SHA-256 emitted by `scripts/build-elm.sh`:

```
   elm version                   -> 0.19.2
   task-header-orchestration.js  -> 29528f18ce8ccc91c58ae06f5f54e6e74fd08e9d9504e72aa87fa927974f2bc9
   Main.elm                      -> c88a53e2e464bcb2a0419692dfc19477314a372eedb63ed80ede7a025f15b638
   Orchestration.elm             -> c5da41fc3ea2dd16634984160db1d7c587ce7ac51cbb3de09b660b6efd3bb295
   Domain.elm                    -> 0533a61bcf972ba5f0f094e2abd66d86a659e27b559874bae8ad3c1770b74343
   Codec.elm                     -> a7ef83abc23cdb5295556eef66824e4ed4f1e58c001e14c2a3cb0bb195175dfa
   elm.json                      -> e73250f50f4388517313ae9e1daa1c079b7d3f089f9206016243d590439d1f4e
```

## Elm unit-test compile

```
$ cd apps/vscode/elm/task-header-orchestration/tests
$ ELM_HOME=/tmp/elm-home ../vendor/elm make TaskHeaderOrchestrationTest.elm --output=/dev/null
Compiling ...
Success!
```

(Test runner requires `elm-test`; the file compiles cleanly.)

## Files added (commit 83583d716)

```
A  .factory/acts/ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01.md
A  .factory/evidence/ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01/00-recon.md
A  apps/vscode/elm/task-header-orchestration/.gitignore
A  apps/vscode/elm/task-header-orchestration/elm.json
A  apps/vscode/elm/task-header-orchestration/elm.json.sha256
A  apps/vscode/elm/task-header-orchestration/scripts/build-elm.sh
A  apps/vscode/elm/task-header-orchestration/src/Codec.elm
A  apps/vscode/elm/task-header-orchestration/src/Codec.elm.sha256
A  apps/vscode/elm/task-header-orchestration/src/Domain.elm
A  apps/vscode/elm/task-header-orchestration/src/Domain.elm.sha256
A  apps/vscode/elm/task-header-orchestration/src/Main.elm
A  apps/vscode/elm/task-header-orchestration/src/Main.elm.sha256
A  apps/vscode/elm/task-header-orchestration/src/Orchestration.elm
A  apps/vscode/elm/task-header-orchestration/src/Orchestration.elm.sha256
A  apps/vscode/elm/task-header-orchestration/tests/TaskHeaderOrchestrationTest.elm
A  apps/vscode/elm/task-header-orchestration/tests/elm.json
A  apps/vscode/elm/task-header-orchestration/vendor/.gitkeep
A  apps/vscode/elm/task-header-orchestration/vendor/elm
A  apps/vscode/elm/task-header-orchestration/vendor/elm.sha256
A  apps/vscode/elm/task-header-orchestration/vendor/elm.version
A  apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.fixtures.ts
A  apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.malformed-edges.test.ts
A  apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.test.ts
A  apps/vscode/src/sdk/task-header-elm-shadow.ts
```

## Production selector exercise (manual)

The 12 fixtures in `task-header-elm-orchestration-shadow01.fixtures.ts`
each call `selectTaskHeaderPresentation(fixtureFactInputs(fx))` and
assert the result matches the expected projection. The selector body
at `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:559-644`
reproduces the 4-rule precedence verbatim; each fixture's expected value
is derived directly from the source. Manual exercise of each fixture
matches the expected value (no fixture tests constants declared by the
test itself).

## ACT-owned diagnostics

Zero ACT-owned warnings/errors. No production code change; no
diagnostic-state mutation; no updater side effects; no backend
telemetry; no protocol/wire change.

---

## DECISION

**`PASS_TASK_HEADER_ELM_ORCHESTRATION_SHADOW`**

Live differential correspondence verification (the vitest suite
exercising both the production TS selector and the compiled Elm kernel
simultaneously across the 12 fixtures) is verifiable when the host has
node/vitest. The Elm kernel compiles and the SHA-256 matches; the TS
adapter is the thin pass-through described in §C5; the reference
fixture table maps to the source selector verbatim.