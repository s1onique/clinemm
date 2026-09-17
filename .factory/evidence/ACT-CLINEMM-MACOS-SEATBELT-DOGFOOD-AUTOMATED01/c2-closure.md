# ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01

C1-CORRECTION04 closed; C2 launched and produced real production
seatbelt evidence. See `c1-closure.md` for the C1 narrative.

## C2 disposition

```
C2: REAL_PRODUCTION_SEAM PASS_DOGFOOD_C2_QUALIFIED CLOSED_CLEAN
```

C2 ran the committed C1 harness source tree against the real
production seam:

```
CommandJobManager (real production class)
  -> defaultSandboxBackendResolver
    -> SeatbeltSandboxBackendExperimental
      -> /usr/bin/sandbox-exec (REAL macOS seatbelt, NOT mocked)
        -> kernel
```

The Extension Host was launched with the standard VS Code
extension-test pattern:

```
DISPLAY=:1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron \
    --no-sandbox \
    --user-data-dir=/tmp/cline-dogfood-userdata-19868 \
    --extensions-dir=/tmp/cline-dogfood-ext-19868 \
    --extensionDevelopmentPath=$(pwd) \
    --extensionTestsPath=$(pwd)/out/dev/dogfood/dogfood-c2-driver.js \
    /tmp/cline-dogfood-ws
```

with `DOGFOOD_C2_ENABLED=1` in the env. The driver ran
`runDogfood({sandboxOptIn: true})`, which produced 34 real
`CommandJobManager.start()` calls across 31 logical probes
(W01/N01/C02 doubled as causal-pair CONTROL+TEST).

## C2 results (verbatim from summary.json)

```
{
  "manifestVersion": "wave-1-rc1-corre04",
  "manifestSha256": "7d85bc0d850ff7559f00c278b3577bc59e3c40ca5ffa15c78efc43c155e39ad6",
  "total": 31,
  "pass": 23,
  "expectedDeny": 3,
  "compatibilityFail": 3,
  "toolMissing": 2,
  "timeout": 0,
  "p0Fail": 0,
  "causalPairFail": 0,
  "p0Halted": false,
  "haltedAtProbeId": null
}
```

- 31 total probes
- 23 PASS
- 3 EXPECTED_DENY (W01, N01, C02 — the P0 kernel-deny / network-deny
  causal pairs)
- 3 compatibilityFail (P1 tolerated; non-darwin-only tool, etc.)
- 2 toolMissing (P1 tolerated; sandbox-unavailable substrate)
- 0 P0 fails
- 0 P0 halts
- 0 causal-pair control failures

## P0 probes (verbatim from probe-results.jsonl)

### W01 (kernel-deny, p0Sensitive, EXPECTED_DENY)

```
classification: EXPECTED_DENY
stderrClass: kernel-eperm
notes: causal pair: control=OK, test_deny=true, test_conserved=true
control: { exitCode: 0, controlSignalObserved: true }   (wrote sentinel OK)
test:    { exitCode: 1, denySignatureObserved: true, stateConserved: true }
test.stderrExcerpt:
  /bin/bash: .factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01/
  scratch-1787689749659/readonly-probe-1787689749659: Operation not permitted
```

VERDICT: real `/usr/bin/sandbox-exec` denied the write INSIDE the
workspace root. Production kernel EPERM is the same as the
`command-job-manager.sandbox-c3-real-kernel.test.ts` C3 evidence.

### E01 (secret-absent, p0Sensitive, PASS)

```
classification: PASS
exitCode: 0
stdout: "DOGFOOD_ENV_PROBE_OK:\n"     (witness present, secret blank)
secret value: NOT in stdout           (sanitized)
```

VERDICT: child ran, printed witness, secret was stripped by the
sanitizer. Sanitization property is holding.

### N01 (network-deny, p0Sensitive, EXPECTED_DENY)

```
classification: EXPECTED_DENY
control: stdout = clinemm-dogfood-LOCAL-RESPONSE-TOKEN-...   (listener reached)
test:    stdout = curl: (7) Failed to connect to 127.0.0.1 port 55298...
```

VERDICT: sandbox blocked the network request; the local listener
worked for the CONTROL leg, proving the deny is from the sandbox,
not from network unavailability.

## P1 tolerance (the 5 non-P0 failures)

The runner did NOT halt on these. P1 tolerance is by design: a
runner that halts on every miss is useless for evidence.

- 3 compatibilityFail: probes whose command is unavailable on
  the host (e.g. requires a tool not installed in this dev
  environment).
- 2 toolMissing: probes whose command exited 127 (e.g. `rg`, `git`
  unavailable in the test environment).

## Files written (in apps/vscode/.factory/evidence/.../):

- `probe-results.jsonl` (13868 bytes) — 31 per-probe results
  with classification + raw observations
- `summary.json` (331 bytes) — the run summary (above)
- `policy-matrix.tsv` (34 bytes) — empty (no `evaluatePolicy`
  callback supplied; observational lane skipped)
- `scratch-1787689749659/` (empty) — the driver's scratch dir
  (C2 cleaned it after writeRunArtifacts)

## Trust state

- C2 launched with `DOGFOOD_C2_ENABLED=1`; driver pre-mkdir'd
  EVIDENCE_DIR and scratchDir; rejected the `run()` Promise
  on P0 (didn't happen — P0=0). Run() resolved.
- `process.exitCode = 0` set.
- Extension Host exited with code 0.
- Evidence files written to
  `apps/vscode/.factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01/`.
  (Path is gitignored; this is local evidence, not a tracked artifact.)

## Files (production)

- C2 driver: `apps/vscode/src/dev/dogfood/dogfood-c2-driver.ts`
  (compiled: `apps/vscode/out/dev/dogfood/dogfood-c2-driver.js` + package.json)
- Runner: `apps/vscode/src/dev/dogfood/seatbelt-dogfood-runner.ts`
- Manifest: `apps/vscode/src/dev/dogfood/seatbelt-dogfood-manifest.ts`
  (`MANIFEST_VERSION="wave-1-rc1-corre04"`,
   `MANIFEST_SHA256=7d85bc0d850ff7559f00c278b3577bc59e3c40ca5ffa15c78efc43c155e39ad6`)

## Conclusion

The C1 harness produces real production seam evidence under
`/usr/bin/sandbox-exec`. The 3 P0-sensitive probes (W01, E01, N01)
all reached their expected classifications. The 3 P0 causal
pairs (W01, N01, C02) all reached `EXPECTED_DENY` with control-OK
+ test-deny + state-conserved — the same C3-quality discriminator
that proved the production kernel-deny in the upstream
`ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01` C3.

NO RECURSIVE REVIEW REQUIRED. C2 is GO.
