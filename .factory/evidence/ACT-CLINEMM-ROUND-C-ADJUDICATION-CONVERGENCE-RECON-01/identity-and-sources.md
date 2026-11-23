# Identity and sources — ACT-CLINEMM-ROUND-C-ADJUDICATION-CONVERGENCE-RECON-01

**Type:** recon / evidence-acquisition. **Implementation authorization:** none.
**Verdict class:** see `qualification-report.md`.

---

## 1. Repository identity

| Property | Value | Label |
|---|---|---|
| Top level | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` | REAL |
| `origin` remote | `git@github.com:s1onique/clinemm.git` | REAL |
| Expected repository | `s1onique/clinemm` | REAL |
| Branch | `main` | REAL |
| `ENTRY_HEAD` | `a493eff078ec5c8f2b6c874ad8f4a85009d1b64f` | REAL |
| `ENTRY_HEAD` subject | `ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CONTAINMENT-01: contain the automatic excerpt carry-forward (default off)` | REAL |
| `FINAL_HEAD` | `a493eff078ec5c8f2b6c874ad8f4a85009d1b64f` (unchanged — read-only ACT) | REAL |
| Protected stashes | none present (`git stash list` empty) | REAL |
| Unexpected tracked dirt | **none** | REAL |
| Untracked (pre-existing, unrelated) | `.factory/evidence/ACT-CLINEMM-MCP-SUPERVISION-V2-LIVE-QUAL01/` | REAL |

**Unexpected tracked dirt → HALT was not triggered.** The only working-tree entry is an
untracked evidence directory belonging to a *different* ACT; it was neither read nor
modified.

**Production delta: NONE.** No tracked file was added, modified, or deleted by this ACT.
The only repository writes are the eight new files under this ACT's evidence directory.

## 2. Installed build identity

The live session's own metadata records the host version it ran under:

```json
"sessionHistoryOrigin": { "mode": "user", "version": "4.1.26-a493eff07" }
```

`4.1.26-a493eff07` matches `ENTRY_HEAD` `a493eff07…` exactly.

**Installed-build identity is therefore RECOVERED and BOUND to `ENTRY_HEAD`.**
`INSTALLED_BUILD_UNVERIFIED` does **not** apply. This is a direct in-band statement by
the running host, not an inference from a git log.

| Property | Value | Label |
|---|---|---|
| Host version string | `4.1.26-a493eff07` | REAL |

## 3. Subject repository (the audited system under test)

| Property | Value | Label |
|---|---|---|
| Path | `/Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak` | REAL |
| Remote | `git@gitlab.roznanie.ru:backend/keycloak.git` | REAL |
| Branch | `optimize-ftls` | REAL |
| HEAD | `42de653b59708e712d694aeb9732f822b7f8fe5b` | REAL |
| HEAD observed in canonical tool results at | canonical msg 3, msg 75, msg 155 — **identical at all three** | REAL |

**No source change occurred between the first and last R4 read.** This is load-bearing
for G7 condition 4 (no intervening source change justified reopening the question).
It is established from three independent observations of `git rev-parse HEAD` inside
tool results, not from a single reading.

## 4. Live session identity

| Property | Value | Label |
|---|---|---|
| Session id | `1795394987994_fpu77` | REAL |
| Source | `vscode` | REAL |
| Provider | `openai-compatible` | REAL |
| Model | `qwen3.8-flash-next-q2_0` | REAL |
| Started | `2026-11-23T00:49:48.104Z` | REAL |
| Transcript last updated | `2026-11-23T01:33:25.390Z` | REAL |
| Session status at capture | `idle` | REAL |
| `exit_code` | `null` | REAL |
| Terminal tool called | **no** — no `submit_and_exit` anywhere in the 97 tool calls | REAL |
| Workspace root | `/Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak` | REAL |
| Usage at capture | input 3 922 551 · output 61 150 · cache-read 3 670 857 | REAL |

The session did **not** reach terminal completion. The last canonical message (index 195)
is a `user` tool-result whose preceding assistant turn (index 194) issued a
`fetch_web_content` call — the run ended mid-investigation with an open R4 question.

> **The ACT's premise "autonomous convergence remains unproven" is confirmed and
> sharpened: the session did not converge; it was still investigating R4 when the
> transcript stopped growing.**

## 5. Input artifacts (PRIVATE — deliberately NOT committed)

All artifacts below are raw transcripts / provider payloads. They stay outside Git.

| Role | Path | Bytes | SHA-256 |
|---|---|---|---|
| Canonical messages | `~/.vscodium-roz/cline-data/sessions/1795394987994_fpu77/1795394987994_fpu77.messages.json` | 827 899 | `9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd` |
| Compaction sidecar | `~/.vscodium-roz/cline-data/sessions/1795394987994_fpu77/1795394987994_fpu77.compaction.json` | 94 713 | `27984ab03e56d66cba54f2b66475fd8a4f8a803becdcb18dca4c5a34d5570091` |
| Session metadata | `~/.vscodium-roz/cline-data/sessions/1795394987994_fpu77/1795394987994_fpu77.json` | 2 304 | `2220739301afdb8c1609befa02653fc0fbb6355a5c5ead55fa9cd336155429da` |
| Compaction candidate 37/36 | `~/.vscodium-roz/cline-data/private/compaction-candidates/1795394987994_fpu77_37_36-ee8075901728--985b23ca0f7536fa576f74b4756985aaab7938fa6b615d0d7594b15523f0ab53.json` | 360 707 | `85bfffaf869fcbee9b8d91d94d3a60c77610fc5d71f232941809291bf1f41da1` |
| Compaction candidate 63/62 | `~/.vscodium-roz/cline-data/private/compaction-candidates/1795394987994_fpu77_63_62-4e1cd3c1082b--c7c79aef22b45ef75c6a605d69f7a9c5cb8e1f24de8fb492129c9ae6038f2a18.json` | 342 791 | `dcdd4c73e00443bbc91b11971c868ae0b972547565055713a24703bc537f45ee` |
| Compaction candidate 97/96 | `~/.vscodium-roz/cline-data/private/compaction-candidates/1795394987994_fpu77_97_96-95b48fc0e5e6--0999ae43e6b762a797355e04ff69796efde55914bc833b90fa292a18288f2c3d.json` | 326 991 | `e4dc3675f979afd93da60f445f4b6ae946e1b7ec0884798907331737aa9da34b` |
| Compaction candidate 98/97 | `~/.vscodium-roz/cline-data/private/compaction-candidates/1795394987994_fpu77_98_97-8aeddaef5256--1c8a8a4f4956c3bf2d9612c0d244407e0060f73ca74ccb6798da8fae3d4c5814.json` | 345 142 | `cde8cdbc7d714c29e611b69914126aaa17550dd9d0bef8f0c6375e8fbbb89429` |

**CANONICAL_SNAPSHOT_SHA256 = `9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd`**

### Private observation snapshot

A read-only copy was frozen at **cutoff 2026-11-23T04:34Z** into
`/tmp/cline-recon-rX/` (outside the repository). All analysis scripts ran against that
frozen copy. The live session directory was **not** written to.

**Cutoff discipline:** every number in this ACT was computed from the frozen snapshot.
The live session was observed to be `idle` with a last-modified time of
`2026-11-23T01:33:25.390Z` — *before* the snapshot cutoff — so no material was
collected at two different cutoffs.

### Provider-capture window

The ACT named a provider-capture run `cap_run_rX-Rbi8y`. **That identifier does not
exist on this machine.** The 89 provider-request files in `~/Downloads` are
`cap_run_*` from *other* runs (e.g. `cap_run_3tw2rDtz_…`, `cap_run_7-rR5tCU_…`) and
none is named `cap_run_rX-Rbi8y`.

The provider-request material for **this** session was recovered from a different and
*stronger* source: the **`compaction_candidate_snapshot`** files, which are the
**actual provider request payloads** (system prompt + apiMessages + tools + modelId +
providerId + `decisionId`) captured at the exact compaction decisions. These are
first-party production captures of the same class as `provider-request-capture`
output, with strictly more information (they carry the pre-compaction request that
the summarizer consumed).

| Boundary | decisionId | apiMessages | Role |
|---|---|---|---|
| 37/36 | `1795394987994_fpu77#37#36` | 74 | the **pre-compaction** provider request at boundary 36→37 |
| 63/62 | `1795394987994_fpu77#63#62` | 57 | the **pre-compaction** provider request at boundary 62→63 |
| 97/96 | `1795394987994_fpu77#97#96` | 77 | pre-compaction request at a later boundary (not R4-relevant) |
| 98/97 | `1795394987994_fpu77#98#97` | 79 | pre-compaction request at a later boundary (not R4-relevant) |

**CAPTURE_WINDOW** = the provider-request snapshots for decisions
`#37#36`, `#63#62`, `#97#96`, `#98#97` of session `1795394987994_fpu77`,
captured by the installed host `4.1.26-a493eff07`.

`cap_run_rX-Rbi8y` is recorded as **UNAVAILABLE_FROM_TRACE** for this machine. The
recovered candidate snapshots are the *production* provider payloads for the same
boundaries, so the boundary reconstruction does not depend on the missing run id.
The capture-run id is **not** used to support any causal claim below.

### Summarizer-request captures (recovered by CORRECTION01)

The **actual summarizer requests** were located during CORRECTION01 in
`~/.vscodium-roz/cline-data/provider-request-captures/`, run id
**`cap_41f75c5386d5db78`**, files `cap_41f75c5386d5db78.ai_sdk_prompt.{1..7}.provider-request.json`.

They are distinguishable from the main-model captures by
`payload.system` = *"Summarize the provided coding session into a concise continuation
note with detailed next steps."* (the agentic summarizer's system prompt).

| # | timestamp | `[result omitted]` markers | R4 witness occurrences |
|---|---|---|---|
| 1 | 2026-11-22T22:09:27.030Z | 79 | **0** |
| 2 | 2026-11-22T22:21:01.859Z | 70 | **0** |
| 3 | 2026-11-22T22:42:42.417Z | 46 | **0** |
| 4 | 2026-11-22T22:55:35.700Z | 52 | **0** |
| 5 | 2026-11-23T01:02:12.706Z | 34 | **0** |
| 6 | 2026-11-23T01:14:57.428Z | 34 | **0** |
| 7 | 2026-11-23T01:32:30.273Z | 32 | **0** |

**These are PRIVATE and are NOT committed.** Their hashes are recorded in
`artifact-hashes.json` under `private_input_artifacts`.

> Note on the run id: the ACT named `cap_run_rX-Rbi8y`; the run that actually produced
> this session's captures is `cap_41f75c5386d5db78`. The named id remains
> `UNAVAILABLE_FROM_TRACE`; the recovered run id is reported as observed.

## 6. Production source paths inspected (read-only)

| Path | Role | Label |
|---|---|---|
| `sdk/packages/core/src/extensions/context/compaction-shared.ts` | summarizer-input projection of tool results | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/evidence-continuity.ts` | source-file-fact extraction + deterministic sections | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/compaction.ts` | compaction orchestration | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/agentic-compaction.ts` | agentic compaction path | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/task-contract.ts` | task-contract preservation | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/session/models/session-compaction.ts` | session compaction model | REAL_PRODUCTION_SEAM |
| `sdk/packages/llms/src/providers/provider-request-capture.ts` | provider-request capture | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/compaction.evidence-fidelity01.test.ts` | existing production-seam RED suite for this exact mechanism | REAL_PRODUCTION_SEAM |

**No repair design was frozen during recon.** The production code was read to
*classify* the observed behaviour, not to design a change.

## 7. Executed gates

| Gate | Command | Result |
|---|---|---|
| Production-seam RED suite | `bun x vitest run src/extensions/context/compaction.evidence-fidelity01.test.ts --config vitest.config.ts` (cwd `sdk/packages/core`) | **39 passed (39)**, exit 0 |
| Canonical conservation | offline analysis of the frozen snapshot | 196 messages · 97 calls · 97 results · 0 unmatched · 0 duplicate call ids |
| Boundary conservation | sidecar `source_last_message_key` vs canonical index | `id:msg_7ztXgjkW` found at canonical index **125** → covered prefix **126** ✔ |
| 36→37 boundary | `37_36` candidate last apiMessage `msg_NFcQJe45` → canonical index **73** → covered prefix **74** ✔ | matches the ACT's table |
| 62→63 boundary | `63_62` candidate last apiMessage `msg_7ztXgjkW` → canonical index **125** → covered prefix **126** ✔ | matches the ACT's table |

The 36→37 and 62→63 boundaries are reproduced from the captured artifacts exactly as
the ACT's table states them (`74` and `126` canonical messages).

## 8. Privacy

- Raw transcripts, provider payloads and canonical transcripts: **0 bytes copied into Git**.
- This evidence directory contains only derived, redacted analysis.
- No credential values are reproduced. The audited repository's bootstrap-admin
  credential was never printed by the model (the model itself redacted it, and no
  excerpt is carried here).
- No prompt text, provider payload body, or canonical transcript body is committed.
  Committed files contain exact-string *probe names* and short factual excerpts
  required to make the causal claim checkable.


| Bound commit | `a493eff078ec5c8f2b6c874ad8f4a85009d1b64f` | REAL |
| Source-of-truth for attribution | the session's own `origin.version` field | REAL_PRODUCTION_SEAM |
