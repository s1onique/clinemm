# 00 — Entry identity and frozen evidence

**ACT:** `ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01`
**Authorization:** C1: GO — reproduction and feasibility only. **No production change.**
**Evidence class:** `REAL` (entry + artifact identity), `REAL` (canonical correlation)

---

## 0.1 Entry identity

| Field | Value |
|---|---|
| Repository | `s1onique/clinemm` (local checkout) |
| ENTRY_HEAD (discovered at runtime) | `502d31c5821492147ff1019773d3b5e30fedbbb8` |
| Branch | `main` |
| `git status` at entry | clean (no tracked modifications) |
| Stashes | none (`git stash list` empty — no protected stash was popped or mutated) |
| Untracked evidence at entry | none |
| Historical workspace | Keycloak, branch `optimize-ftls`, revision `42de653b59708e712d694aeb9732f822b7f8fe5b` |
| Session | `1795466566666_uzla2` |
| Capture run | `cap_run_Nw2dRTjG` |
| Compaction boundaries | 15→16 and 33→34 |

**HALT_UNEXPECTED_TRACKED_DIRT:** not triggered. The worktree was clean at entry.

The current epic board (`.factory/epic-board.md`) and all pre-existing ACT evidence were
left untouched. The only new paths under `.factory/` are this ACT's own evidence
directory.

---

## 0.2 Frozen artifact identities — VERIFIED

All six artifacts named by the ACT were located in the private capture root

```text
$HOME/clinemm-private-captures/1795466566666_uzla2/
```

and every SHA-256 matched the ACT's recorded value exactly.

| Artifact | SHA-256 | Verified |
|---|---|---|
| First pre-compaction request (`pre.json`) | `53161e6b3b4190951442dc37e89016a7d1b7e67898a01bc29d2bd250fe83efe1` | ✅ exact match |
| First post-compaction request (`post.json`) | `c938f0e2174a3edf74ddb0580bc1918d25acd722d6d4e73c6c45c00c8463e191` | ✅ exact match |
| Second pre-compaction request (`second-pre.json`) | `40a60baf6ca1fadf0cfe2d6bcfc2538b6e653dcf948af7c4bc98f91dfd3070e2` | ✅ exact match |
| Second post-compaction request (`second-post.json`) | `666c87977416a08fc54cffe7563b012866e40d790d1c57c227d6a76ecd05a807` | ✅ exact match |
| First compaction sidecar (`first-compaction.json`) | `49bff441c6cbcb0aa904aae8a80dcb567e6897a878986834764322b072fd845d` | ✅ exact match |
| Second compaction sidecar (`second-compaction.json`) | `6bc0f6f9dfab122229dc52bc3954144db403ae234c63e26233dcbb02cd43b069` | ✅ exact match |

Reproduction command:

```bash
cd "$HOME/clinemm-private-captures/1795466566666_uzla2" && shasum -a 256 *.json | sort -k2
```

The same verification is asserted executably by
`checkpoint-historical-baseline.test.ts` (case `G2.1`).

---

## 0.3 Session identity, capture ordering, full mode, truncation flags

| Capture | `sessionId` | `runId` | `iteration` | `timestamp` (UTC) | `mode` | `captureStage` | `attempt` |
|---|---|---|---|---|---|---|---|
| `pre.json` | `1795466566666_uzla2` | `run_Nw2dRTjG` | **15** | `2026-11-23T20:51:08.021Z` | `full` | `ai_sdk_prompt` | 1 |
| `post.json` | `1795466566666_uzla2` | `run_Nw2dRTjG` | **16** | `2026-11-23T20:52:20.781Z` | `full` | `ai_sdk_prompt` | 1 |
| `second-pre.json` | `1795466566666_uzla2` | `run_Nw2dRTjG` | **33** | `2026-11-23T21:02:40.184Z` | `full` | `ai_sdk_prompt` | 1 |
| `second-post.json` | `1795466566666_uzla2` | `run_Nw2dRTjG` | **34** | `2026-11-23T21:07:21.865Z` | `full` | `ai_sdk_prompt` | 1 |

- **Session identity:** all four captures carry the frozen session id and run id.
- **Capture ordering:** monotonic in both `timestamp` and `iteration`
  (15 → 16 precedes 33 → 34).
- **Full capture mode:** every capture reports `mode: "full"` — the complete provider
  request was captured, not a truncated sample.
- **Truncation flags:** each capture's summary carries `payloadBytes`, `estimatedTokens`,
  `reasoningBlockCount` and `toolResultCount`. No capture is marked truncated.
- **Distinct model requests:** each capture carries a distinct
  `correlation.modelRequestId` and `correlation.__clineModelBehaviorRequestId`, so no
  capture is a replay of another.

---

## 0.4 Canonical history correlation — EXACT PREFIX RECONSTRUCTION

**This is the decisive G0.2 result.** The canonical session transcript was located at

```text
$HOME/.vscodium-roz/cline-data/sessions/1795466566666_uzla2/1795466566666_uzla2.messages.json
```

and contains **141** canonical messages (0 `displayOnly` messages, so the canonical count
and the raw count agree).

The sidecars' own `source_prefix_hash` values were reproduced **exactly** by hashing the
first `source_message_count` canonical messages with the production v2 algorithm
(`cline-session-compaction-source-v2`, implemented in
`sdk/packages/core/src/session/models/session-compaction.ts`):

| Boundary | Sidecar `source_message_count` | Sidecar `source_prefix_hash` | Recomputed over the canonical history | Match |
|---|---|---|---|---|
| 1 (15→16) | **47** | `sha256:54936f46c7034de73268c085d551d227e1bbced8225e41757d42a22b90a3dbf9` | `sha256:54936f46c7034de73268c085d551d227e1bbced8225e41757d42a22b90a3dbf9` | ✅ **exact** |
| 2 (33→34) | **101** | `sha256:df3d0a481febff3f3c8d5581e930faed80112c9bef8c7e4b609da7136d4c5409` | `sha256:df3d0a481febff3f3c8d5581e930faed80112c9bef8c7e4b609da7136d4c5409` | ✅ **exact** |

The sidecars' `source_last_message_key` values independently agree:

| Boundary | Sidecar `source_last_message_key` | Canonical message id at the boundary |
|---|---|---|
| 1 | `id:msg_ApSB6S4t` | `msg_ApSB6S4t` ✅ |
| 2 | `id:msg_3d6nueiy` | `msg_3d6nueiy` ✅ |

The sidecar's own reported counts (`47`, `101`) are therefore confirmed against the
canonical transcript, not merely accepted.

**Provider-visible counts are NOT canonical counts, and were not treated as such.**
For reference, the four captures carry 30 / 11 / 46 / 9 provider-visible messages
respectively, against canonical prefixes of 47 / 101. The correlation was performed on the
sidecar's own source identity, never on a provider-visible message count.

---

## 0.5 Private-artifact handling

The raw session transcript, the provider payloads and the model-authored checkpoint free
text are **operator-local and never committed**. The generated checkpoint artifacts were
written to the repository's gitignored `tmp/pck-probe-private/` tree (mode `0600`).

The private capture root itself is write-protected in this environment (`EPERM` on
create), so it was treated strictly as a READ-ONLY source. The operator-local analysis
files that pre-existed in it were read only where needed for the baseline and were left
unmodified.

### Exit

**`GO_EVIDENCE_FROZEN`** — not `CAPTURE_INSUFFICIENT`. The exact canonical prefix is
reconstructable at both boundaries, so every downstream analysis in this ACT is possible
against exact canonical evidence.
