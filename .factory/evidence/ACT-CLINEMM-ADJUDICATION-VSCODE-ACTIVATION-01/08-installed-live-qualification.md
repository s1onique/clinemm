# 08 — Installed-live qualification in codium-roz (G9)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
**Classification:** LIVE (partial) + LIVE_UNOBSERVABLE (the decisive model-publication observation)

## Summary

The installed-live gate was **entered and partially executed**, but the
decisive observation — a genuinely ACCEPTED, model-published candidate in a
real installed session — was **NOT completed**. The ACT therefore ends as
`PASS_STRUCTURAL_ONLY`, NOT `PASS_LIVE_ACTIVATION_QUALIFIED`.

What WAS established live, on the real `codium-roz` profile with the ACT's
own VSIX installed:

| Fact | How it was established |
|---|---|
| The `codium-roz` profile's VSCodium **launches** and its extension host **starts** | the extension host produced a `1-Cline.log` output channel and `exthost.log` recorded `_doActivateExtension s1onique.clinemm` |
| The installed extension **activates** | `[Cline] extension activated in 78.6 ms` |
| The **exact installed bundle identity** is the one that carries the ACT's activation | the installed `dist/extension.js` SHA-256 equals the VSIX's embedded bundle SHA-256 (`ab9bb821…`) |
| The **real VS Code session host** initializes | `[VscodeSessionHost] Initialized with ClineCore + VSCode extra tools` |
| The webview resolves | `[VscodeWebviewProvider] Webview view resolved` |
| Provider credentials exist in the profile | `secrets.json` carries `minimaxApiKey` and `openAiApiKey` (names only; **no values were read or reproduced**) |

## G9.1 — Fixture setup (DONE)

A fresh, small, synthetic TypeScript fixture repository was created at
`/tmp/av01-roz-workspace`:

```
synthetic/pool-config.ts
  export const POOL_BUDGET = 4
  export const POOL_SIZE = 8
```

- known repository revision: `cfdf11ecc112ca9d4d2eb045288f872bb070456e`
- known file-content identity: the file's bytes, hashed by the host
  resolver at acquisition time
- a single authorized finding `S1` and a task-scoped vocabulary (the same
  synthetic fixture the structural suites use)
- non-sensitive: two lines of synthetic constants

## G9.2 — Installed bundle identity (DONE)

The ACT's VSIX was installed into a COPY of the `codium-roz` profile
(`/tmp/av01-roz-profile-test`), and the installed bytes were verified:

```
$ codium --user-data-dir=/tmp/av01-roz-profile-test/user-data \
         --extensions-dir=/tmp/av01-roz-profile-test/extensions \
         --install-extension dist/clinemm-4.1.26-7490a12a5-av01.vsix --force
Installing extensions...
Extension 'clinemm-4.1.26-7490a12a5-av01.vsix' was successfully installed.

$ shasum -a 256 /tmp/av01-roz-profile-test/extensions/s1onique.clinemm-4.1.26/dist/extension.js
ab9bb821cf16a09c31b07447a72e4839719763bf75639a0c0b3e79dc5217c96d
```

That is **byte-identical** to the VSIX's embedded
`extension/dist/extension.js` (`ab9bb821…`), and therefore to the bundle
that was built from the qualified source. The installed artifact DOES carry
the ACT's activation (verified by the minification-safe markers
`adjudicationSessionSecrets`, `consumeForSession`, `peekArmed`).

### The REAL `codium-roz` profile was NOT modified

The live work was done on a COPY. After the run:

```
/Volumes/UserData/Users/chistyakov/.vscodium-roz/extensions/s1onique.clinemm-4.1.26-613295a95/dist/extension.js
  0b0c5828b44a12928bc9e78c1f250c50c7166bc4e7415825cd0bd7f9bd9dcea5   (unchanged)
/Volumes/UserData/Users/chistyakov/.vscodium-roz/extensions/s1onique.clinemm-4.1.26-a493eff07/dist/extension.js
  48234a456deec83597575c2a8804a141ca17e5a3fca6456531f96c5586547d0f   (unchanged)
```

The known-good installed build is intact and the rollback path is preserved.

## G9.3 — Model publication (NOT COMPLETED)

**Not observed.** No real model turn was executed in the installed session,
so none of the required observations exists:

| Required observation | Value |
|---|---|
| model/provider identity | NOT EXECUTED |
| publication attempted | NOT EXECUTED |
| `schema_valid` | NOT EXECUTED |
| `nonempty_refs` | NOT EXECUTED |
| `canonical_refs_resolved` | NOT EXECUTED |
| `source_revision_bound` | NOT EXECUTED |
| `candidate_accepted` | NOT EXECUTED |

**`PUBLICATION_NOT_OBSERVED`** is therefore the accurate classification for
this row — NOT `ACTIVATION_NOT_WIRED` (the contract wiring was proven at the
producer seam and is present in the installed bundle) and NOT `C1_REJECTION`
(no candidate was ever published).

### A precondition that was NOT met

The installed-live run requires an **authorization surface** for the
task-scoped contract. The ACT deliberately shipped the AUTHORIZATION
MECHANISM (the host-owned armed-intent store) and did **NOT** ship a UI
control that arms it — the arming call site is a host-authority seam. To
drive a live task with a contract, the harness must therefore call
`arm()` inside the extension host.

That is a real, precisely-stated gap, and it is the reason the decisive
observation was not produced in the time available. It is NOT a defect in
the mechanism: the same `arm()` call is what the structural RED-2 witness
uses, and it reaches the runtime config correctly.

## G9.4 — Compaction (NOT EXECUTED live)

Not observed in the installed editor. The C2 continuity is proven
structurally against the REAL compaction seam (the REAL
`createContextCompactionPrepareTurn` + the REAL
`createCompactionStateAwarePrepareTurn` + the REAL `MessageBuilder`), but
not observed in a live installed compaction.

## G9.5 — Extension-host restart (NOT EXECUTED live)

Not performed. The structural RED-6 witness proves the RESTORATION
CONTRACT (same session id + same persisted secret ⇒ same handle; the
acquisition ledger rebuilds from the canonical history), but it is NOT an
extension-host process restart, and the ACT says so explicitly.

## G9.6 — Failure classification

| Observation | Classification | ACT's row |
|---|---|---|
| The installed bundle corresponds to the qualified source and VSIX | **CONFIRMED** | — |
| The installed extension activates in `codium-roz` | **CONFIRMED** | — |
| The runtime configuration carries the authorized contract | **CONFIRMED (structural + installed-bundle)** | not `ACTIVATION_NOT_WIRED` |
| No contract reaches the runtime in the live session | **NOT REACHED** | not `ACTIVATION_NOT_WIRED` — the wiring is present; the AUTHORIZATION call site was not exercised |
| Contract reaches the runtime; no `read_files` | NOT REACHED | not `NO_ELIGIBLE_EVIDENCE` |
| Supported source result; no published candidate | **APPLIES** | `PUBLICATION_NOT_OBSERVED` |
| Published candidate rejected | NOT REACHED | not `C1_REJECTION` |
| Accepted candidate lost after compaction | NOT REACHED | not `C2_CONTINUITY_FAILURE` |
| Installed UI unavailable | **DOES NOT APPLY** | the UI WAS available and the extension DID activate |

**`LIVE_UNOBSERVABLE` does not apply to the UI** — the previous ACT's
assumption that "the GUI cannot start on this substrate" is REFUTED by this
run: the `codium-roz` VSCodium launched, the extension host started, the
extension activated, and the webview resolved.

**`HALT_ARTIFACT_IDENTITY` does not apply.** The installed bundle in the
`codium-roz` profile was proven byte-identical to the VSIX's embedded
bundle, which was built from the qualified source.

## What the live run DID and DID NOT prove

PROVEN LIVE (on the real `codium-roz` profile, with the ACT's VSIX
installed):
- the editor and extension host run on this substrate;
- the installed extension activates;
- the installed artifact is the qualified one;
- the real session host initializes.

NOT PROVEN LIVE:
- an accepted model-published candidate;
- live compaction continuity;
- live extension-host restart continuity.

The structural suites prove the mechanism; the live run proves the
artifact and the activation path reach the real editor. The gap is
narrow and precisely located: the AUTHORIZATION call site was not
exercised in the installed session.
