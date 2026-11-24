# ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01 — C0 entry and workload identity

```text
ACT_ID:    ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
TYPE:      bounded executable recon (no production change)
BRANCH:    main
ENTRY_HEAD: 1566567e154e063561effe214473ec4a87d4a474
PREDECESSOR: ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01 (accepted, negative utility result)
```

## 1. ENTRY IDENTITY AND PREDECESSOR ACCEPTANCE

| Check | Result |
| --- | --- |
| Branch | `main` |
| `ENTRY_HEAD` (full SHA, discovered at runtime) | `1566567e154e063561effe214473ec4a87d4a474` |
| `ENTRY_HEAD` (short, as the ACT expected) | `1566567e1` — **matches** |
| Tracked worktree cleanliness | **CLEAN** — `git status --porcelain` reported only the ACT's own new untracked recon files |
| Stash inventory | **EMPTY** — `git stash list` returned nothing |
| Predecessor ancestry | `1566567e1` is `ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01: establish that the PCK preserves nothing on a real mature workload` |

**Unexpected tracked dirt: NONE. No HALT.**

The preserved predecessor findings are carried forward unchanged and are not
reopened by this ACT:

```text
PCK_PHYSICAL_REQUEST_CONTRACT=PASS
R7_INPUT_REDUCTION=DEMONSTRATED
R7_OUTPUT_BUDGET_LIMITATION=REPRODUCED
R7_CLOSED_VOCABULARY_LIMITATION=ESTABLISHED
R7_INCREMENTAL_UTILITY=NOT_ESTABLISHED
```

The PCK implementation remains **default OFF** throughout this ACT and no PCK
input, vocabulary, output-budget or deadline change was made.

## 2. THE REAL WORKLOADS — ACQUIRED AND FROZEN

Both workloads were recovered from the operator-local, gitignored session store
(`~/.vscodium-roz/cline-data/sessions/`) and were acquired by the ACT's own
tooling (`sdk/packages/core/scripts/knowledge-loss-discriminator.acquire.ts`).

### 2.1 W1 — the successful Round C session (PRIMARY)

```json
{
  "acquisition": "REAL_SESSION_CANONICAL_HISTORY",
  "sessionId": "1795491524406_mutdb",
  "sessionSource": "vscode",
  "sessionMode": "user",
  "sessionExtensionVersion": "4.1.26-821b20e7a",
  "sessionAgent": "lead",
  "canonicalMessageCount": 246,
  "canonicalSourceMessageCount": 246,
  "displayOnlyMessageCount": 0,
  "rawFileSha256": {
    "canonicalHistory": "ac74e33270103e6c7c20d84ecf50662ae8b8114145aa9521e152d82e249f3cc5",
    "compactionState": "73324de5b485d2892d86c66b06e598ab55131273945ab0cf1e4afdecf2e463fd"
  },
  "canonicalArraySha256": "a46e203443e4f3f3c35fb1b05bbd7db2b2bc3541495d3c3f3e09e09f42a61c7d"
}
```

**The two raw-file SHA-256 values are IDENTICAL to the values the ACT quoted.**
They are the SHA-256 of the persisted FILE BYTES.

The `canonicalArraySha256` is a **different identity**: the SHA-256 of the
PARSED-AND-RESERIALIZED canonical message array, which excludes the persisted
envelope (`version`, `origin`, `system_prompt`, `updated_at`). The ACT requires
the two not to be compared as though they were interchangeable, so they are
recorded separately and are never compared to each other.

### 2.2 W2 — the previous mature PCK failure (SECONDARY)

```json
{
  "sessionId": "1795489471969_tachv",
  "sessionExtensionVersion": "4.1.26-6fdf56079",
  "canonicalMessageCount": 114,
  "rawFileSha256": {
    "canonicalHistory": "25f51cca6333af3df95729346537d58890729174345077159197765ee7f20d4a",
    "compactionState": "19150f6d3c2bd4a52827c712a0096a2e99288bb1be27899e4bf0f4171348e575"
  },
  "canonicalArraySha256": "3d398ad20c71e9136fb592bb9853a2d9565a0862d368ad76cc211e96a7db9b27"
}
```

**The W2 `canonicalArraySha256` is IDENTICAL to the ACT's quoted
`CANONICAL_ARRAY_SHA256=3d398ad2…db9b27`.** W2 is the workload the R7 ACT
exercised; it is reused here as a secondary comparison, not as a substitute
for W1.

## 3. C0.1 — THE EXACT COMPACTION BOUNDARY (CRYPTOGRAPHICALLY VERIFIED)

The production sidecar records a source-prefix identity. This ACT RE-DERIVED
that identity from the canonical history using the production
`sourcePrefixHash()` algorithm (`sdk/packages/core/src/session/models/session-compaction.ts:164-179`),
reproduced verbatim, and compared it with the sidecar's own value.

### W1

```json
{
  "sourceMessageCount": 244,
  "sourcePrefixHash": "sha256:00720111f28d759454e244ff70200e390b1b710e83e7e77e2136fe2bbe4c22fc",
  "recomputedPrefixHash": "sha256:00720111f28d759454e244ff70200e390b1b710e83e7e77e2136fe2bbe4c22fc",
  "prefixHashMatchesSidecar": true,
  "boundaryMessageId": "msg_wFB1OxLn",
  "boundaryMessageKeyMatchesSidecar": true,
  "sourceLastMessageKey": "id:msg_wFB1OxLn",
  "prefixMessageCount": 244,
  "retainedTailMessageCount": 2,
  "compactedMessageCount": 51
}
```

### W2

```json
{
  "sourceMessageCount": 76,
  "sourcePrefixHash": "sha256:0ca867f86710c79e6f62f7cb5d9c584b7deb894187a8d22a68ac7cb4cc4e26eb",
  "recomputedPrefixHash": "sha256:0ca867f86710c79e6f62f7cb5d9c584b7deb894187a8d22a68ac7cb4cc4e26eb",
  "prefixHashMatchesSidecar": true,
  "boundaryMessageId": "msg_kxswrpiq",
  "boundaryMessageKeyMatchesSidecar": true,
  "retainedTailMessageCount": 38,
  "compactedMessageCount": 19
}
```

**The W1 244-message prefix is an `EXACT_HISTORICAL_SOURCE_PREFIX`.** Two
independent identities agree: the SHA-256 over the prefix, and the boundary
message key.

### OWNERSHIP SEMANTICS — WHAT `source_message_count` MEANS

`source_message_count` is **NOT** a raw list length and **NOT** a slice
boundary on the raw list. `createSessionCompactionState()`
(`session-compaction.ts:201-227`) derives it from
`canonicalSourceMessages()`, which EXCLUDES `metadata.displayOnly === true`
messages. The ACT's acquisition therefore measured the boundary over the
CANONICAL collection and compared the resulting prefix hash with the sidecar.
For W1 the canonical count equals the raw count (246), so no display-only
message is present and the distinction is moot *for this workload* — but the
derivation still used the canonical collection, not the raw list.

Messages generated AFTER the compaction decision are excluded: the prefix is
`canonical[0..243]`, and the retained tail is `canonical[244..245]`.

## 4. C0.2 — HISTORICAL VERSUS RECONSTRUCTED EVIDENCE

| Artifact | Classification | Note |
| --- | --- | --- |
| W1 canonical history file | `EXACT_HISTORICAL_ARTIFACT` | the REAL persisted file, SHA-256 verified |
| W1 compaction sidecar | `EXACT_HISTORICAL_ARTIFACT` | the REAL persisted file, SHA-256 verified |
| W1 source prefix `canonical[0..243]` | `EXACT_HISTORICAL_SOURCE_PREFIX` | prefix hash equals the sidecar's own hash |
| W1 persisted compacted state | `EXACT_HISTORICAL_ARTIFACT` | the historical summary, inspected as-is (arm H) |
| W1 historical provider request | `UNAVAILABLE_FROM_TRACE` | the trace does not record the summarizer request |
| W1 A0/A1 replayed compaction | `RECONSTRUCTED_FROM_REAL_HISTORY` | current-HEAD replay of the production composition over the EXACT historical prefix |
| W1 A0/A1 provider-visible continuation | `RECONSTRUCTED_FROM_REAL_HISTORY` | the production projector + the production carry-forwards |
| W2 equivalents | as above | the same classifications |

**A reconstructed historical prefix is not an exact historical provider
request, and a newly generated summary is not the historical summary.** Arm H
inspects the REAL persisted summary; arms A0/A1 generate NEW summaries and are
labelled `RECONSTRUCTED_FROM_REAL_HISTORY`. A current-HEAD replay is not an
installed-live qualification of a historical VSIX.

## 5. THE HISTORICAL COMPACTED STATE — ITS SHAPE

The persisted W1 compacted state carries 51 messages: one compaction summary
plus a 50-message retained canonical tail. The summary's section structure is:

```json
{
  "summaryMessageRole": "user",
  "summaryChars": 14826,
  "hasTaskContractSection": true,
  "taskContractChars": 10495,
  "hasVerifiedOutcomeSection": true,
  "verifiedOutcomeChars": 759,
  "hasKnowledgeCheckpointSection": false,
  "adjudicationSectionChars": 0
}
```

The retained tail consists of **25 `tool_use` / 25 `tool_result` pairs, all
`run_commands`**, with **no assistant prose and no thinking**. The
`verifiedOutcomeChars` section is the generic call-status ledger.

**There is no Working knowledge checkpoint section**, which is consistent with
the PCK being default OFF at the time of the historical run.

## 6. C0.3 — CONFIDENTIALITY

The recovered histories, sidecars, rendered contexts, raw prompts and raw model
answers live ONLY in the repository's GITIGNORED `tmp/knowledge-loss/` tree.
They are never committed.

Verified: `tmp` is listed in `.gitignore` (line 6). `git status --porcelain`
after the ACT's work lists only the ACT's own new source files — no session
content.

Nothing from the acquired session reaches the committed evidence except
aggregate, non-reversible facts: counts, digests, section names, section
lengths, classification flags, and oracle propositions that are deliberately
ABSTRACTED (they name "the rendered production manifest", "the Java test-file
inventory", "the carrier sender timeout configuration" — never a path, a value
or a credential).

No credential value is reproduced anywhere in the committed evidence. The
bootstrap-administrator oracle item (O10) states that a credential is committed
in plaintext, in both environment values files, without reproducing it. The
operator's provider credential is read at runtime from the operator-local
provider settings and is never written to any output file, log line or evidence
artefact.

The experiments ran against the **already authorized local Kurchatov endpoint**
(`http://192.168.50.239:8080/v1`, model `qwen3.8-flash-next-q2_0`). No
artifact was transmitted to a new external provider.
