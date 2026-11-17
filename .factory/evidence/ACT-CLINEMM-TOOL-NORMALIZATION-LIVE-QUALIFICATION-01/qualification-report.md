# ACT-CLINEMM-TOOL-NORMALIZATION-LIVE-QUALIFICATION-01 — qualification report

**Verdict: `PASS_LIVE_NORMALIZATION_QUALIFIED`**

Production source is **UNCHANGED**. No normalization behavior was altered, no
schema was relaxed, no diagnostic was added, no public API field was added.

---

## 1. What was actually established

The ACT's question is whether ClineMM's real tool-call normalization contract
works against the model-facing schema and the installed-runtime execution path.
The answer is **yes**, and it is established by live evidence, not by prose.

The installed runtime (`s1onique.clinemm 4.1.16-5a1c485cb-8c3351e56`, the
active pinned extension in the VSCodium profile) contains all four
normalization fixes (`0b6ec51af`, `feffc821b`, `02a70e9cb`, `b1ad2a0de`), and
its minified `dist/extension.js` normalizer was read directly and confirmed
**semantically identical** to the repo source — including the HARNESS-03
encoded-object-array branch:

```js
if(!s.every(c=>typeof c==="string")){if(n!=="commands")return t;
  let c=g2s({commands:s});return c===null?t:{commands:c}}
```

## 2. The five qualification items

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Valid strict-schema tool calls | **QUALIFIED (live)** | The Qwen baseline session emitted **21/21** `run_commands` calls in the canonical strict shape (`{commands: string[]}`, sole key). All 21 recorded `schemaValid=true`; zero rejections. |
| 2 | The previously observed `run_commands` object-array normalization shapes | **QUALIFIED (live)** | The live Round C session `1794702518894_gui73` emitted **193** `run_commands` calls, including exactly the 4 shell-quoted JSON-array-string shapes and the 4 object-list shapes the fixtures claim — at the documented message indices (21, 27, 27, 285 / 63, 99, 107, 111) and the documented tool-call ids. |
| 3 | Conservation of sibling fields and command ordering | **QUALIFIED** | Ordering is conserved across all three normalization branches (object-list, encoded object-array, canonical); duplicates are not collapsed; the serialized JSON text is never forwarded as a command. Sibling fields are **conserved by failing closed**: every branch requires a single-key object, so a payload carrying any sibling — including a DECLARED one such as `notifyOnCompletion` — is returned UNCHANGED and rejected by the strict schema rather than being silently dropped. |
| 4 | Malformed / unsupported arguments must fail closed | **QUALIFIED (live RED + live GREEN)** | The live Flint session `1794587196390_xn030` recorded **12** rejections, all `Invalid input for tool run_commands` (application-side validation, B4). The live session `1794593797996_r48lj`, running the repaired build, **accepted** the same `{command: "<JSON array string>"}` shape that was rejected 11/11 in the earlier session. |
| 5 | Tool-call identity and correlation through execution and result delivery | **QUALIFIED (live, exact)** | The live trace records 26 `tool_execution` and 26 `tool_result_delivered` boundaries with **identical tool-call id sets** and **zero tool-name mismatches**; the start/end event pairs are well formed for both boundaries. **CORRECTION01:** the transcript↔trace correlation is now **LIKE-FOR-LIKE over ALL tool calls** — 26 transcript ids vs 26 trace ids, **26 shared, 0 on either side**, 0 tool-name mismatches. (The pre-correction report claimed "21 ⊂ 26 with 5 trace-only"; that was an apples-to-oranges comparison — see §9.2.) |

## 3. The decisive discriminator: the runtime's handling of the argument shape

The most important finding of this ACT is a **causal** one.

The shape `{command: "<JSON array string>"}` appears in BOTH live Flint
sessions. In the earlier session it was rejected **11 out of 11** times; in the
later session the identical shape was **accepted**. The payload is byte-class
identical (valid JSON array of strings) in both. The discriminator is therefore
**the runtime's handling of the shape**, not the payload, not the schema, not
the provider and not the model:

| Live session | `clientVersion` (captured) | `{command: "<JSON array string>"}` |
|---|---|---|
| `1794587196390_xn030` | `4.1.16-5a1c485cb` | **REJECTED ×11** (`✖ Unrecognized key: "command"`) |
| `1794593797996_r48lj` | `4.1.16-5a1c485cb` | **ACCEPTED ×4** (+2 with no recorded result) |

This is a live, two-sided, same-shape RED→GREEN observation. The only
production seam that can admit this shape is `normalizeRunCommandsToolInput` —
the normalizer — so the normalizer is the discriminating boundary.

**CORRECTION01 scope note:** both sessions report the SAME captured
`clientVersion`. The specific build identity (`0b6ec51af` for the later
session) is a **source-based attribution** from the production docstring, not
a capture-based observation. See §4.2 for the exact identity scope.

## 4. The Flint boundary: what the failures actually were

The ACT asks whether Flint failures originate from GLM-style emitted syntax,
provider incompatibility, the model-facing schema, or the ClineMM normalizer.
The live evidence answers this unambiguously:

1. **NOT provider-side schema rejection.** Every live `run_commands` rejection
   is `Invalid input for tool run_commands: …` — the **application-side** Zod
   message emitted at B4. The provider never rejected the request.
2. **NOT a provider incompatibility.** The provider delivered **well-formed
   structured tool calls**: every rejected block is a proper
   `type: "tool_use"` with `id`, `name: "run_commands"` and an `input` object.
   Only the *argument shape* inside `input` was wrong.
3. **NOT the model-facing schema.** The schema was **advertised but not
   provider-enforced**. **CORRECTION01 — the pre-correction wording here was an
   OVERCLAIM and is corrected:** it said "`strictJsonSchema = false` in every
   captured request". The corrected analyzer inspects **every** capture and
   finds the field **ABSENT in 496 of 622** captures (all 496 belong to session
   `1794524499963_op3ld`), so the overall finding is **MIXED**
   (`FALSE` + `UNKNOWN`), not uniformly `false`. The claim that survives is the
   one this ACT actually relies on: **both Flint sessions — the two sessions
   the boundary argument depends on — record `strictJsonSchema = false` in
   EVERY one of their 23 captures** (witness check C4b). Independently of
   strictness, **all 622 captures carry a byte-identical `run_commands`
   schema** (exactly ONE distinct hash), so the schema advertised to the
   provider was constant across the whole capture set.
4. **THE MODEL'S ARGUMENT CONSTRUCTION, handled by the ClineMM normalizer.** The
   model emitted the singular key `command` (or `commands`) with a STRING value
   where the schema requires an ARRAY. The malformed argument shape is the
   model's; the *boundary* that rejected it, and then accepted it after the
   repair, is ClineMM's.

**Arbitrary textual GLM markup is NOT a valid structured tool call.** Every
Flint payload in evidence is a genuine structured tool call whose *arguments*
are malformed. No evidence in the corpus supports treating GLM prose markup as
a structured tool call, and none is claimed here.

### 4.1 Flint live qualification: `LIVE_UNOBSERVABLE`

**Flint is not currently available in the installed runtime.**

- The model registry still carries a stale entry
  (`providers/openai-compatible/models/flint:16gb`), but the provider endpoint's
  `/v1/models` serves exactly one model: `qwen3.8-flash-next-iq3_s`.
- A direct request with `model=flint:16gb` was **silently served by
  `qwen3.8-flash-next-iq3_s`** — the endpoint ignores an unknown model name.

A live Flint run therefore cannot be performed in this installed runtime.
Per the ACT's instruction, **no synthetic fixture was used to fabricate a
passing live Flint test**. The Flint conclusion above is drawn from the two
**real** live transcripts and the **real** captured provider requests on disk,
which is the authoritative evidence that existed before the model became
unavailable. The verdict for a *fresh* live Flint run is `LIVE_UNOBSERVABLE`.

No new model run was performed: the existing evidence was sufficient to
establish the required boundary (items 4 and 5 above), so the ACT's
"a new model run is permitted **only if** existing evidence cannot establish
the required boundary" condition was not met.

#### 4.2 CORRECTION01 — the Flint identity scope, stated exactly

The pre-correction report attached the two Flint sessions to a build identity
in a way that could be read as stronger than the evidence allows. The precise,
preserved facts are:

| Live session | Model | Provider | Build identity | Provenance of the identity |
|---|---|---|---|---|
| `1794587196390_xn030` | `flint:16gb` | `openai-compatible` | `4.1.16-5a1c485cb` | the session's own `origin.version` **and** the `clientVersion` in all 23 of its provider-request captures |
| `1794593797996_r48lj` | `flint:16gb` | `openai-compatible` | `4.1.16-5a1c485cb` | the session's own `origin.version` **and** the `clientVersion` in all 23 of its provider-request captures |
| `1794702518894_gui73` (Round C) | `qwen3.8-flash-next-iq3_s` | `openai-compatible` | `4.1.16-5a1c485cb` | the session's own `origin.version` |
| `1794892591345_7em4g` (Qwen baseline) | `qwen3.8-flash-next-iq3_s` | `openai-compatible` | `4.1.16-5a1c485cb` | the session's own `origin.version` **and** the trace's `identity.extensionVersion` |

**Both Flint sessions report the SAME client version string**
(`4.1.16-5a1c485cb`). The pre-correction report attributed the RED→GREEN
difference to the build `4.1.16-5a1c485cb-0b6ec51af` on the strength of the
production docstring in `helpers.ts` (lines 326–329), which NAMES that build
for session `1794593797996_r48lj`. **That attribution is a SOURCE-BASED
inference, not a capture-based observation**: the version string in the
transcripts and in all 46 provider-request captures is the base
`4.1.16-5a1c485cb` for BOTH sessions.

**What is observed, and is not in doubt:**

- The **payload shape is byte-class identical** between the two sessions: the
  same `{command: "<JSON array string>"}` form with a valid JSON array of
  strings.
- It was **REJECTED 11/11** in `1794587196390_xn030` and **ACCEPTED 4/4** in
  `1794593797996_r48lj` (plus 2 with no recorded result).
- The two sessions' `clientVersion` strings are identical, and both were
  captured against the same provider with the same `run_commands` schema.

**What is inferred:** that the difference is the source build. The
`0b6ec51af` commit is precisely "canonicalize the confirmed Flint JSON-array
`command` payload", and it is an ancestor of HEAD, so the causal story is
consistent — but the sessions do not carry a capture that distinguishes the
builds. **The discriminator is therefore established as "something changed in
the runtime between the two sessions that admits this shape", and the
normalizer is the only seam in the production path that can do so** — but the
specific build identity is a source-based attribution.

**This weakens the claim, and the claim is restated accordingly.** The
pre-correction report said the discriminator is "the BUILD". The corrected
statement is: the discriminator is **the production runtime's handling of the
argument shape**, and the only production seam that changes that handling is
`normalizeRunCommandsToolInput` — the normalizer. The build-identity
attribution is retained as a source-based corroboration, not as an observation.

## 5. Coverage assessment — was an adversarial witness needed?

The ACT says: *"Use existing real-production-seam tests. Add a focused
adversarial witness only where coverage is missing."*

**No new test was added, and none was needed.** The coverage was assessed
against the five items and found sufficient:

| Item | Existing coverage | Gap? |
|---|---|---|
| 1 — valid strict-schema calls | HARNESS-03 `…json-object-array.test.ts` (28 tests, incl. the real runtime seam) + HARNESS-01 `…runtime.test.ts` (13 tests, driven with the LIVE fixtures) | none |
| 2 — object-array normalization shapes | HARNESS-01 `…normalization.test.ts` (30 tests) against the LIVE Round C fixtures; the fixtures were re-verified against the live transcript on disk (message indices and tool-call ids match exactly) | none |
| 3 — sibling conservation + ordering | HARNESS-02 `…normalization.boundary.test.ts` (9 tests) covers the sibling-key boundary; ordering/conservation is asserted in HARNESS-03 (*"preserves every command, in order, with nothing dropped"*, *"produces the SAME canonical form as the object-list shape"*) | none |
| 4 — malformed / unsupported → fail closed | HARNESS-03 fail-closed block (9 cases) + FLINT-RED-01 rejection matrix (20 tests) + FLINT-CORR-01 (35 tests) + the **live** RED/GREEN pair in §3 | none |
| 5 — identity + correlation | The live trace itself (26/26 execution↔delivery ids; **CORRECTION01: 26/26 transcript↔trace ids, LIKE-FOR-LIKE over all tool calls**); the runtime seam test asserts the approved input equals the executed commands | none |

A probe was run to look for a gap in item 3 — sibling-field conservation on
the *non-canonical* branches. It found **no defect**: the single-key rule makes
every such payload fail closed rather than silently dropping the sibling. This
is the same rule the HARNESS-02 boundary suite already pins, so a new test
would have been redundant.

### 5.1 One honest limitation (recorded, not papered over)

**The HARNESS-03 shape has no live-source witness.** The
`{commands: "[{\"command\":…}]"}` shape (a JSON-encoded array of OBJECTS) was
scanned across **201 live sessions** in the operator profile and occurs in
**NONE** of them. It is a *composition* of the two shapes that WERE observed
live (the shell-quoted JSON-array-string shape and the object-list shape),
each of which is separately live-witnessed and separately covered.

This is a limitation of the evidence, not of the contract: the HARNESS-03
branch is exercised by the production-seam suite (28 tests), it is present in
the installed runtime bundle, and the two shapes it composes are live-observed.
It is recorded so that the `PASS_LIVE_NORMALIZATION_QUALIFIED` verdict is not
read as claiming a live observation that does not exist.

## 6. Causality and safety

The ACT's repair gate is: *REAL failure → authoritative boundary → RED
reproduction → causal discriminator → necessity → bounded successor repair.*

| Stage | Result |
|---|---|
| REAL failure | **Observed live** — 12 rejections in `1794587196390_xn030`, 8 in `1794702518894_gui73`, 7 in `1794593797996_r48lj` |
| Authoritative boundary | **B4 (application-side strict Zod validation)**, established from the rejection message text and from the trace's `schema_validation` boundary — *not* B1 (provider) |
| RED reproduction | **Observed live** — the same `{command: "<JSON array string>"}` shape rejected 11/11 pre-fix |
| Causal discriminator | **Build version** — the identical shape is accepted 4/4 post-fix (§3). The schema, the provider and the model are held constant |
| Necessity of a repair | **Already satisfied** — the repair (`0b6ec51af`, `feffc821b`) is already in production AND in the installed runtime |
| Bounded successor repair | **NOT REQUIRED AND NOT PERFORMED** — no failure reproduces against the current code |

**No production repair was made.** No normalization behavior was changed. No
failure reproduces against the current HEAD, so per the ACT's instruction
("If no failure reproduces, do not change normalization behavior") nothing was
changed.

Safety constraints honoured:

- **No relaxation of the public tool schema.** `RunCommandsInputSchema` is
  untouched: still `.strict()` (`additionalProperties: false`), `commands` is
  still `array<string>` with `minItems: 1`, `required: ["commands"]`.
- **No new permanent API fields.**
- **No always-on diagnostics.** The existing `schema_validation` /
  `tool_execution` / `tool_result_delivered` boundaries are unchanged; the
  analyzer is an offline, read-only tool.
- **No raw provider payloads, prompts or secrets in Git.** The provider
  settings file (which contains API keys) was read once to probe model
  availability but **no key, prompt, command text or provider payload was
  written into any committed artifact**. The committed evidence contains
  shapes, counts, hashes and tool-call ids only.

## 7. Gates executed

| Gate | Command | Result |
|---|---|---|
| G1 — the nine normalization suites | `vitest run src/extensions/tools/{roundc-toolcall-json-object-array, roundc-toolcall-normalization, roundc-toolcall-normalization.boundary, roundc-toolcall-runtime, flint-toolcall-red01, flint-toolcall-red01-correction01, flint-toolcall-red01-witness, helpers.run-commands, definitions}.test.ts` | **230 / 230 passed**, 9 / 9 files (`gate-01`) |
| G2 — the whole `src/extensions/tools/` tree | `vitest run src/extensions/tools/` | 679 passed, 6 failed, 105 skipped — the 6 failures are PRE-EXISTING and environment-caused (`gate-02`, `gate-04`) |
| G3 — the LIVE Flint witness verifier | `vitest run --reporter=verbose src/extensions/tools/flint-toolcall-red01-witness.test.ts` | **4 / 4 EXECUTED (not skipped)** against the live transcript on disk (`gate-03`) |
| G4 — pre-existing-failure proof | `git diff --stat ab5ee16ec HEAD -- <the 2 files>`; `git diff --stat HEAD` | both EMPTY (`gate-04`) |
| G5 — typecheck | `tsc -p tsconfig.dev.json --noEmit` | 43 diagnostics = the pre-existing baseline; **0** in `helpers.ts` / `schemas.ts` / `definitions.ts` (`gate-05`) |
| G6 — the analyzer | `bun tool/qualify.ts > analysis.json` | exit 0 (`analysis.json`) |

### 7.1 The 6 pre-existing failures are NOT caused by this ACT

They are in `executors/editor.realpath-authority.test.ts` (3) and
`executors/bash.supervised.bash-startup-env.test.ts` (3) — the **editor**
executor and the **bash supervisor**, neither of which is on the
`run_commands` normalization seam. Their cause is the macOS
`/private/var` ↔ `/var` realpath (the assertion text shows the resolved
`/private/var/...` path) and inherited shell-env behaviour. Both files are
**byte-identical** between the pre-ACT baseline `ab5ee16ec` and HEAD, and the
working tree is clean, so they cannot have been affected by this ACT.

## 8. Disposition

**`PASS_LIVE_NORMALIZATION_QUALIFIED`**

The installed-runtime behaviour establishes the bounded contract:

- The model-facing schema is strict and was verified byte-identical in the
  provider requests actually dispatched.
- The provider does NOT enforce that schema (`strictJsonSchema: false` in
  every capture of BOTH Flint sessions — the sessions the boundary argument
  depends on; the field is ABSENT in 496 of 622 captures overall, so the
  corpus-wide finding is MIXED), so the application-side boundary is the
  authoritative one — and it is.
- The production normalizer accepts every live-observed shape, conserves
  ordering, conserves sibling fields by failing closed, and rejects malformed
  input before approval and before execution.
- Tool-call identity is conserved exactly from the model's structured call
  through normalization, validation, approval, execution and result delivery
  (26/26 execution↔delivery ids; **26/26 transcript↔trace ids** under the
  corrected like-for-like comparison).
- The same-shape live RED→GREEN pair isolates the normalizer as the causal
  discriminator.

**Sub-classifications**

- Fresh **live Flint** qualification: `LIVE_UNOBSERVABLE` (the model is not
  served by the installed runtime's endpoint; the registry entry is stale). The
  historical Flint boundary is nevertheless fully established from two real live
  transcripts and 622 real provider-request captures.
- The **HARNESS-03 encoded-object-array** shape: production-seam qualified,
  but **not live-witnessed** (0 occurrences in 201 scanned live sessions).
- **No production change is warranted.** A successor repair ACT would need a
  NEW real failure against the current build; none exists.

## 9. CORRECTION01 — what was repaired in the offline analyzer

The prior ACT committed an offline analyzer (`tool/qualify.ts`) that was
**never machine-verified** — it had no test and no witness. This correction
repairs three P0 evidence-integrity defects in it. **Production source is
unchanged**; the analyzer is an evidence tool, not product code.

### 9.1 The three defects, each reproduced RED

| Defect | The defect | RED evidence |
|---|---|---|
| **A** — tautological end-event checks | `idMap` filtered on `phase === "start"`, so the "end" maps were **copies of the "start" maps**. `executionStartEndIdsMatch` / `deliveryStartEndIdsMatch` were therefore TRUE by construction, and the reported `toolExecutionEnds` / `toolResultDeliveredEnds` were the START counts. | With one `tool_execution` END event removed, the original still reported `executionStartEndIdsMatch: true` and `toolExecutionEnds: 26`. |
| **B** — first-capture-only capture inspection | The capture loop `continue`d on every capture after the first of a session, so a later capture with a DIFFERENT `run_commands` schema hash was invisible and the "all captures identical" claim was unfalsifiable. | With two captures in one session carrying different schema hashes, the original reported only the FIRST capture's hash and no consistency flag. |
| **C** — missing `strictJsonSchema` collapsed to a value | `strictJsonSchema ?? null` collapsed an ABSENT field to `null`, indistinguishable from a recorded `false` in a boolean reading. | With a capture carrying no `strictJsonSchema` field, the original reported `strictJsonSchema: null`. |

**RED receipt:** `gate-06-red-analyzer.txt` — **4 / 23 checks passed** against
the original analyzer (the version committed at `86d8a691d`, with ONLY the path
seam added so it could be driven against a fixture; no logic changed).

### 9.2 What the corrected analyzer does

- Selects `start` and `end` **independently** and compares **cardinality**, the
  **ID sets**, the **ordering** (an end must not precede its start) and the
  **matching tool names**. It reports the unmatched ids explicitly.
- Inspects **every** provider capture and reports `parsedCaptures`,
  `invalidCaptures`, `capturesMissingCorrelation`, `capturesMissingToolSchema`
  and `capturesMissingStrictJsonSchemaField` explicitly.
- **Derives** schema consistency (`runCommandsSchemaConsistent`,
  `allCapturesShareOneRunCommandsSchema`, the set of distinct hashes) and the
  strictness finding (`FALSE` / `TRUE` / `UNKNOWN` / `MIXED`) from the observed
  values. A missing `strictJsonSchema` yields `UNKNOWN`, never `false`.
- Compares the transcript and the trace **like-for-like over ALL tool calls**.

### 9.3 The report corrections this forced

Two of the prior report's claims did not survive the corrected analysis and are
restated here.

**9.3.1 The five "trace-only" tool IDs were an artifact.** The prior report
said the transcript's 21 `run_commands` ids were "a strict subset" of the
trace's 26, listing 5 trace-only ids. The transcript list held only
`run_commands` calls while the trace list held **all** tool calls — an
apples-to-oranges comparison. The 5 ids were `3 × read_files`,
`1 × fetch_web_content` and `1 × submit_and_exit`, and **all 5 ARE in the
transcript**. The corrected like-for-like comparison is **26 vs 26, 26 shared,
0 on either side, 0 tool-name mismatches** — a *stronger* result than the
prior claim, not a weaker one.

**9.3.2 The `strictJsonSchema` claim was an overclaim.** The prior report said
"`strictJsonSchema = false` in every captured request". The field is **ABSENT
in 496 of 622** captures (all 496 belong to session `1794524499963_op3ld`), so
the corpus-wide finding is **MIXED**. The narrower claim the ACT actually
relies on holds and is now machine-verified: **both Flint sessions record
`false` in every one of their 23 captures** (witness check C4b).

### 9.4 The corrected gates

| Gate | Result |
|---|---|
| **G6** — RED against the original analyzer | **4 / 23 passed** → exit 1 (`gate-06-red-analyzer.txt`) |
| **G7** — GREEN against the corrected analyzer | **23 / 23 passed** → exit 0 (`gate-07-green-analyzer.txt`) |

The witness (`tool/witness.ts`) drives the analyzer as a **subprocess** against
the adversarial fixtures (`tool/fixtures/`, built by `tool/make-fixtures.ts`)
and against the **preserved real artifacts**. It is deliberately tolerant of a
missing field: the ABSENCE of a field the analyzer ought to emit is itself a
reported FAIL, never a crash.

### 9.5 The verdict after correction

**`PASS_LIVE_NORMALIZATION_QUALIFIED` is retained**, on the corrected gates:

- The five qualification items are unchanged in substance, and item 5 is now
  stronger (26/26 like-for-like rather than 21/26).
- The boundary attribution (application-side validation, not provider-side) is
  unchanged and rests on the rejection-message text, not on the analyzer.
- The RED→GREEN pair for the argument shape is unchanged as an OBSERVATION; only
  the *attribution* of the discriminator is narrowed (§3, §4.2).
- The strictness conclusion is narrowed to what the captures actually support,
  and the boundary it supports is unaffected.

**No production change is warranted.** A successor repair ACT would still need
a NEW real failure against the current build; none exists.
