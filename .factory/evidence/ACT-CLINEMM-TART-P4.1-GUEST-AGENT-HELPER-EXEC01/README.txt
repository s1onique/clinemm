ACT-CLINEMM-TART-P4.1-GUEST-AGENT-HELPER-EXEC01 — Evidence Directory

This directory is the evidence vault for the ACT of the same name (in
.factory/acts/ACT-CLINEMM-TART-P4.1-GUEST-AGENT-HELPER-EXEC01.md).
It collects the bounded proof required to close the ACT.

Files (populated as the ACT proceeds):

  00-red-witness.log
        RED proof: a correctly shaped tart.guest.smoke request is
        currently unsupported (helper returns METHOD_NOT_ALLOWED); extra
        fields rejected at the parse layer; missing CLINEMM_SMOKE_VM
        returns SMOKE_NOT_CONFIGURED; tart.testbed.run contract unchanged.

  01-isolated-helper-build.txt
        Step A: build.sh + shasum + g_build_id (BUILD_ID) of the freshly
        compiled native helper. ABI_VERSION bump rationale.

  02-isolated-helper-start.txt
        Step B: invocation of the dev helper with the frozen trusted
        bindings (CLINEMM_HOST_HELPER_SOCKET, CLINEMM_HELPER_STATUS_PATH,
        CLINEMM_SMOKE_VM, CLINEMM_SMOKE_TART_HOME).

  03-isolated-helper-status.json
        Step B: contents of the status file the helper writes on bind.

  04-real-tart-run-bootstrap.txt
        Step C: operator-pasted output of `tart run clinemm-p3-sonoma-imported --no-graphics`
        from a non-Seatbelted host terminal, with the documented TART_HOME
        exported.

  05-real-smoke-rpc.json
        Step D: the real smoke RPC request, the response, and the
        pre/post VM-list evidence. Captures the actual guest identity
        (ProductName, ProductVersion, Build, Darwin release, arch).

  06-real-tart-list-during-smoke.json
        Step D: `tart list --source local --format json` captured while
        the smoke was running, proving the imported VM remained in
        state `running` (not stopped, not deleted, no foreign VM).

  07-real-tart-list-post-shutdown.json
        Step 9: `tart list --source local --format json` captured after
        the operator issued `tart stop`, proving the imported VM is in
        state `stopped` and remains the ONLY VM under that TART_HOME.

  08-installed-helper-build-id.txt
        Step 8 / Gate S7 status: the installed LaunchAgent helper's
        recorded build_id, the freshly built binary's build_id, and
        the explicit INSTALLED_HELPER_UPDATE_REQUIRED verdict. Gate S7
        remains OUTSTANDING in this ACT.

  SHA256SUMS
        Generated at ACT closure: shasum -a 256 over each populated
        file in this directory.

Evidence classification for S6: REAL_HELPER_CODE / DEV_FALLBACK_TRANSPORT.
This is NOT the production launchd qualification. S7 remains OUTSTANDING.

Forbidden in this directory: any simulated tart exec output, any
synthetic sw_vers body, any "expected" transcript. The real guest is
the only acceptable source for the sw_vers and uname_a bodies in 05.
