# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01 — Privacy Audit

---

## 1. The contract

The capture must not persist:

| Forbidden | Present in the emitted artifacts? |
|---|---|
| Raw prompts or message bodies | **NO** |
| Tool commands or tool results | **NO** |
| Credentials, authorization headers or API keys | **NO** |
| Raw tool schemas | **NO** |
| Private project paths | **NO** |
| Unredacted provider payloads | **NO** |

---

## 2. The programmatic scan of the EMITTED artifacts

The 173 sanitized records produced from the preserved dogfood corpus were
scanned as raw text:

```
records scanned : 173
total bytes     : 8,582,962
```

| Pattern class | Occurrences |
|---|---:|
| An absolute filesystem path (`/Users/…`, `/home/…`, `/Volumes/…`, `/var/…`, `/tmp/…`) | **0** |
| An API key shape (`sk-…`) | **0** |
| A `Bearer` header | **0** |
| An `Authorization` header | **0** |
| A shell command (`rm -rf`, `curl -s`, `git clone`, `npm install`) | **0** |
| A raw JSON payload key (`query`, `result`, `output`, `input`) | **0** |
| A tool-schema key (`input_schema`, `properties`, `parameters`) | **0** |
| An environment-variable-style name | **0** |

### 2.1 The COMPLETE set of persisted keys

The audit is not a sample — it is the exhaustive key inventory:

```
top-level keys persisted : capturedAt, cohortId, iteration, modelId,
                           preparationRequestId, producer, providerAttemptId,
                           providerId, recordSha256, representation,
                           schemaVersion, sessionId, source
representation keys      : complete, messageCount, messages, producer,
                           representation, representationVersion,
                           systemBytes, systemFingerprint, toolFingerprints
message fingerprint keys : bytes, fingerprint, parts, role
part fingerprint keys    : bytes, fingerprint, type
```

Every persisted value is an identity, a count, a byte length or a keyed
digest. **No content value is persisted at any level.**

### 2.2 The COMMITTED EVIDENCE FILES — ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01

**The gap the correction review found.** §2 scans the 173 sanitized capture
RECORDS. The COMMITTED evidence files — the human-readable reports — are a
DIFFERENT artifact class and were never covered by that scan. A clean scan
of the sanitized derivative therefore did NOT establish that every committed
evidence file is sanitized. It did not: `02-sanitized-request-difference-matrix.md`
§2.1 reproduced a ~200-character excerpt of a REAL file-read result.

**The correction.** Every committed file in this directory is now scanned as
raw text, with the same pattern classes plus the ones the human-readable
reports can introduce (a live tool-call id, a verbatim content excerpt):

| Pattern class | Occurrences (post-correction) |
|---|---:|
| An absolute filesystem path (`/Users/…`, `/home/…`, `/Volumes/…`, `/private/tmp/…`) | **0** |
| A live tool-call id (`call_` + ≥10 hex chars) | **0** |
| An API key shape (`sk-…`) | **0** |
| A `Bearer` / `Authorization` header | **0** |
| A verbatim excerpt of the rewritten file's own text | **0** |
| A shell command | **0** |

**What was redacted, and what was NOT.**

| File | Redacted | Reason |
|---|---|---|
| `02-sanitized-request-difference-matrix.md` §2.1 | the verbatim file-content excerpt; the live `toolCallId` (now a truncated digest) | real file content + a live correlation id |
| `08-entry-and-identity-evidence.md` §1, §1.1 | the operator's absolute repository root; two absolute `/private/tmp` worktree paths | discloses the operator's home directory |
| `06-test-receipts.txt` | the absolute checkout path in the vitest RUN banners | ditto |

**What was NOT redacted, and why.** The finding needs its STRUCTURE, and
structure is not content: the replacement marker
`[outdated - see the latest file content]`, the byte counts (26,426 → 317),
the message index (11 / 27 / 41), the role (`tool`), the tool name
(`read_files`), the position, the message count and the cohort/session
identities are all retained. The `LESSON-14.md` file NAME is retained — it
is the locator under analysis, not the content, and the analysis is about
what happened to that locator's content.

**The scan is reproducible.** The committed files were scanned as raw text
over the whole directory, not a sample:

```bash
cd .factory/evidence/ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01
grep -rn -E "(/Users/|/Volumes/|/home/|/private/tmp/)" .        # → 0
grep -rn -oE "call_[0-9a-f]{10,}" .                            # → 0
grep -rn -oE "sk-[A-Za-z0-9_-]{6,}" .                          # → 0
grep -rni "bearer " .                                          # → 0
```

---

## 3. Why a plain hash would not be acceptable

The ACT requires HMAC-SHA-256 for the NEW fingerprints, because a plain
SHA-256 of a low-entropy private string is a **dictionary-attackable
disclosure** of that string: an attacker who can guess candidate strings
(the file path, the tool name, the marker text) can confirm a guess by
recomputing the digest. A keyed digest makes that impossible without the
key.

* `keyedFingerprintHex(key, value)` — HMAC-SHA-256.
* The key is generated per process from crypto entropy, or supplied by the
  operator via `CLINEMM_PREFIX_FORENSICS_KEY`.
* The key is **never persisted** into a capture record, and the capture
  writer never writes it. Proven by `V9: the record carries session,
  version, source and a SHA-256 identity`, which asserts
  `JSON.stringify(record)).not.toContain("a-fixed-test-key")`.
* The record carries a `cohortId` — a 16-hex digest of the key — which
  identifies the cohort WITHOUT disclosing the key. An observer who learns
  the cohort id cannot recompute any fingerprint from it.

### 3.1 The comparability consequence

Keyed fingerprints are comparable across requests in the SAME cohort and are
NOT comparable across cohorts. The analyzer enforces this: a pair whose
cohort ids differ is reported as `NOT comparable` and is refused. Witness:
`V10: the analyzer FAILS CLOSED when a cohort or a lineage is wrong`.

---

## 4. Where the records are stored

| Property | Value |
|---|---|
| Location | `CLINEMM_PREFIX_FORENSICS_DIR` when named; otherwise `<CLINE_DATA_DIR>/prefix-forensics-<cohortId>` — i.e. under the extension's own data directory, **outside Git** |
| Directory mode | **0o700** (owner-only) |
| File mode | **0o600** (owner-only) |
| Write discipline | write to a temporary file, then `rename` (atomic) |
| Retention | none is imposed by this ACT; the operator owns the directory |
| In the repository | **NO** — no capture body, no key and no raw engine log is committed |

The full-payload `CLINE_CAPTURE_PROVIDER_REQUEST=full` capture was **not**
enabled for this experiment beyond what the preserved corpus already
contained, and the ACT did not enable it for any new run.

---

## 5. The exception and malformed-input path

The ACT requires that no raw sensitive content is present "including on
exceptions and malformed inputs". Two mechanisms guarantee this:

1. **The capture never serializes raw content in the first place.** It
   computes a keyed digest and a byte length. There is no code path that
   writes a prompt, a tool result or a tool command — so there is nothing to
   leak on an exception either.
2. **Every write is failure-isolated.** A throw inside the capture cannot
   escape into the provider path, and the partially-written temporary file
   is never renamed into place.

Witness: `V8: a MALFORMED input produces no record and never throws into the
caller` — a **cyclic** JavaScript value is passed as both the messages and
the body. The call does not throw, and the emitted artifact contains no
`[object Object]` serialization of the cyclic value.

---

## 6. The corpus the evidence was derived from — a separate disclosure

The preserved dogfood corpus this ACT analysed is itself a **full-payload**
capture (24,862 records containing real prompts and tool results). That
corpus predates this ACT, lives OUTSIDE Git under the operator's own data
directories, and is **not** modified, moved, committed or re-exported by
this ACT.

What the ACT commits is only the **sanitized** derivative: the difference
matrix (`03-request-difference-matrix.json`) and the sanitized records it
was computed from, which the audit in §2 shows to be content-free.

**CORRECTION (ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01).**
The one piece of raw content this ACT quoted in its evidence — a
~200-character excerpt of the rewritten tool result in
`04-discriminator-report.md` §D2 — has been **REDACTED**. The excerpt was
in fact in `02-sanitized-request-difference-matrix.md` §2.1 (and the
discriminator report referenced it). The replacement marker, the byte
counts, the message index, the role, the position and the tool-call
identity are all still asserted; only the verbatim content and the live
`toolCallId` are removed.

The evidence is now **redacted**, not merely disclosed. The committed
excerpt was judged to carry: a lesson document's text and a local file
path — **no credential and no private project content** — but a redaction
that preserves the finding costs nothing and removes the disclosure
question entirely. See §2.2 for the full committed-file scan.

---

## 7. The residual risk, stated

| Residual | Why it is acceptable |
|---|---|
| The `cohortId` is a digest of the key. | A digest is not a key: it cannot be inverted into the key and cannot be used to recompute a fingerprint. |
| The message COUNT and per-message byte LENGTHS are persisted. | These are structural metadata about the transcript. They are the minimum needed to localise a difference, and they are not content. |
| The tool NAMES are persisted (e.g. `read_files`). | The tool inventory is a fixed, public capability list, not user content. The tool SCHEMA is not persisted. |
| The system prompt's byte length is persisted. | The system prompt is a fixed template, not user content; only its length and digest are kept. |
