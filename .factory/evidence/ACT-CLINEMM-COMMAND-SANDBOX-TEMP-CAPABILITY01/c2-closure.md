# ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01 -- C2 CLOSURE (dogfood ablation)

```
PASS_SEATBELT_PRIVATE_TEMP_CAPABILITY
CLOSED_CLEAN
```

C2 is dogfood ablation only. Same harness, same manifest, same
SHA-256, same probe IDs, different source tree.

## Provenance identities

```
TEMP_REPAIR_SUBJECT_HEAD = 938faa7bb feat(safety): ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01-C1 -- private Seatbelt temp capability
TEMP_REPAIR_SUBJECT_TREE = a1e1efec618164ab267e800c23da8a21be27229a

MANIFEST_VERSION         = wave-1-rc1-corre04  (unchanged from Wave-1)
MANIFEST_SHA256          = 7d85bc0d850ff7559f00c278b3577bc59e3c40ca5ffa15c78efc43c155e39ad6  (unchanged)
```

## Launch

```
DOGFOOD_C2_ENABLED=1 \
DISPLAY=:1 \
/Applications/Visual Studio Code.app/Contents/MacOS/Electron \
    --no-sandbox \
    --user-data-dir=/tmp/cline-dogfood-ud-13716 \
    --extensions-dir=/tmp/cline-dogfood-ext-13716 \
    --extensionDevelopmentPath=$(pwd)/apps/vscode \
    --extensionTestsPath=$(pwd)/apps/vscode/out/dev/dogfood/dogfood-c2-driver.js \
    /tmp/cline-dogfood-ws-13716
```

The shell had inherited `ELECTRON_RUN_AS_NODE=1` and other VSCode
extension-host vars from the parent agent shell; per the harness
README these were stripped with `env -u ...` so the child VSCode
would not run as Node.

The driver reported:

```
[dogfood-c2] starting REAL_PRODUCTION_SEAM matrix (manifest=wave-1-rc1-corre04, sha256=7d85bc0d...)
[dogfood-c2] workspaceRoots=["/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"]
[dogfood-c2] scratchDir=.factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01/scratch-1787691555918
[dogfood-c2] expected 34 CommandJobManager.start() calls (31 logical + 3 CONTROL legs for W01/N01/C02)
[dogfood-c2] COMPLETE: 31 probes; p0Fail=0; compatFail=1; toolMissing=0
```

cwd was the repo root (the workspace argument was an empty /tmp dir;
the harness inherits cwd from VSCode's extension-host launch, which
is the extensionDevelopmentPath directory in this case). Evidence
was written to `${process.cwd()}/.factory/evidence/...` — i.e.,
the repo-root `.factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01/`.

## Matrix delta

```
                       BEFORE (Wave-1, cf0896d4c)          AFTER (C1 fix, 938faa7bb)
T01 (mktemp)            EPERM / COMPATIBILITY_FAIL          PASS (exit 0; produced path under
                                                              /private/var/folders/.../T/clinemm-sandbox-temp-ygZ6wv)
T02 (mktemp -d)         EPERM / COMPATIBILITY_FAIL          PASS (exit 0; same dir layout)
E04 (TMPDIR= probe)     PASS / TMPDIR= (empty)              PASS / TMPDIR=/private/var/folders/.../T/clinemm-sandbox-temp-svjiHN
W01 (workspace kernel)  EXPECTED_DENY                        EXPECTED_DENY  (unchanged)
N01 (localhost deny)   EXPECTED_DENY                        EXPECTED_DENY  (unchanged)
C02 (nested /bin/sh)    EXPECTED_DENY                        EXPECTED_DENY  (unchanged)
E01 (synthetic secret)  PASS                                 PASS  (unchanged)
G07 (git config)        COMPATIBILITY_FAIL                   COMPATIBILITY_FAIL  (unchanged, env issue)
F03 (rg)                TOOL_MISSING                          RESOLVED (cwd is now repo-root, sdk/apps resolve)
F04 (find)              TOOL_MISSING                          RESOLVED (same)

Summary counts:
  pass:                23 -> 27
  expectedDeny:        3 -> 3
  compatibilityFail:   3 -> 1
  toolMissing:         2 -> 0
  p0Fail:              0 -> 0
  causalPairFail:      0 -> 0
```

## P0 conservation

```
W01 EXPECTED_DENY (kernel-deny, control-OK + test-deny + state-conserved)
N01 EXPECTED_DENY (network-deny, same causal-pair discriminator)
C02 EXPECTED_DENY (nested /bin/sh kernel-deny, same)
E01 PASS (synthetic secret absent, positive witness present)

P0_FAIL=0  CAUSAL_PAIR_FAIL=0  P0_HALTED=false
```

The W01/N01/C02 causal-pair discriminator properties (control-OK +
test-deny + state-conserved) are preserved bit-for-bit. The fix
added ONE profile line and ONE env entry. No other rule changed.

## Why the P0 conservation is load-bearing

The temp-capability fix ONLY modifies:
  1. Adds (subpath "<canonical temp root>") to (allow file-write* ...)
  2. Adds `out.TMPDIR = syntheticTempDir` to the materialized env

Both modifications are necessary for `mktemp` success. Neither
modification touches:
  - (deny network*) (network still denied)
  - (deny file-write* (subpath "<readonlyRoot>")) for each
    workspaceRoot (workspace writes still denied)
  - SECRET_BLOCKLIST (secrets still absent)
  - Default-deny baseline (everything else still denied)

The deny-after-allow rule order is preserved. If a workspaceRoot
were a descendant of the synthesized temp root (impossible by
construction since workspaceRoots are user-supplied and the
synthesized root is in /private/var/folders/.../T), the deny
would still win because Seatbelt processes rules in order.

## Files

Production (committed in C1):
  sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts
  apps/vscode/src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts

Evidence (gitignored, local):
  .factory/evidence/ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01/
    entry-freeze.txt, recon.md, wave1-red-reference.md,
    focused-red-green.txt, temp-capability-profile.txt,
    temp-path-canonicalization.txt, temp-ablation.txt,
    security-conservation.txt, test-gates.txt, cleanup.txt,
    dogfood-before-after.json, final-assessment.md,
    c2-closure.md, c2-launch-command.txt
  .factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01/
    probe-results.jsonl (14645 bytes, +777 from Wave-1)
    summary.json (NEW numbers above)
    policy-matrix.tsv (header-only, POLICY_LANE = NOT_EXECUTED)
    scratch-1787691555918/ (C2 cleanup)

## Trust state

```
TEMP_REPAIR_SUBJECT_HEAD = 938faa7bb feat(safety): ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01-C1
TEMP_REPAIR_SUBJECT_TREE = a1e1efec618164ab267e800c23da8a21be27229a
branch                   = main
origin/main              = unchanged
NOT pushed
```
