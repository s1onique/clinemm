# Read-necessity analysis — the six R4-candidate reads

> **CORRECTION01 APPLIES TO THIS FILE.** Two refinements, no classification changes:
> 1. The reads' **necessity** classifications stand. The evidence that made them
>    necessary was absent from the **summarizer's** input (7 captured summarizer
>    requests, 0 occurrences of the R4 witness) — the original report's characterisation
>    of the summary's "outputs omitted" statement as *false* is **withdrawn**; it was
>    truthful about its own input.
> 2. Read #6's evidence (idx 148) is correctly cited as a **post**-boundary model
>    action. The pre-boundary R4 narrowing it re-derives is at **canonical idx 124**.
>    See `correction01-boundary-verification.md`.

**Classification vocabulary (as mandated by the ACT):** `FIRST_ACQUISITION` ·
`NEW_EVIDENCE` · `CONTRADICTION_CHECK` · `PREVIOUS_EVIDENCE_UNAVAILABLE` ·
`REDUNDANT_REACQUISITION` · `INDETERMINATE`.

**Tool discipline:** the observed tool is **`run_commands`** for all six. They are
**not** `read_files` and are not relabelled as such.

**Identity discipline:** every read is bound by its **tool_use id** to its canonical
result, and every result is bound by the same id. Chronological proximity is never
used as a substitute for identity.

---

## 0. Identity table (REAL)

| # | Call msg idx | Result msg idx | tool_use id | tool | result success | result bytes | Boundary bucket |
|---|---|---|---|---|---|---|---|
| 1 | 6 | 7 | `call_8de6d73cdb5e42f4aa9b6715` | `run_commands` | true | 805 | pre-36→37 |
| 2 | 52 | 53 | `call_e717feee78ba4e4d87f5ba5a` | `run_commands` | true | 2 637 | pre-36→37 |
| 3 | 60 | 61 | `call_b6797054762d46c2b4814b0b` | `run_commands` | true | 2 030 | pre-36→37 |
| 4 | 74 | 75 | `call_9b650a7e84444422b2c7e10a` | `run_commands` | true | 10 905 | post-36→37 / pre-62→63 |
| 5 | 146 | 147 | `call_3973af5e291b4de1b6148bce` | `run_commands` | true | 446 | post-62→63 |
| 6 | 148 | 149 | `call_2fe8658d2b0f410b9e0a2860` | `run_commands` | true | 2 401 | post-62→63 |

All six succeeded. All six produced a single structured payload
`{query, result, success:true}` whose `query` is the command text.

**The ACT's candidate table is confirmed against the real record:** the six indices
resolve to six `run_commands` tool_use/tool_result pairs, all successful, all with
complete output. The ACT's observation *"Neither exact signature detected"* for calls
52 and 148 is also confirmed — their commands are multi-part greps, not the two
`kc.sh build` / `start --optimized` signatures.

---

## 1. Read #1 — canonical idx 6→7

**Command** (`call_8de6d73cdb5e42f4aa9b6715`):
`cd …/keycloak && cat startup.sh && echo '---' && ls -R .helm | head -60 && echo '---' && ls pg-index-diff-20260624T070800Z`

**Source / revision / range:** `startup.sh` (whole file), Keycloak repo at
`42de653b59708e712d694aeb9732f822b7f8fe5b`, branch `optimize-ftls`. Full file — no line
range requested.

**Requested information:** the shape of the repository plus the contents of
`startup.sh`, in one reconnaissance batch. The model stated the intent in its thinking:
"Let me explore structure more: .helm, phone-providers, russian-providers,
pg-index-diff, **startup.sh**, .gitlab-ci.yml, profiles."

**Factual claims supplied (the R4 witness facts):**
- `/opt/keycloak/bin/kc.sh build` appears on a line of `startup.sh`.
- `exec /opt/keycloak/bin/kc.sh start --optimized "$@"` follows it.

---

## 2. Read #2 — canonical idx 52→53

**Command** (`call_e717feee78ba4e4d87f5ba5a`): a three-part batch —
`grep -n -i 'ENTRYPOINT\|CMD\|startup.sh' Dockerfile.roz Dockerfile.do docker-compose.local.yml`,
`git ls-files | grep -i 'changelog\|liquibase'`, and
`grep -rn 'MARK_RAN' phone-providers/*/src/main/resources/META-INF/changelog/*.xml`.

**Source / revision / range:** `Dockerfile.roz`, `Dockerfile.do`,
`docker-compose.local.yml` (matched lines only), Liquibase changelogs under
`phone-providers/*`, at revision `42de653b…`.

**Requested information:** the *counter*-evidence side of R4 — whether the image already
builds Keycloak — together with R5's changelog inventory.

**Factual claims supplied:**
- `Dockerfile.roz:173: COPY --chmod=755 ./startup.sh /opt/keycloak/bin/startup.sh`
- `Dockerfile.roz:189: ENTRYPOINT ["/opt/keycloak/bin/startup.sh"]`
- `Dockerfile.do:41` / `Dockerfile.do:46` — the `do` image also uses `startup.sh`.

**Novelty:** the `Dockerfile.roz` ENTRYPOINT wiring is **new** relative to read #1.
But this read does **not** supply the decisive R4 line `RUN /opt/keycloak/bin/kc.sh
build --spi-freemarker--provider-default=roz-fm233` — that arrives later, at read #3.

**Classification: `NEW_EVIDENCE`** (new provenance for the R4 claim: the image
*installs and invokes* `startup.sh`).

---

## 3. Read #3 — canonical idx 60→61

**Command** (`call_b6797054762d46c2b4814b0b`): `sed -n '160,195p' Dockerfile.roz`,
`sed -n '35,46p' Dockerfile.do`, plus `grep` for pre-arm race docs and
atomic/rollback in `.gitlab-ci.yml`.

**Source / revision / range:** `Dockerfile.roz` lines **160–195**; `Dockerfile.do`
lines **35–46**; `docs/act/*.md`; `.gitlab-ci.yml` — at revision `42de653b…`.

**Requested information:** the image-build stage of the Dockerfile — i.e. **whether the
image already runs `kc.sh build`**, which is the crux of R4.

**Factual claims supplied:**
- `Dockerfile.roz:186: RUN /opt/keycloak/bin/kc.sh build --spi-freemarker--provider-default=roz-fm233`
  — the image **is** already built with the custom provider configuration.
- `Dockerfile.do` has `# RUN /opt/keycloak/bin/kc.sh build` **commented out** — the two
  images differ.


---

## 4. Read #4 — canonical idx 74→75  ← **the post-36→37 re-read**

**Command** (`call_9b650a7e84444422b2c7e10a`), a six-part batch:
`git rev-parse HEAD`, `git branch --show-current`, `git status --porcelain | head -40`,
`git status --porcelain | wc -l`, **`cat startup.sh`**, **`cat Dockerfile.roz`**.

**Source / revision / range:** `startup.sh` (whole), `Dockerfile.roz` (whole),
repository identity — at revision `42de653b…` (confirmed again by this very read).

**Requested information:** the model said exactly why, in its thinking at idx 74:

> "Key finding for R4: Keycloak docs say 'By default, when you use the start or
> start-dev command, Keycloak runs a build command under the covers for convenience
> reasons.' So startup.sh's explicit build is redundant with `start` (which already
> builds). **Actually wait — does startup.sh run `kc.sh start --optimized`? Let me
> re-read startup.sh.**"

**Necessity assessment:**

| Question | Answer | Label |
|---|---|---|
| Was the file's content available to the model immediately before this read? | **No.** The 36→37 summary contains **0** occurrences of the witness string, `start --optimized`, the Dockerfile build line and `PersistedConfigSource`. The only R4 text in the provider-visible context is the task-contract allegation. | REAL |
| Was the *model's own working knowledge* of the file's content available? | **No.** The model's thinking at idx 74 quotes the Keycloak docs (which survived, because the docs came from the **tail** of the pre-compaction provider request, not from the summary) but says "Let me re-read startup.sh" — it does not quote the file it had read 67 messages earlier. | REAL |
| Did the read return materially new information? | **No.** The `startup.sh` body returned by read #4 has the same 4 substantive lines as read #1 (`/opt/keycloak/bin/kc.sh build`; `exec /opt/keycloak/bin/kc.sh start --optimized "$@"`). `Dockerfile.roz` was re-read in full and re-supplied the build line the model had already cited verbatim at idx 52 and idx 60. | REAL |
| Did any intervening source change justify the re-read? | **No.** `git rev-parse HEAD` in this very call returns `42de653b…`, identical to the value read at idx 3 and at idx 155. `git status --porcelain | wc -l` returns `0`. | REAL |
| Did the model have a *specific* unresolved question this read answered? | **Yes, but a self-inflicted one.** The question "does startup.sh run `kc.sh start --optimized`?" is exactly what read #1 had already answered. It was re-asked because the answer was no longer in the model's context — the summary asserted "Tool outputs are omitted in the transcript". | REAL |

**Classification: `PREVIOUS_EVIDENCE_UNAVAILABLE`** — with the precise reading that the
unavailability was **produced by the compaction summary**, not by a genuine gap.

It is **not** `REDUNDANT_REACQUISITION` in the sense the ACT defines it (a read whose
necessity is unjustifiable given what the model could see). The read was **necessary
given the model-visible context**; it was **avoidable given the canonical context**.
That distinction is the whole causal claim, and it is why the classification is
`PREVIOUS_EVIDENCE_UNAVAILABLE` and not `REDUNDANT_REACQUISITION`.

**It is also not `CONTRADICTION_CHECK`:** no new contradictory evidence prompted it —
the model had no reason to doubt the file, because it could not see the file.

---

## 5. Read #5 — canonical idx 146→147  ← **the post-62→63 re-read**

**Command** (`call_3973af5e291b4de1b6148bce`): `cat startup.sh`, then
`grep -n -E 'ENTRYPOINT|CMD|kc.sh build|COPY startup.sh|ENV KC_' Dockerfile.roz | head -30`.

**Source / revision / range:** `startup.sh` (whole), `Dockerfile.roz` (matched lines) —
at revision `42de653b…`.

**Requested information:** the model's thinking at idx 146 batches it with R2/R5/R6/R7/
R8/R9/R10 collection: "Let me look at values.yaml lines 240-260 for pool details, and
the DO values. Then startup.sh, Dockerfile, index diff, hook annotations, bootstrap
admin credentials, NetworkPolicy/PDB/securityContext render." So this is a **general

---

## 6. Read #6 — canonical idx 148→149

**Command** (`call_2fe8658d2b0f410b9e0a2860`): `git grep -n -i 'PersistedConfigSource'`,
`git grep -n -i 'startup.sh' -- 'docs'`, `git grep -n -i 'optimized' -- 'docs' '.helm' Dockerfile.roz`.

**Source / revision / range:** repository-wide `git grep` over tracked files —
`.gitlab-ci.yml`, `docs/evidence/…`, `docs/act/…`, `Dockerfile.roz` — at revision
`42de653b…`.

**Requested information:** the *authoritative* semantics of `PersistedConfigSource` and
the repository's own documentation of the startup-build design. This is the model
pursuing the counterevidence it had lost.

**Factual claims supplied (all new):**
- `.gitlab-ci.yml:124,171,176,182` — CI asserts the baked `PersistedConfigSource`
  contains exactly one `kc.spi-freemarker--provider-default=roz-fm233` entry and
  aborts the deploy otherwise.
- `docs/evidence/ACT-FREEMARKER-233-BUILD-ROZ-P5-DISCRIMINATOR01-EVIDENCE-BINDING.md`
  — documents `PersistedConfigSource.loadPersistedConfig()` and the baked-in selection.
- `docs/act/ACT-KEYCLOAK-PERSISTENT-ASYNC-PROFILER-SUBSTRATE01.md:71` — the final
  `ENTRYPOINT` is `["/opt/keycloak/bin/startup.sh"]`.

---

## 7. Aggregate classification

| Read | idx | Bucket | Classification | Materially new vs canonical record? | Materially new vs model-visible context? |
|---|---|---|---|---|---|
| #1 | 6 | pre-36→37 | `FIRST_ACQUISITION` | yes | yes |
| #2 | 52 | pre-36→37 | `NEW_EVIDENCE` | yes | yes |
| #3 | 60 | pre-36→37 | `NEW_EVIDENCE` | yes | yes |
| #4 | 74 | post-36→37 | `PREVIOUS_EVIDENCE_UNAVAILABLE` | **no** | yes |
| #5 | 146 | post-62→63 | `PREVIOUS_EVIDENCE_UNAVAILABLE` | **no** | yes |
| #6 | 148 | post-62→63 | `NEW_EVIDENCE` (rel. to canonical: `REDUNDANT_REACQUISITION`) | partially | yes |

**No read in the chain is `REDUNDANT_REACQUISITION` in the strict sense.** Every
post-compaction read was *justified by what the model could actually see*, because the
summaries had removed the evidence. That is the finding: the redundancy is
**caused by** the evidence loss, not an independent convergence failure.

evidence-collection batch**, of which `startup.sh` is one of ~8 targets.

**Necessity assessment:**

| Question | Answer | Label |
|---|---|---|
| Was the content available immediately before? | **No.** The 62→63 summary contains **0** occurrences of the witness string, `start --optimized`, the Dockerfile build line, the docs quote and `PersistedConfigSource`. | REAL |
| Did the read return materially new information? | **No.** The returned `startup.sh` body is the same 4 substantive lines read at idx 6 and idx 74; the `Dockerfile.roz` grep returned the same lines 186 and 189 read at idx 52/60/74. | REAL |
| Intervening source change? | **No.** Revision `42de653b…` observed again at idx 155. | REAL |
| Was the R4 adjudication progress preserved? | **No.** The `PersistedConfigSource` narrowing reasoning (A=10 occurrences, B=0) was gone. The model's thinking at idx 148 shows it **re-deriving** the `PersistedConfigSource` fact from scratch: `git grep -n -i 'PersistedConfigSource'`. | REAL |

**Classification: `PREVIOUS_EVIDENCE_UNAVAILABLE`** (same mechanism as read #4).

**Distinctive note:** read #5's result is only **446 bytes** — the *smallest* of the six
R4-related results — yet it re-supplies the same facts as the 805-byte read #1. This is
the sharpest single instance of output redundancy in the R4 chain.

**Novelty:** this is the single most decision-relevant R4 fact, and it is **new**
relative to reads #1 and #2.

**Classification: `NEW_EVIDENCE`** (decisive new source fact, with a new line range
160–195 that no earlier read requested).

> Note on the ACT's table: this read's signature is `kc.sh build`, matching the ACT's
> observation. It is a *first* acquisition of the Dockerfile build line, **not** a
> re-read.


**Novelty:** this is the **first** appearance of the R4 witness string anywhere in the
canonical record (the witness is present at canonical message 7 and nowhere earlier).
It is the *first* acquisition of the R4 source evidence.

**Classification: `FIRST_ACQUISITION`.**

This read alone does **not** adjudicate R4 — it establishes only the *observation*, not
the drift/mixed-build mechanism. The model's own thinking at idx 8 lists "R4 startup.sh"
only as the next investigation target.

## 8. G6 — Quantified redundant work

**Every number below is computed from the canonical record only.** No telemetry was
extrapolated.

### 8.1 R4-related tool calls per boundary bucket

R4-signature predicate: the command mentions `startup.sh`, `kc.sh build`,
`Dockerfile.roz`, `freemarker`, or `PersistedConfigSource`.

| Bucket | R4-signature calls | success | failed | total result bytes |
|---|---|---|---|---|
| pre-36→37 | **7** | 6 | 1 | 37 236 |
| post-36→37 / pre-62→63 | **4** | 4 | 0 | 26 914 |
| post-62→63 | **5** | 5 | 0 | 21 417 |

The single pre-36→37 failure is idx 72, the `fetch_web_content` batch — one of its
three sub-requests failed (`success: false`, 0 bytes) while two succeeded (21 951 +
3 799 bytes). The failure is in the **web fetch**, not in a source read.

### 8.2 Repeated source/command signatures across the whole run

| Signature | Occurrences | Canonical indices |
|---|---|---|
| `cat startup.sh` | **3** | **6, 74, 146** |
| `cat Dockerfile.roz` | 1 | 74 |
| `sed -n '160,195p' Dockerfile.roz` | 1 | 60 |
| `sed -n '175,190p' Dockerfile.roz` | 1 | 166 |
| `git rev-parse HEAD` | 3 | 2, 74, 154 |
| `git status --porcelain` | 4 | 2, 4, 74, 154 |

**`cat startup.sh` occurs exactly three times: once before any compaction, once after
each compaction.** This is the boundary-alignment signature.

`git rev-parse HEAD` / `git status --porcelain` also recur, but at idx 2/4 (before
compaction), 74 and 154 (after each compaction). These are the **task-mandated**
Phase-0 identity check ("Verify repository identity and record working-tree status"),
so their recurrence is not redundant investigation.

### 8.3 Repeated information already available to the model

| Read | Bytes returned | Bytes of *materially new* information | Redundancy |
|---|---|---|---|
| #1 (idx 6) | 805 | 805 (first acquisition) | — |
| #2 (idx 52) | 2 637 | 2 637 (new Dockerfile ENTRYPOINT lines) | — |
| #3 (idx 60) | 2 030 | 2 030 (new Dockerfile build line, new range 160–195) | — |
| #4 (idx 74) | **10 905** | **≈0 for R4** (same `startup.sh` substantive lines; `Dockerfile.roz` re-read in full) | R4 portion ≈ 0 new / ~10.9 k returned |
| #5 (idx 146) | **446** | **0** (same 4 substantive lines; same Dockerfile lines 186/189) | **100 % of the returned bytes re-supply already-known facts** |
| #6 (idx 148) | 2 401 | **2 401 new relative to the post-compaction context**; ≈0 relative to the canonical record (10 prior `PersistedConfigSource` occurrences) | new-in-context, already-known-in-record |

### 8.4 Calls obtaining genuinely new evidence

- Relative to the **canonical record**: **4 of 6** (#1, #2, #3, #6) — of which #6 was
  already obtained pre-compaction.
- Relative to the **model-visible context at the time**: **6 of 6**. Every read
  supplied something the model could not otherwise see.

### 8.5 Calls whose necessity cannot be determined

**0.** Each of the six reads has a determinable necessity class (§7). The one
ambiguity — read #6, new-in-context vs already-known-in-record — is resolved in favour
of *both* labels, with the qualification stated rather than left open.

### 8.6 Additional tool-result bytes and duration

| Read | Additional bytes re-delivered | Canonical message gap (wall) |
|---|---|---|
| #4 (idx 74) | ≈ 10 905 (whole `Dockerfile.roz` + `startup.sh` + identity) | 0.13 s |
| #5 (idx 146) | 446 | 0.04 s |
| #6 (idx 148) | 2 401 | 0.11 s |

> **Duration caveat.** The "canonical message gap" is the wall-clock difference between
> the assistant message's `ts` and its tool-result message's `ts`. It is **not** an
> isolated tool duration and **not** a model-inference duration. The session-level span
> is 2 561.97 s (42.7 min) over 196 messages.

**What is deliberately NOT claimed:** no token consumption, no cache-miss count, and no
wall-clock cost is attributed to the redundant reads. The session metadata reports
aggregate usage (input 3 922 551 · output 61 150 · cache-read 3 670 857) but the
canonical record does **not** attribute tokens to individual requests, so a
per-read token cost is `UNAVAILABLE_FROM_TRACE` and is not estimated.

### 8.7 The distinction the ACT requires

| Claim | Holds? | Why |
|---|---|---|
| Repeated **command** | **YES** | `cat startup.sh` at idx 6, 74, 146. |
| Repeated **output** | **YES** | the same 4 substantive `startup.sh` lines at all three. |
| **Redundant investigation** | **PARTIALLY** | redundant *relative to the canonical record*; not redundant *relative to the model-visible context* (0 relevant evidence was visible). |
| **Compaction-caused repetition** | **YES for the boundary-aligned instances** | the repetitions occur exactly at idx 74 and idx 146 — each immediately after a compaction boundary — and the summaries contain 0 of the relevant facts. |

**The four are not the same and the ACT is right to separate them.** In this run they
coincide *only* because the canonical record and the model-visible context diverged at
exactly the two boundaries where the repetition happened.

**No extrapolation:** this ACT does **not** convert the R4 case into a percentage of
wasted Round C work. The session-level totals are 97 calls and 436 374 result bytes;
the R4 chain accounts for 16 of 97 calls. Any broader percentage claim would require a
full ten-finding reconstruction, which the ACT explicitly does not require.


**Novelty:** the `PersistedConfigSource` concept was **not** in the provider-visible
context after the 62→63 compaction (B=0), even though it had been gathered 10 times
before it (A=10). This read recovered it.

**Classification: `NEW_EVIDENCE`** — *materially new* information relative to the
model's post-compaction context.

**But** the classification is qualified: this information had **already** been
acquired before the 62→63 compaction and was lost by it. So read #6 is
`NEW_EVIDENCE` *relative to the post-compaction context* and `REDUNDANT_REACQUISITION`
*relative to the canonical record*. The ACT's vocabulary does not have a single label
for this; the honest report is both, with the qualification stated.

> This is the **single clearest instance of compaction-caused repeated work** in the
> R4 chain: the model re-grepped for a term it had already grepped for at canonical
> idx 122/124/126 and had already reasoned about at idx 148's predecessor.

---
