# Security correction record — ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-SECURITY-01

This file records the second review of the ACT (of `43b3c062b`), its
`HALT_NEW_P0_CREDENTIAL_EXPOSURE` verdict, and the bounded correction.

## Verdict of the review

`HALT_NEW_P0_CREDENTIAL_EXPOSURE`. The review confirmed that the CORRECTION01
evidence-fidelity findings were resolved, and found **one new P0**: a concrete
redaction bypass in the `read_files` excerpt path.

**The reviewer's counterexample was confirmed against the production code.**

```
$ probe buildSourceFileFact({ query: "/home/user/.pgpass",
                              result: "1 | db.example:5432:production:app:FAKE-CREDENTIAL-DO-NOT-USE",
                              success: true }, "read_files")
sanitizeOutcomeText raw : "1 | db.example:5432:production:app:FAKE-CREDENTIAL-DO-NOT-USE"
FACT EXCERPT             : "db.example:5432:production:app:FAKE-CREDENTIAL-DO-NOT-USE"
credential leaked        : true
```

Two further formats leaked the same way:

| Format | Sanitizer result |
|---|---|
| `registry _auth=FAKE-AUTH-TOKEN-xyz789` | preserved verbatim |
| `postgresql://appuser:FAKE-DB-PASSWORD-123@db.example:5432/prod` | preserved verbatim |

## Why the repair is a PATH rule and not one more regex

The review was explicit: *"Do not attempt to solve arbitrary-secret detection by
adding one more regex."* The module already states the governing rule:

> no regex can be made safe for arbitrary output

The same rule applies to arbitrary file CONTENT. The set of credential formats
is unbounded, so content-shape detection cannot be made safe.

What CAN be established is the **PATH**. A file at `~/.pgpass` or
`~/.ssh/id_rsa` is a credential container **by construction**, whatever its
content looks like. So the correction is:

> A source whose PATH is a known credential-bearing location is not carried at
> all — neither its content nor the path itself.

The path vocabulary **reuses the one the codebase already applies** to
credential targets (`runtime/command-policy/structured-command-risk.ts`:
`.ssh/`, `.aws/`, `.gcloud/`, `.kube/`, `.docker/`, `.netrc`), extended with the
credential-file names that same policy treats as sensitive but does not name.

## The correction

`isSensitiveSourceFilePath()` in `evidence-continuity.ts` classifies a source
path. `buildSourceFileFact()` consults it **BEFORE** the content is projected,
and returns `undefined` for a sensitive source — so neither the excerpt nor the
path is carried.

The rules are layered:

1. **Path fail-closed** — a known credential-bearing source is not carried at
   all. This is the layer that catches formats no regex would.
2. **Content sanitizer** — for an ordinary source, a credential-shaped VALUE
   is redacted (`sanitizeOutcomeText()`).
3. **Bound + attribution** — the excerpt is bounded
   (`SOURCE_FILE_FACT_CHAR_LIMIT = 2_000`) and attributed to its source.
4. **Delimiter escaping** — the carried body cannot forge a new authority.

### The path vocabulary

| Kind | Entries |
|---|---|
| Credential-bearing home directories | `.ssh/`, `.aws/`, `.gcloud/`, `.kube/`, `.docker/`, `.gnupg/` |
| Credential files | `.netrc`, `.pgpass`, `.npmrc`, `.pypirc`, `.htpasswd`, `.env` (and `.env.*`), `.netrc.d/` |
| Key/keystore material by extension | `.pem`, `.pfx`, `.p12`, `.jks`, `.keystore`, `.key`, `.keyring`, `.kdbx` |
| Files named for credentials | `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `credentials` |

Paths are normalized to forward slashes first, so a Windows-style path matches
the same way as a POSIX one.

## The production-seam RED (the review's requirement 1 and 2)

`SECURITY 1` .. `SECURITY 6` in
`compaction.evidence-fidelity01.test.ts`:

| Control | Asserts | Result |
|---|---|---|
| SECURITY 1 | the content sanitizer does NOT recognise a `.pgpass`/`_auth=`/URL credential — pinning WHY the repair is a path rule | PASS |
| SECURITY 2 | a `.pgpass` source is never carried at all | PASS |
| SECURITY 3 | the credential-bearing SOURCE PATH is itself never carried (9 path classes) | PASS |
| SECURITY 4 | a non-sensitive source path IS still carried — the repair is **not** a blanket disable | PASS |
| SECURITY 5 | a `.pgpass` credential reaches neither the summarizer request nor the persisted/provider-visible summary | PASS |
| SECURITY 6 | an ordinary source's key-shaped credential is still redacted | PASS |

### The RED is load-bearing

Against the pre-correction production code (`git checkout --` of
`evidence-continuity.ts`), **SECURITY 2, 3 and 5 FAIL** — the `.pgpass`
credential IS carried:

```
× SECURITY 2: a .pgpass source is never carried at all (path-based fail closed)
× SECURITY 3: the credential-bearing SOURCE PATH is itself never carried
× SECURITY 5: a .pgpass credential reaches NEITHER the summarizer request
              NOR the provider-visible continuation
 Test Files  1 failed (1)
```

## Requirement 3 — the source-path field is inspected as well

Done. `isSensitiveSourceFilePath()` gates the whole fact, so a sensitive
source contributes neither an excerpt nor a path to the carried section.
SECURITY 3 asserts this over nine path classes.

## Requirement 5 — the R4 evidence-fidelity tests are preserved

All of them. The R4 witness path
(`/Volumes/.../keycloak/startup.sh`) is NOT sensitive (SECURITY 4), and the
whole evidence-fidelity suite — SCENARIO 1-3, PROOF 1-4, CONTROL 1-15,
SCENARIO 16 — is unchanged and GREEN.

## Requirement 6 — the re-run receipts

```
$ cd sdk/packages/core
$ bunx vitest run --config vitest.config.ts \
    src/extensions/context/compaction.evidence-fidelity01.test.ts
 Test Files  1 passed (1)
      Tests  34 passed (34)
EXIT=0

$ bunx vitest run --config vitest.config.ts src/extensions/context/
 Test Files  26 passed | 1 skipped (27)
      Tests  451 passed | 2 skipped (453)
EXIT=0

$ bun tsc -p tsconfig.dev.json --noEmit | grep -cE '^src/.*error TS'
43
```
43 is the entry-HEAD baseline; the ACT-owned diagnostics are 0.

```
$ bunx biome check <the modified production file> <the test file>
Checked 2 files. 0 errors, 0 warnings.
```

## Scope honesty — what this correction does NOT do

### The `## Files` path listing is PRE-EXISTING and out of scope

The compaction summary's `## Files` section lists the PATHS of read files.
`extractFileOps()` collects them, and it did so **at the entry HEAD too**:

```
$ probe extractFileOps([... read_files({files:[{path:"/home/user/.pgpass"}]}) ...])
AT-HEAD-FILEOPS: {"readFiles":["/home/user/.pgpass"],"modifiedFiles":[]}
```

So a sensitive PATH was already in the provider-visible summary before this
ACT. That is a **path** disclosure, pre-existing, and it discloses no
credential CONTENT. It is recorded here rather than silently ignored, and it is
**not** widened by this correction — the new path adds no new disclosure of
it, because a sensitive source contributes no file fact at all.

### The canonical tail preserves the raw tool_result — also PRE-EXISTING

The preserved canonical tail keeps the agent's own raw `tool_result` block
verbatim (verified unchanged at the entry HEAD). That is the agent's own prior
context, not something compaction forwards. This correction governs what
COMPACTION carries, and the carried summary contains neither the credential
nor a source-file fact for a sensitive source.

### The residual limit is stated, not hidden

The path rule covers credential-bearing LOCATIONS. An ordinary source file that
happens to contain an unrecognized credential format is still bounded, still
attributed, and still redacted for key-shaped values — but an unrecognized
format in an ordinary file is not detected. Closing that gap completely would
require the broader trust mechanism the review flagged, which is a separate
design ACT. This correction does not claim it.
