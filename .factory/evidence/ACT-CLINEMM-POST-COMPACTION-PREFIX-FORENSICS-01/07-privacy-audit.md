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

The one piece of raw content this ACT quotes in its evidence is a single
~200-character excerpt of the rewritten tool result, reproduced in
`04-discriminator-report.md` §D2 to show the literal replacement. It is
quoted because the replacement is the finding. It contains a lesson
document's text and a local file path — **no credential and no private
project content**. The ACT's own artifacts are the sanitized matrix; the
excerpt is in the human-readable report only.

---

## 7. The residual risk, stated

| Residual | Why it is acceptable |
|---|---|
| The `cohortId` is a digest of the key. | A digest is not a key: it cannot be inverted into the key and cannot be used to recompute a fingerprint. |
| The message COUNT and per-message byte LENGTHS are persisted. | These are structural metadata about the transcript. They are the minimum needed to localise a difference, and they are not content. |
| The tool NAMES are persisted (e.g. `read_files`). | The tool inventory is a fixed, public capability list, not user content. The tool SCHEMA is not persisted. |
| The system prompt's byte length is persisted. | The system prompt is a fixed template, not user content; only its length and digest are kept. |
