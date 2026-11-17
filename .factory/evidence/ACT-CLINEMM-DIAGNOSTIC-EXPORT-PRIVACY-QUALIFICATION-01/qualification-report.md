# ACT-CLINEMM-DIAGNOSTIC-EXPORT-PRIVACY-QUALIFICATION-01 — RC-06

**Principal disposition:** `PASS_EXPORT_PRIVACY_QUALIFIED`

**Entry:** repository `s1onique/clinemm`, branch `main`, HEAD
`f940a5ab88421944156c5e917c6806b12bc085ae` (equal to the expected entry).
The tracked tree was clean at entry. Protected worktrees and external raw
artifacts were preserved; no push, PR, reset, stash operation, branch or new
worktree was created.

**Scope:** bounded privacy qualification of the real Round C diagnostic export
and the existing evidence-publication paths. No production source, protocol,
telemetry, logging or canonical persistence was changed.

## 1. Production boundary selected

The smallest real production export boundary sufficient to qualify RC-06 is:

```text
cline.debug.dumpRoundcLatencyTrace
  -> dumpRoundcLatencyTrace()                         apps/vscode/src/sdk/roundc-latency-trace-runtime.ts
  -> buildRoundcLatencyTraceArtifact()                (same file)
  -> LatencyTraceSink / LatencyTracer                sdk/packages/core/src/observability/latency/
  -> sanitizeLatencyMetadata()                        (finite allowlist; unknown keys dropped)
  -> <globalStorageUri>/roundc-latency-trace.json
```

This boundary was selected instead of a generic diagnostic framework because
it is the real export consumed by RC-01 through RC-05 and because its privacy
contract is finite and testable at the existing production seam.

Two adjacent publication paths were inspected and classified:

| Path | Contract | Qualification result |
|------|----------|----------------------|
| `roundc-latency-trace.json` | **SHAREABLE structural diagnostic** | Qualified below |
| `cline-incident.zip` (`automatic-incident-export.ts`) | **SHAREABLE support ZIP** | Existing strict key allowlist; unknown keys dropped |
| `cline-diagnostics-*.txt` (`diagnostics.ts`) | **SHAREABLE support text** | Existing schema-driven projection; raw log bodies excluded |
| canonical `*.messages.json`, `*.compaction.json`, manifest | **PRIVATE runtime persistence** | Not read or mutated by the Round C export; not committed |

Intentional local retention is therefore not classified as a leak. The raw
Round C trace is a private forensic artifact outside Git; the evidence packages
contain only derived, sanitized records.

## 2. Real artifact assessment

The preserved dogfood artifact was inspected read-only:

| Property | Observed |
|----------|----------|
| Trace SHA-256 | `b84ee4a83f3819b4a849e2d05f95c044443e3d3fb036818aef98f9b7fe96b5e1` — **MATCH** |
| Schema / profile | `cline.roundc-latency-trace.v1` / `dogfood` |
| Session / correlation | `1794892591345_7em4g` / `1794892591345_7em4g` — **MATCH** |
| Events / stages / unavailable | 418 / 171 / 13; declared counts equal actual lengths |
| Integrity failures / truncation | 0 / `truncated=false` |
| Canonical absolute-path values in trace | **0** |
| Canonical text/content/command/input/output/result values in trace | **0** |
| Credential-shaped canonical values in trace | **0** |
| JDBC-shaped canonical values in trace | **0** (5 exist in the canonical sidecar) |
| Trace absolute-path leaf values | **0** |

The trace contains the required structural correlation: session id, correlation
id, per-event correlation id, request/preparation/decision identities, tool-call
ids, provider/model identities, and deterministic projection digests. The
canonical strings that appear in the trace are limited to opaque identifiers,
bounded classifications, model/provider labels and hashes. No raw prompt,
provider payload, tool-result body, credential or private path appears.

The authoritative trace was **not committed**. The canonical transcript,
compaction sidecar and manifest remain outside Git; their SHA-256 receipts are
retained only as non-reversible evidence identities.

## 3. Executable discrimination at the production seam

The existing production suites were executed unchanged. They exercise the real
`dumpRoundcLatencyTrace`, `buildRoundcLatencyTraceArtifact`,
`LatencyTraceSink`, `LatencyTracer` and `sanitizeLatencyMetadata` functions.

| Gate | Result |
|------|--------|
| VS Code Round C activation + identity suites | **51/51 PASS** (2 files) |
| VS Code Round C + automatic-incident export suites | **85/85 PASS** (4 files) |
| SDK core latency-trace suite | **42/42 PASS** |
| Desktop shareable diagnostics privacy suite | **27/27 PASS** (2 files) |
| VS Code typecheck (`bun run check-types`) | **PASS, 0 diagnostics** |
| SDK core typecheck | **PRE-EXISTING baseline diagnostics only; none in the exercised latency files; no production change** |

Positive/negative sanitizer controls are already part of the production
boundary and were executed above:

- positive: allowlisted identifiers, counts, sizes, booleans, bounded
  classifications and digests are retained;
- negative: prompt, command, API-key, authorization, private-path and
  tool-result-content canaries are absent from the exported artifact;
- negative: raw skip-reason text is reduced to a finite classification;
- negative: the public profile installs no sink and writes no capture;
- conservation: dumping does not clear the trace and correlation identities are
  unchanged.

The synthetic canaries are test fixtures, not historical evidence. They prove
current sanitizer behaviour; the live artifact assessment above is reported
separately and is not inferred from them.

## 4. Committed RC-01 through RC-05 evidence privacy scan

The committed packages were scanned without emitting discovered values:

- RC-01 calibration: frozen estimator evidence unchanged; no production
  estimator change.
- RC-02 trigger adjudication package.
- RC-03 latency-attribution package and its CORRECTION01 receipt.
- RC-04 canonical-continuity package.
- RC-05 tool-normalization package.

Across those four live-evidence packages (51 tracked files):

| Scan | Result |
|------|--------|
| High-entropy credential patterns (private key, AWS access key, long `sk-*`, bearer/basic assignment, secret/password assignment) | **0** |
| Exact canonical text/content/command/input/output/result matches | **0** |
| Exact canonical private-artifact path matches | **1** in RC-05 `00-identity-record.json`, SHA-256 fingerprint `e26c9ec2b43f7c681af3d0fc50bd61b3c511d470734a5e3c154170abf3088aa9` |
| Project-specific private-path markers | **0** |
| Raw artifact bytes committed | **0** |

The one path match is a **private-artifact identity receipt**, not artifact
content: the RC-05 package records the external location of the raw transcript
so the run remains reproducible, while the file itself remains outside Git.
The package explicitly classifies `input_artifacts` as `PRIVATE` and
`committed: false`. This is path metadata, not session content; it is called
out here rather than hidden.

All other absolute paths in the committed packages are repository/worktree,
installed-runtime, raw-download or canonical-session artifact identities needed
for authoritative correlation, plus generic test-runner roots. No keycloak,
znanie, roznanie or other customer-project path marker was found.

The older `ACT-CLINEMM-DIAGNOSTIC-EXPORT-PRIVACY01` package was also scanned.
Its absolute paths are the test-runner root, disposable synthetic fixture roots
and synthetic home/project fixtures. Its one credential-shaped literal is a
synthetic canary in a RED assertion; no live credential is present. The
post-repair real export receipt (`01-real-session-export-after.txt`) contains no
absolute private path and no credential.

## 5. Overwrite behaviour

`dumpRoundcLatencyTrace` writes the fixed file
`<globalStorageUri>/roundc-latency-trace.json` with `writeFile`, so a later dump
replaces the earlier file at that canonical location. The production dump does
**not** warn before replacement, and the command shows only the resulting path.

This is not a confirmed privacy leak and no production repair was authorized.
It is a durability limitation:

- the authoritative capture must be copied outside the canonical path before a
  later session overwrites it (the existing board procedure already states
  this);
- the preserved live capture and its SHA-256 were verified to exist in two
  external locations with identical bytes;
- the canonical path currently holds the same authoritative bytes, so no
  authoritative capture was destroyed by this qualification.

Classification: `DURABILITY_LIMITATION_NOT_A_PRIVACY_LEAK`. A future change
that makes the canonical dump non-destructive or warns the operator would need
a separately authorized repair ACT and a discriminating RED.

## 6. Limitations

1. The live artifact proves one dogfood session and one provider/model shape.
   It does not prove non-disclosure for every future provider payload shape.
2. The synthetic canaries demonstrate the current finite allowlist and export
   shape; they do not prove historical non-disclosure before the allowlist
   existed.
3. The committed evidence packages intentionally retain private **artifact
   identity paths** for reproducibility. They contain no raw artifact bytes or
   session content. If the intended contract for those packages is
   content-free *and* path-free, that stricter contract is not currently
   enforced and requires a separate, explicit evidence-publication policy.
4. The canonical dump overwrite limitation remains open as durability risk, not
   as a confirmed confidentiality failure.
5. The SDK core typecheck has pre-existing diagnostics in this repository
   state; this ACT changed no SDK source and therefore introduced no new
   diagnostic.

## 7. RC-06 board classification

| Stage | Status |
|-------|--------|
| RC-06 diagnostic export privacy | **QUALIFIED — `PASS_EXPORT_PRIVACY_QUALIFIED`** — the real Round C production export is schema-driven and allowlist-bounded; the preserved live artifact contains no prompt, provider payload, tool-result body, credential or private path; committed RC-01…RC-05 evidence contains no raw artifact bytes or raw session content; required correlation identities and hashes remain intact. One private-artifact **path identity** remains in the RC-05 evidence receipt by design and is explicitly classified, not a content leak. Canonical dump overwrite is a separate durability limitation, not a confirmed privacy leak. |

RC-01 through RC-05 are **not reopened**. No production repair is warranted by
this qualification.
