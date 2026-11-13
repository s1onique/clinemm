# ACT-CLINEMM-FLINT-TOOLCALL-RED-01-CORRECTION01

**Decision:** C1: GO (bounded compatibility-contract completion)
**Repository:** `clinemm` (`s1onique/clinemm`)
**Branch:** `main` (no ACT branch created)
**Primary purpose:** Complete the existing `run_commands` compatibility adapter
**Predecessor:** `ACT-CLINEMM-FLINT-TOOLCALL-RED-01` (commit `0b6ec51af`)
**LIVE evidence source:** `1794593797996_r48lj.messages.json` (second Flint/Kapitsa session)
**Production repair:** ONE existing tool-scoped canonicalizer extended

---

## Terminal report

```
ACT:
ACT-CLINEMM-FLINT-TOOLCALL-RED-01-CORRECTION01

VERDICT:
LIVE_PARTIAL
```

The bounded repair is complete and GREEN at every gate, but the
**live behavioral qualification was NOT performed in this session** — see
[LIVE QUALIFICATION](#8-live-qualification) below for the precise remaining
limitation and why it was not closable here.

---

## 1. Entry state

| Item | Value |
|------|-------|
| Source HEAD at entry | `0b6ec51af57a13ab1d09a55eddde000d5b186e5f` |
| HEAD subject | `fix(run-commands): canonicalize the confirmed Flint JSON-array \`command\` payload (FLINT-TOOLCALL-RED-01)` |
| Working tree at entry | clean (no unstaged/staged changes) |
| Protected stash | `stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime)...` — **preserved, never popped by this ACT** |
| Extension version | `4.1.16-5a1c485cb` |
| Installed extension (pre-existing) | `s1onique.clinemm-4.1.16-5a1c485cb-0b6ec51af` (VSCodium) |

## 2. LIVE evidence (the second Flint session)

Session `1794593797996_r48lj.messages.json` — 45 messages, 12 `run_commands`
tool calls, model `flint:16gb`, provider `openai-compatible`. Every call was
classified by the tool result it actually received in the transcript.

| # | msgIdx | Argument shape | Live outcome |
|---|--------|----------------|--------------|
| 0 | 2 | `{"command":"ls -la <root>"}` | REJECTED |
| 1 | 5 | `{"commands":"ls -la <root>"}` | REJECTED |
| 2 | 8 | `{"commands":"ls -la <root>"}` | REJECTED |
| 3 | 11 | `{"commands":"ls -la <root>"}` | REJECTED |
| 4 | 14 | `{"commands":"ls -la <root>"}` | REJECTED |
| 5 | 16 | `{"commands":["ls -la <root>"]}` | **ACCEPTED** |
| 6 | 18 | `{"commands":"find <root> -maxdepth 2 …"}` | REJECTED |
| 7 | 21 | `{"commands":["ls -la <root>/roz-themes", …]}` | **ACCEPTED** |
| 8 | 21 | `{"command":"git -C <root> log --oneline -50"}` | REJECTED |
| 9 | 24 | `{"commands":["git -C <root> log --oneline -60", …]}` | **ACCEPTED** |
| 10 | 24 | `{"commands":["find <root> -maxdepth 2 …"]}` | **ACCEPTED** |
| 11 | 35 | `{"command":"[\"wc -l <root>/.gitlab-ci.yml\", \"grep -n …\"]"}` | **ACCEPTED** |

Aggregate — **matches the reported live classification exactly**:

| Argument shape | Calls | Passed | Rejected |
|----------------|-------|--------|----------|
| `{"commands":[...]}` | 4 | 4 | 0 |
| `{"command":"[\"...\"]"}` | 1 | 1 | 0 |
| `{"commands":"shell text"}` | 5 | 0 | 5 |
| `{"command":"shell text"}` | 2 | 0 | 2 |
| **Total** | **12** | **5** | **7** |

### 2.1 Live error texts (verbatim)

`{"commands": "<shell text>"}`:

```
Invalid input for tool run_commands: ✖ Invalid input: expected array, received string
  → at commands
```

`{"command": "<shell text>"}`:

```
Invalid input for tool run_commands: ✖ Unrecognized key: "command"
✖ Invalid input: expected array, received undefined
  → at commands
```

### 2.2 Two facts this session establishes

1. **The predecessor repair IS active in the installed artifact.** Call #11 is
   the predecessor's exact target shape (`{"command":"[\"…\",\"…\"]"}`) and it
   was **ACCEPTED** and executed BOTH commands. That is direct behavioral
   proof — stronger than the unchanged version string — that the
   `FLINT-TOOLCALL-RED-01` canonicalizer is live in
   `s1onique.clinemm-4.1.16-5a1c485cb-0b6ec51af`.
2. **The defect is NOT long-context-only.** The first rejection is at
   message index 2 — the very beginning of the session. Flint's argument
   formatting is inconsistent from the start; the previously repaired
   representation succeeds at 28,512 input tokens while the first failure
   occurs at 3,742 input tokens.


## 3. RECON — the causal boundary

Inspected seams (no second normalization seam introduced):

| Seam | File | Behavior on the 7 rejected shapes |
|------|------|----------------------------------|
| Generic pre-validation normalization | `sdk/packages/shared/src/parse/json.ts` `normalizeJsonLikeStringsForSchema` | Rewrites only values of **DECLARED** properties. `commands` IS declared but its element type is an array, so a bare string is not "JSON-like" and is left unchanged. `command` is NOT declared at all (`additionalProperties: false`), so it is untouched. **Both shapes survive unchanged.** |
| Strict schema | `sdk/packages/core/src/extensions/tools/schemas.ts` `RunCommandsInputSchema` | `commands` must be `array(CommandInputSchema)`, `min(1)`; `.strict()`. Rejects both shapes. |
| Permissive union | `RunCommandsInputUnionSchema` | Has a `{ command: string }` arm — **without a pre-validation canonicalizer the captured payload would normalize to the single shell command `["…"]`, i.e. the serialized JSON text executed as shell code.** This is why the canonicalizer must run BEFORE validation. |
| Tool-scoped canonicalizer (the EXISTING one) | `sdk/packages/core/src/extensions/tools/helpers.ts` `normalizeRunCommandsToolInput` | The seam to extend. Deliberately narrow: accepted exactly ONE shape (`{"command":"<JSON array string>"}`). |
| Canonicalizer wiring | `sdk/packages/shared/src/tools/create.ts` → `sdk/packages/agents/src/agent-runtime.ts` | `tool.normalizeInput` runs AFTER the generic normalization and BEFORE `validateInput`; a throw is treated as a validation failure (no approval, no executor). |
| Executor | `sdk/packages/core/src/extensions/tools/definitions.ts` `createShellTool` | Calls `normalizeRunCommandsInput(input)` — the permissive union — so it MUST receive the already-canonical `{commands:[…]}`. |

**Conclusion:** the existing canonicalizer IS the correct and only seam.
`normalizeRunCommandsInput` (the permissive union) is NOT a suitable seam —
it runs at the EXECUTOR boundary, i.e. AFTER validation and AFTER approval,
so a canonicalization there would leave the approval card and the
authorization binding bound to the raw malformed input.


## 4. RED — the seven rejected live calls replayed

`sdk/packages/core/src/extensions/tools/flint-toolcall-red01-correction01.test.ts`

The seven live-rejected calls are replayed **VERBATIM** through the REAL
production path:

* the REAL `createShellTool` factory,
* the REAL strict `RunCommandsInputSchema`,
* the REAL generic pre-validation normalization,
* the REAL bounded canonicalizer,
* `createTool`'s auto-generated `validateInput`,
* the REAL `AgentRuntime` dispatch path, including the approval round-trip.

The shell executor is a **RECORDING** executor: it captures the canonicalized
command list and returns a canned result, so **no shell command is ever
executed** and "zero process starts" is directly observable from the recorded
list.

RED result (before the repair) — see `evidence/red-reproduction-correction01.txt`:

```
Test Files  1 failed (1)
     Tests  5 failed | 30 passed (35)
```

The 5 failures are exactly the new-shape GREEN cases (GREEN1–GREEN4) plus
the approval/executor alignment invariant that depends on them. All 26
rejection cases and all 3 preserved-shape cases were GREEN before the
repair, proving the RED is specific and not a blanket failure.

## 5. BOUNDED REPAIR

Extended the **EXISTING** `normalizeRunCommandsToolInput` in
`sdk/packages/core/src/extensions/tools/helpers.ts`. No new seam, no new
file, no architectural change.

### 5.1 Accepted contract (exactly three shapes)

| Input | Canonical output |
|-------|------------------|
| `{"commands":["shell text"]}` | unchanged (already canonical) |
| `{"command":"[\"shell text\"]"}` | `{"commands":["shell text"]}` (predecessor behavior, **unchanged**) |
| `{"commands":"shell text"}` | `{"commands":["shell text"]}` (NEW) |
| `{"command":"shell text"}` | `{"commands":["shell text"]}` (NEW) |

### 5.2 Strictness rules

* The accepted key must be the **SOLE** key of the input object. Any
  conflicting/unknown sibling (`{command, commands}`, `{command, timeout}`,
  `{commands, notifyOnCompletion}`, …) is **rejected** — ambiguous input is
  never guessed at.
* Only `command` and `commands` are accepted keys. **No generic key
  guessing** (the broader upstream Cline proposal is deliberately NOT
  adopted).
* The value must be a string.

### 5.3 Files changed

| File | Change |
|------|--------|
| `sdk/packages/core/src/extensions/tools/helpers.ts` | The existing canonicalizer extended (doc comment + body). |
| `sdk/packages/core/src/extensions/tools/flint-toolcall-red01-correction01.test.ts` | **NEW** — 35 tests: RED reproduction, GREEN contract, rejection matrix, security invariants. |
| `sdk/packages/core/src/extensions/tools/flint-toolcall-red01.test.ts` | The one stale rejection case updated to the corrected, evidence-backed contract (see 5.4). |

### 5.4 The one stale case in the predecessor suite

The predecessor suite asserted:

```
REJECTS_BARE_COMMAND_STRING_IS_NOT_REINTERPRETED   { command: "echo hello" }
```

That case **is** one of the two shapes the new live evidence proves must be
accepted (2 of the 12 live calls used it; both were rejected). Leaving it
would make the two suites contradict each other. It was replaced by an
explicit positive test
(`BARE_COMMAND_STRING_IS_NOW_ACCEPTED_AS_A_SINGLE_COMMAND`) that documents
the change and its evidence. **No other case was touched** — the remaining
14 rejection cases of the predecessor suite are unchanged and still GREEN.

## 6. SECURITY invariants verified

| Invariant | How verified |
|-----------|--------------|
| Canonicalize BEFORE validation and authorization | `normalizeInput` is invoked by `AgentRuntime` after the generic normalization and before `validateInput`; the canonical array is therefore what the schema validates, what the approval card previews, what `buildCommandExecutionPlan` is built from, and what the executor runs. |
| Approval preview and executor use IDENTICAL commands | `APPROVAL_PREVIEW_MATCHES_EXECUTOR_COMMANDS_EXACTLY` — for each accepted shape, the approved `commands` array is asserted **equal** to the recorded executor commands. |
| Forged / mismatched authority → zero starts | Conflicting-key shapes (`{command, commands}`) are rejected; rejection ⇒ zero approvals AND zero executor invocations. |
| Rejected inputs → zero approvals and zero starts | All 26 rejection cases assert `executed.length === 0` **and** `approvals.length === 0` **and** `failureClass === "tool_input_invalid"`. |
| Serialized JSON is NEVER executed as shell text | `NEVER_EXECUTES_SERIALIZED_JSON_AS_SHELL_CODE` — the executed command must not equal the serialized payload and must not start with `[`. The JSON-object guard prevents the analogous object-text case. |
| `notifyOnCompletion` preserved for canonical calls | `GREEN7_NOTIFY_ON_COMPLETION_IS_PRESERVED_FOR_CANONICAL_CALLS`. |
| Per-command execution-plan correlation preserved | The canonicalizer preserves command ORDER and COUNT (verified by GREEN2/GREEN4 fanning out to the exact recorded command list), which is what `buildCommandExecutionPlan`'s cardinality check correlates. |

* Empty / whitespace-only values are **rejected** (a blank is not a command).
* A value starting with `[` is treated as a JSON-array candidate:
  malformed JSON, a non-array, an empty array, or any non-string member is
  **rejected**.
* A value starting with `{` is **rejected** — a serialized JSON object is
  never executed as shell text.
* Any other string is interpreted as **exactly ONE** complete shell command
  — never split on whitespace or newlines.
* The resulting command list is validated against the canonical
  `commands` element schema **BEFORE** canonicalization, so an invalid
  command can never reach validation, approval, or execution.
* `notifyOnCompletion` is deliberately **not** carried over by the
  compatibility shapes: those shapes have the command key as their only
  key, so a sibling flag is ambiguous input and is rejected.
