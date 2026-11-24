# 03 — Confidentiality, authority and the sanitizer bound

ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01

The reviewer accepted the predecessor's `KNOWN_SECRET_CANARIES_LEAKED=0` but
NOT its `CONFIDENTIALITY_CONSERVATION=PASS`, and warned specifically:

> "the claim that bounding before redacting is inherently safe is incorrect."

The predecessor's own example:

```
Line 51: credentials for deployment:
Line 52: CANARY_SENSITIVE_VALUE
Line 53: unrelated configuration
```

A line-selection algorithm might preserve line 52 while removing the context
that allows a sanitizer to recognise it as sensitive.

## What THIS ACT does about it

### The admission contract is explicit and per-destination

The section names four destinations, and authorisation for one does not
authorise another:

1. The summarizer input.
2. The persisted compacted state.
3. The resumed working-agent input.
4. Diagnostics and exported evidence.

**The candidate carries evidence to destinations 2 and 3 only.** It does NOT
put the evidence in the summarizer's input at all — which is precisely why
candidate C cannot distort it.

The switch is at the ADMISSION boundary, so the contract governs every
consumer at once.

### The redaction KEEPS the credential CONTEXT

This is the direct answer to the predecessor's example. The redaction is
applied at the VALUE POSITION of a `key=value` or `key: value` pair, so:

- the KEY is retained: `DB_PASSWORD=[REDACTED]`, not `[REDACTED]`;
- the VALUE is consumed whole, including a multi-word quoted value.

The witness "keeps the credential CONTEXT when it redacts" asserts that the
key survives. A redaction that loses the key destroys the observation's
meaning; a redaction that keeps the key and loses only the secret preserves
both.

### The sensitive-PATH rule is reused, not re-implemented

`isSensitiveSourceFilePath()` is reused unchanged. The witness "refuses a
credential-bearing SOURCE path" asserts that a `.pgpass`-shaped source is
refused ENTIRELY — its content is never carried, whatever the content looks
like. The path is the one property that can be established without inspecting
the content.

### The ORDER is bound-then-redact, and the bound is per-line as well

The excerpt is bounded BEFORE it is redacted, so the sanitizer never sees an
unbounded input. The bound is applied PER LINE as well as to the whole
excerpt, so one pathological line (a minified bundle, a base64 blob) cannot
consume the whole budget.

### What is NOT claimed

This ACT does NOT claim universal confidentiality from regex screening. The
following remain unresolved and are recorded as such:

- a sensitive NUMERIC value with no key;
- an unlabelled credential;
- an encoded secret;
- a shell command that masquerades as a path-shaped reference.

The admission contract FAILS CLOSED on the cases it can establish, and the
report RECORDS every refusal and its reason, so an omission is never silent.

## The sanitizer's own defect — an INDEPENDENT item

The predecessor found that the production `sanitizeOutcomeText()`
backtracks catastrophically on a long body with no match. It is a legitimate
CWE-1333 (Inefficient Regular Expression Complexity) finding, and it is
recorded as an INDEPENDENT security work item:

```
ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
```

**This ACT does not repair it**, and it does not weaken the existing
redaction to achieve performance. The source-bound carry-forward bounds the
input before the sanitizer sees it, so the candidate cannot INTRODUCE an
unbounded synchronous sanitization — but the shared production sanitizer
remains defective for its other callers.

## The A10 dependency

The source-bound carry-forward does NOT depend on A10's vulnerable reference
mechanism:

- it uses the existing `sanitizeOutcomeText()` for redaction, which is a
  value-position sanitizer over a BOUNDED input, not a reference-resolution
  mechanism;
- it does not resolve references to other messages;
- it does not cross a call boundary to attribute content.

`A10_DEPENDENCY=NONE`.

## The authority conservation

The carried section is DATA, not an instruction:

- it is delimited by markers that the excerpt's own content cannot close,
  because the delimiters are ESCAPED inside the excerpt;
- it is labelled as a canonical excerpt;
- each fragment names its SOURCE, its runtime-recorded STATUS and its KIND,
  so a default cannot be read as an effective value and a measurement cannot
  be read as a configuration.

The witness "escapes the section delimiters inside a carried excerpt"
asserts that the section holds exactly ONE unescaped end marker — the one the
runtime wrote.

## The anti-spoofing of the carried content

The evidence-continuity module already neutralises runtime-metadata
impersonation markers (`[System]:`, `<!-- cline-...:begin -->`,
`|--- begin observed data ---|`) inside an admitted body. This ACT reuses
that rule unchanged through the shared admission contract; it did not
re-implement it.

The carried evidence is explicitly untrusted as an INSTRUCTION: it is an
observation, and the section says so.
