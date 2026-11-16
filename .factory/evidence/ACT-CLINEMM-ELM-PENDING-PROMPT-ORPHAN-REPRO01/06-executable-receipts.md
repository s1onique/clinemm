# 06 — Executable Receipts

ACT: `ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01`

```
INSTALLED_INCIDENT_SOURCE_HEAD = 1d9a37bcd408c185ef356303e1e5ac6237a15307
REPLAY_SUBJECT_HEAD            = e0e30879f9e5cf0716242b00dc3cd9447fbaa6e1
```

Toolchain: `bun` at `$HOME/.bun/bin/bun` (not on the default `PATH` in this
shell; `export PATH="$HOME/.bun/bin:$PATH"` is required).

---

## GATE 1 — Adapter event identity

**Command**

```
$ cd apps/vscode
$ export PATH="$HOME/.bun/bin:$PATH"
$ bun x vitest run --config vitest.config.ts \
    src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts
```

**Producer/adapter input and output (exact)**

| Direction | Value |
|---|---|
| producer input (real seam) | `event.type === "run-started"`, `event.snapshot.runId === "run_rCw8nsup"`, held prompt `"pending_1794841243556_-tSbr"` |
| captured record | `{ stage: "continuation_started", origin: "pending_prompt_drain", sessionId: "1794840293250_5ugld", promptId: "pending_1794841243556_-tSbr", runId: "run_rCw8nsup" }` |
| REAL `adaptRecord` output | `{ status: "DIRECT", elmMsg: { tag: "continuation_started", promptId: "pending_1794841243556_-tSbr", runId: "run_rCw8nsup" } }` |

Observed in the run:

```
OPPOR01-COUNTERFACTUAL-REPORT {
  "adapterStatus": "DIRECT",
  "adapterReason": "mapped to continuation_started",
  "elmMsg": {
    "tag": "continuation_started",
    "promptId": "pending_1794841243556_-tSbr",
    "runId": "run_rCw8nsup"
  },
  "finalKind": "authorize",
  "finalHoldReasons": []
}
```

**Gate 1 result: PASS.**

---

## GATE 2 — Real Elm kernel replay (actual kernel decision)

The kernel loaded is the shipped artifact:
`apps/vscode/elm/completion-authority/vendor/completion-authority.js`
SHA-256 `15c61e20468c36ac7bc3caed840c1012f5c5accbb0bcb96e0c748a00ad8d4f4c`.

Run output (unfiltered, verbatim):

```
 RUN  v4.1.10 /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode
stderr | src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts > OPPOR01 - source-bound replay of the incident session through the REAL Elm authority seams > OPPOR01-REPLAY: the recorded incident sequence reproduces the hold / pending_prompt decision
Compiled in DEV mode. Follow the advice at https://elm-lang.org/0.19.2/optimize for better performance and smaller assets.
stdout | src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts > OPPOR01 - source-bound replay of the incident session through the REAL Elm authority seams > OPPOR01-REPLAY: the recorded incident sequence reproduces the hold / pending_prompt decision
OPPOR01-REPLAY-REPORT {
  "sessionId": "1794840293250_5ugld",
  "recordsReplayed": 64,
  "adapterDirect": 15,
  "adapterInsufficientIdentity": 44,
  "adapterUnmodeled": 0,
  "filteredOut": 5,
  "continuationStartedDelivered": 0,
  "finalKind": "hold",
  "finalHoldReasons": [
    "pending_prompt",
    "scheduled_continuation"
  ],
  "recordedConsultCount": 8,
  "recordedHoldReasons": [
    "pending_prompt"
  ]
}
stdout | src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts > OPPOR01 - source-bound replay of the incident session through the REAL Elm authority seams > OPPOR01-CF: supplying the source-backed continuation_started(promptId, runId) removes the pending_prompt hold
OPPOR01-COUNTERFACTUAL-REPORT {
  "adapterStatus": "DIRECT",
  "adapterReason": "mapped to continuation_started",
  "elmMsg": {
    "tag": "continuation_started",
    "promptId": "pending_1794841243556_-tSbr",
    "runId": "run_rCw8nsup"
  },
  "finalKind": "authorize",
  "finalHoldReasons": []
}
 ✓ src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts (5 tests) 317ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  19:22:49
   Duration  2.27s (transform 1.28s, setup 1.87s, import 31ms, tests 317ms, environment 0ms)
```

**Gate 2 result: PASS** — the actual kernel decision is `hold` / `pending_prompt`
on the recorded sequence and `authorize` with the source-backed correlation.

---

## GATE 3 — RED witness

`OPPOR01-REPLAY` asserts the reproduced contract failure:

```ts
expect(decision.kind).toBe("hold")
expect(holdReasons).toContain("pending_prompt")
expect(report.continuationStartedDelivered).toBe(0)
expect(report.recordedHoldReasons).toContain("pending_prompt")
```

The witness **PASSES against the unmodified production code** and **would FAIL
once the defect is repaired** — which is the required shape for a RED
witness that must live in the default suite.

**Gate 3 result: PASS.**

---

## GATE 4 — Necessity / ablation (A1/A2/A3)

`OPPOR01-NECESSITY` (verbatim result: 5/5 files pass).

| Arm | Expected | Observed |
|---|---|---|
| A3-1 baseline | `hold` + `pending_prompt` | as expected |
| A3-2 with correlation | `authorize` | as expected |
| A3-3 removed again | `hold` + `pending_prompt` | as expected |
| A3-4 half-removed | `hold` + `pending_prompt` | as expected |

**Gate 4 result: PASS.**

---

## GATE 5 — Adversarial conservation (A4)

`OPPOR01-ADVERSARIAL` — 8 arms, all as expected:

| Arm | Assertion |
|---|---|
| A4-0 control | `authorize` (non-vacuous) |
| A4-1 queued prompt | `hold` + `pending_prompt` |
| A4-2 scheduled not started | `hold` + `scheduled_continuation` |
| A4-3 still running | `hold` + `scheduled_continuation` |
| A4-4 foreign prompt id | `hold` + `pending_prompt` |
| A4-5 stale/foreign run id | `hold` + `pending_prompt` |
| A4-6 unresolved background job | `hold` + `unconsumed_terminal_observation` |
| A4-7 unconsumed terminal observation | `hold` + `unconsumed_terminal_observation` |

**Gate 5 result: PASS.**

---

## GATE 6 — Existing focused tests (no ACT-owned regression)

**Command**

```
$ cd apps/vscode && bun x vitest run --config vitest.config.ts \
    src/sdk/__tests__/completion-authority-elm-historical-replay01.test.ts \
    src/sdk/__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts \
    src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts \
    src/sdk/__tests__/post-terminal-lifecycle-liveness01.corr01-real-elm.test.ts \
    src/sdk/__tests__/completion-authority-elm-authority-counter-dump01.test.ts
```

**Output**

```
 ✓ src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts (12 tests) 6ms
 ✓ src/sdk/__tests__/completion-authority-elm-historical-replay01.test.ts (20 tests) 90ms
 ✓ src/sdk/__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts (3 tests) 20ms
 ✓ src/sdk/__tests__/post-terminal-lifecycle-liveness01.corr01-real-elm.test.ts (5 tests) 211ms
 ⯯ src/sdk/__tests__/completion-authority-elm-authority-counter-dump01.test.ts (1 test | 1 failed) 5ms

 Test Files  1 failed | 4 passed (5)
      Tests  1 failed | 44 passed (45)
```

**The single failure is a PRE-EXISTING BASELINE diagnostic, preserved by
identity, NOT ACT-owned:**

```
FAIL src/sdk/__tests__/completion-authority-elm-authority-counter-dump01.test.ts
  > ELAUTHORITY01.A: registry.ts exposes DumpCompletionAuthorityElmAuthority command id
AssertionError: expected '// ClineMM fork: keep the canonical "…' to match
/DumpCompletionAuthorityElmAuthority\s*:\s*prefix\s*\+/
```

Neither `src/sdk/__tests__/completion-authority-elm-authority-counter-dump01.test.ts`
nor `src/registry.ts` is modified by this ACT (`git status` confirms both are
unmodified). The failure is a regex/format mismatch against a fork comment
block that precedes the command declaration — unrelated to the Elm
pending-prompt hold.

**Independent existing witness — the pre-existing PPLC-08 NECESSITY ablation:**

```
$ cd apps/vscode && bun x vitest run --config vitest.config.c2-4-c-bridge.ts \
    src/sdk/__tests__/pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts
 ✓ src/sdk/__tests__/pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts (8 tests) 789ms
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

PPLC-08 proves, against the REAL `LocalRuntimeHost` + REAL canonical
subscription + REAL Elm kernel, that withholding the canonical subscription
(i.e. the `continuation_started` producer) **returns** the `pending_prompt`
hold. It independently corroborates OPPOR01's causal claim.

**Gate 6 result: PASS** (1 pre-existing baseline failure preserved by identity).

---

## GATE 7 — Typecheck

```
$ cd apps/vscode && bun x tsc --noEmit 2>&1 | grep -c 'oppor01'
0
```

**Zero ACT-owned diagnostics.**

**Gate 7 result: PASS.**

---

## GATE 8 — Repository hygiene

```
$ git status --porcelain=v1 --untracked-files=all
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/00-identity-and-source-parity.md
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/01-production-correlation-map.md
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/02-source-bound-replay.md
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/03-red-reproduction.md
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/04-causal-discriminator.md
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/05-necessity-ablation.md
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/06-executable-receipts.md
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/07-decision.md
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/SHA256SUMS.txt
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/fixtures/barrier-timeline.session.jsonl
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/fixtures/completion-authority.session.jsonl
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/fixtures/continuation-events.session.jsonl
?? apps/vscode/src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts
```

Every entry is ACT-owned. **No unrelated file is changed. No production file is
changed. The protected stash and all worktrees are untouched.**

**Gate 8 result: PASS.**

---

## Artifact binding

| Artifact | Path | Bytes | SHA-256 |
|---|---|---|---|
| reproduction witness | `apps/vscode/src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts` | see SHA256SUMS.txt | see SHA256SUMS.txt |
| reduced CCARD fixture | `.factory/evidence/.../fixtures/continuation-events.session.jsonl` | 11239 | `32a33731f3e7539b086617c8e48729e8114fa898d06343028c2bc40bed9d03eb` |
| reduced authority fixture | `.factory/evidence/.../fixtures/completion-authority.session.jsonl` | 4184 | `a4762d4d775c38b5f6c68254ae81cfb60c572a8d53c9965c55adc76ba3fa4d0d` |
| reduced barrier fixture | `.factory/evidence/.../fixtures/barrier-timeline.session.jsonl` | 18191 | `a433a979fa100aec0c5bcf9a37925246affb7c53c00c92fcebe5158975270e71` |
| Elm kernel (read-only) | `apps/vscode/elm/completion-authority/vendor/completion-authority.js` | 107835 | `15c61e20468c36ac7bc3caed840c1012f5c5accbb0bcb96e0c748a00ad8d4f4c` |

The complete, machine-checkable list is `SHA256SUMS.txt`.
