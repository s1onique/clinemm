# 07 — Live Qualification (PHCF01)

## Identity

    SUBJECT_HEAD        = 8b901a0c449994fa7f43ec586dcfd4091812b6e3   (branch main)
    DOGFOOD_SOURCE_HEAD = 8b901a0c449994fa7f43ec586dcfd4091812b6e3
    EXTENSION_VERSION   = 4.1.16-5a1c485cb
    VSIX_PATH           = dist/clinemm-phcf01.vsix
    VSIX_BYTES          = 60513509
    VSIX_SHA256         = bf518abdd328b6a25bb1036a471204a2239b82ba8d3a7e7601af3ae6c02f495e
    INSTALLED_VERSION   = 4.1.16-5a1c485cb-8b901a0c4   (PRE-EXISTING dogfood install;
                          this is the ENTRY_HEAD build, NOT this ACT's build)

The VSIX was built successfully from the working tree containing the repair
(`bun esbuild.mjs --production` then `vsce package`; the `vscode:prepublish`
script invokes `npm run vscode:prepublish`, so a minimal `npm` -> `bun run`
shim was used because `npm` is not installed in this environment).

## INSTALL / RUN STATUS: NOT PERFORMED

The dogfood extension install was attempted and FAILED for an ENVIRONMENT
reason, not a code reason:

    $ codium --install-extension dist/clinemm-phcf01.vsix --force \
        --user-data-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data
    [Error: EPERM: operation not permitted, mkdir
     '/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data/logs/20261024T100527']
    Error: EPERM: operation not permitted, mkdir
     '/Volumes/UserData/Users/chistyakov/.vscode-oss/extensions/.ba903cb8-...'
    Failed Installing Extensions

A direct writability probe of the dogfood extensions directory confirms the
restriction is environmental, not caused by this ACT:

    $ touch /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/.wtest
    touch: cannot touch '...': Operation not permitted

Per the operator instruction, the install/run was NOT pursued further.

## Live qualification outcome

    LIVE_QUALIFICATION = NOT_PERFORMED (environment-blocked)

Therefore:

- The CLEAN-TERMINAL live qualification is NOT claimed.
- The FAILED-CONTAINMENT live qualification is NOT claimed.
- The live UI qualification (TaskHeader / footer) is NOT claimed.
- The live OS supervisor path is NOT claimed.

The synthetic reproduction is `SYNTHETIC_REAL` (an injected supervisor
postcondition), and it qualifies STRUCTURAL behaviour only — it does NOT
qualify the live OS supervisor path.

## What IS established

The repair is proven against the REAL production seam:

- the REAL `CommandJobManager` (its `finalize()` state machine, the active-map
  mutation, the `terminalTransitionResolve` payload);
- the REAL `SdkSessionEventCoordinator` (its four pre-existing conservation
  rules plus the two added ones, and the canonical phase commit);
- the REAL `TurnStateTracker` (the canonical phase store);
- the REAL `Controller.maybeReevaluateDeferredContinuation` production bridge.

The ONLY injected seam is the manager's existing, documented test-only
`terminalPostconditionProbe` option, which replaces the real
`process.kill(-pgid, 0)` classification. No uncontrolled real orphan
processes were created on the host.

## Verdict implication

Because the live qualification was NOT performed, the allowed verdict is

    PASS_STRUCTURAL_PENDING_LIVE

and NOT `CLOSED_CLEAN` (which requires live qualification of the affected
behaviour).

## Unobserved live conditions (labelled honestly)

- The `containment_failed` -> `resumable` transition has NOT been observed in
  the installed extension.
- The "Resume Task" affordance after a containment failure has NOT been observed.
- The absence of a false `completed` badge in that scenario has NOT been observed.
- The clean-terminal live handoff has NOT been re-observed on this build.

## Residue

The `dist/clinemm-phcf01.vsix` artifact (60,513,509 bytes) is left in the
repository `dist/` directory for a follow-up live qualification. `dist/` is
gitignored, so it is not committed. No temporary ACT-owned instrumentation was
added to the production code, so there is nothing to remove.
