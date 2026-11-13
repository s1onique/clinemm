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

### WITNESS CORRECTION (this revision)

A review found that this report's "replayed **VERBATIM**" claim was
**false**: two of the replayed fixtures had been re-transcribed by hand
rather than copied from the live transcript, and had drifted. The drift
was invisible to the behavioural suite because the drifted payloads still
exercised the same argument *shape*.

**The production repair was never in question** — `helpers.ts` is unchanged
by this correction. What changed:

* the drifted fixtures were regenerated programmatically from the live
  transcript;
* a **machine-checkable witness verifier** was added that reads the live
  transcript and asserts byte-equality of every fixture (it is proven to
  catch the exact drift via a negative control);
* the "VERBATIM" prose claims were corrected.

See [section 4a](#4a-witness-correction--the-exact-replay-claim-was-false)
and `evidence/witness-correction01.txt`. **Zero regressions** were
introduced: the `@cline/core` and `apps/vscode` failing-file sets are
unchanged from the pre-correction baseline.

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

The seven live-rejected calls are replayed through the REAL
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

## 4a. WITNESS CORRECTION — the exact-replay claim was FALSE

> **Status: CORRECTED.** This section records a defect in the ORIGINAL
> revision of this report and in the test fixtures it claimed to be backed by.
> The **production repair was never in question** — only the fidelity of the
> replayed witnesses.

### 4a.1 The defect

This report originally claimed that the seven live-rejected calls are
replayed **VERBATIM** from the transcript. A review compared the committed
fixtures against the live transcript `1794593797996_r48lj.messages.json`
(byte for byte) and found that two fixtures had been **re-transcribed by
hand instead of copied**, and had drifted:

| Fixture | Live message | Defect |
|---------|---------------|--------|
| `LIVE_REJECTED_COMMANDS_KEYED[4]` (the `find` call) | index 18 | Lost four `-not -path` clauses (`pg-index-diff`, `act-fm233-build-roz-p5-discriminator01`, `.helm`, `.kube`, `.vscode`, `act-fm233-build-roz-p5-discriminator01`) **and** its `\| sort \| head -300` tail. It had been replaced by an unrelated `-not -path '*/node_modules*' -type d \| head -40` command. |
| `LIVE_ACCEPTED_COMMAND_JSON_ARRAY` | index 35 | Lost its `\| head -150` tail **and** had single-backslash regex escapes where the live payload has double-backslash escapes. |

The five `ls -la` fixtures and the two `command`-keyed fixtures were
byte-exact.

### 4a.1a The transcript exists in two copies — and both agree

| Copy | sha256 | messages | `run_commands` calls | `updated_at` |
|------|--------|----------|----------------------|--------------|
| `~/Downloads/1794593797996_r48lj.messages.json` (the copy the review compared against) | `a5c6d5e8…1ace` | 45 | 12 | `18:18:06.266Z` |
| `~/.vscodium-roz/cline-data/sessions/1794593797996_r48lj/…messages.json` (live profile) | `0e6c6474…2005` | 58 | 17 | `18:18:43.387Z` |

The Downloads copy's 45 messages are an **exact prefix** of the profile
copy's 58 messages (element-wise JSON equality); same `sessionId`, same
`origin.version` `4.1.16-5a1c485cb`. The profile copy is the **same
session continued** 37 seconds later.

Every witness payload is **byte-identical in both copies** — in particular
message index 18 (the `find` call) and message index 35 (the accepted JSON
array). The five extra calls in the profile copy occur at message indices
48/51/57, i.e. *after* the witness set closes. The witness verifier passes
against **both** copies (4/4 each).


### 4a.2 Why the behavioural suite stayed GREEN

The drifted fixtures exercised the same *argument shape* (`{"commands":
"<shell text>"}` and `{"command": "<JSON array string>"}`), so every
behavioural assertion still passed. The drift was therefore **invisible to
the behavioural suite** — which is precisely why the "VERBATIM" prose claim
carried the entire evidentiary weight and why that claim needed an
independent check.

### 4a.3 The fix

1. **The fixtures were regenerated programmatically from the live
   transcript**, not re-typed. The committed source is
   `sdk/packages/core/src/extensions/tools/flint-toolcall-red01-witness-fixtures.ts`,
   a dedicated module (not a `.test.ts`) so that the regression suite and
   the new verifier consume ONE single source of truth. Importing a
   `.test.ts` from another test file would re-register its `describe`/`it`
   blocks in the importing suite.
2. **A new machine-checkable witness verifier was added**:
   `sdk/packages/core/src/extensions/tools/flint-toolcall-red01-witness.test.ts`.
   It reads the LIVE transcript from disk and asserts **byte-equality**
   between every fixture constant and the corresponding live
   `tool_use.input` payload. A drifted fixture now fails loudly, naming the
   message index and the expected live payload.
3. **The prose claims were corrected.** "VERBATIM" was removed from this
   report and from the test file's header comment; the accurate statement is
   that the fixtures are *verified byte-equal against the live transcript by
   the witness verifier*.

### 4a.4 Portability of the verifier

The transcript is a local artifact of a live session and is **not
committed** (it lives in the user's VSCodium profile and embeds absolute
paths from the original machine). The verifier therefore:

* resolves the transcript via `CLINE_FLINT_WITNESS_TRANSCRIPT`, else
  `~/.vscodium-<profile>/cline-data/sessions/1794593797996_r48lj/`;
* **SKIPS** when the transcript is absent, so the committed suite stays
  green on CI and on any other machine;
* **FAILS** when the transcript IS present and a fixture has drifted.

On the machine that produced the live evidence the transcript IS present,
so the gate is live.

### 4a.5 Negative control — the verifier is proven to catch drift

Re-injecting the exact `find` drift described in 4a.1 into the fixture
module produces:

```
 × THE_REJECTED_CALLS_KEYED_BY_COMMANDS_MATCH_THE_LIVE_PAYLOADS_BYTE_FOR_BYTE
AssertionError: fixture 4 (live msgIdx 18) must equal the live payload byte for byte
```

while the behavioural suite remains GREEN — confirming both that the
verifier is a real gate and that the behavioural suite alone was
insufficient. The drift was reverted immediately afterwards.

### 4a.6 Scope

**No production code was changed by this correction.** The bounded repair
in `helpers.ts` (`normalizeRunCommandsToolInput`) is unchanged; the
correction is confined to the test fixtures, the new verifier, and this
report.


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

## 7. GATES

| Gate | Result | Evidence |
|------|--------|----------|
| **Live witness fidelity (this revision)** | **GREEN** — every replayed fixture is asserted **byte-equal** to the live transcript's `tool_use.input`. 4/4 in the new verifier; proven to catch the exact drift via a negative control | `evidence/witness-correction01.txt` §4–§5 |
| **Zero regressions from the witness correction (this revision)** | **GREEN** — `@cline/core` failing-file set IDENTICAL to the pre-correction baseline (19 files / 113 tests before AND after); `apps/vscode` failing-file set has **no new** entries (63 → 62; the one delta is a pre-existing flaky that passes 11/11 in isolation) | `evidence/witness-correction01.txt` §5 |
| **No production code changed by the witness correction (this revision)** | **CONFIRMED** — `helpers.ts` byte-unchanged; `git diff --name-only` contains no non-test, non-docs path | `evidence/witness-correction01.txt` §5 |
| New exact-shape RED → GREEN | **GREEN** — 35/35 in the new suite; RED was 5 failed / 30 passed | `evidence/red-reproduction-correction01.txt`, `evidence/verification-correction01.txt` |
| Existing 20 tests remain green | **GREEN** — `flint-toolcall-red01.test.ts` 20/20 | `evidence/verification-correction01.txt` |
| Focused SDK typecheck | **NO ACT-OWNED DIAGNOSTICS** — `@cline/core` reports 40 errors before AND after (identical pre-existing baseline); **0** in ACT-owned files | `evidence/verification-correction01.txt` |
| Authorization regression | **NO REGRESSION** — `apps/vscode/src/sdk/__tests__` is BYTE-IDENTICAL to the pre-change baseline (53 failed files / 124 failed tests, both before and after) | `evidence/baseline-comparison.txt` |
| No ACT-owned diagnostics | **CONFIRMED** — 0 typecheck errors and 0 biome lint errors in the three ACT-owned files | `evidence/verification-correction01.txt` |
| Do not reopen known baseline failures | **RESPECTED** — no pre-existing failing test was modified; the only pre-existing test touched is the one whose assertion the new live evidence directly contradicts (5.4), and it was replaced with an equivalent-strength positive test | `evidence/baseline-comparison.txt` |
| `git diff --check HEAD` | CLEAN | — |
| biome `lint --diagnostic-level=error` | EXIT 0, 3 files checked | — |
| biome `format` | clean, no changes required | — |
| `@cline/agents` full suite | 578/578 pass | — |
| `@cline/shared` full suite | 559/559 pass (6 skipped) | — |
| `@cline/core` full suite | failing-file set IDENTICAL to baseline (19 files, all pre-existing), **+35 newly passing** | `evidence/baseline-comparison.txt` |

### 7.1 Baseline-comparison method

The three ACT-owned files were stashed with
`git stash push -u -- <the three files>`, the SAME suites were re-run at the
pristine HEAD `0b6ec51af`, and the stash was popped. The **protected
`stash@{0}` was never popped by this ACT** and remains intact:

```
stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime):
           separate REARM lifetime from STALL lifetime at BCB re-registration
```

One nuance worth recording: the baseline full-suite run showed one **extra**
failing file (`src/tasks/agenda-task-manager.test.ts`) that the post-change
run did not. That file PASSES in isolation (21/21, verified three times) and
touches nothing in the `run_commands` path — it is a **flaky pre-existing**
failure, not a regression. This ACT therefore introduces **zero** new
failures.

## 8. LIVE QUALIFICATION

**Status: NOT PERFORMED in this ACT.**

The live Flint/Kapitsa harness is an **external, operator-driven** setup: it
is not present in this repository (no `kapitsa` reference exists anywhere in
the tree), and the live qualification requires a model provider session
driven through the installed VSCodium extension. This ACT could therefore
package and install the artifact but could not itself drive the live model
session.

### 8.1 What IS verified about the installed artifact

The packaged VSIX was opened and the **minified bundle inside it** was
inspected for the new canonicalizer logic. The bundle contains the complete
corrected contract (function `MXf` in `extension/dist/extension.js`):

```js
function MXf(t){
  if(t===null||typeof t!=="object"||Array.isArray(t))return t;
  let e=t,r=Object.keys(e);
  if(r.length!==1)return t;                       // sole key required
  let n=r[0];
  if(n!=="command"&&n!=="commands")return t;       // NO generic key guessing
  let a=e[n];
  if(typeof a!=="string")return t;
  let o=a.trim();
  if(o.length===0)return t;                       // empty/whitespace rejected
  if(o.startsWith("[")){                           // JSON-array decode (unchanged)
    let s;try{s=JSON.parse(o)}catch{return t}
    if(!Array.isArray(s)||s.length===0||!s.every(c=>typeof c==="string"))return t;
    let u=Kur.shape.commands.safeParse(s);
    return u.success?{commands:u.data}:t
  }
  if(o.startsWith("{"))return t;                  // NEW: JSON object guard
  let i=Kur.shape.commands.safeParse([a]);         // NEW: one-element command list
  return i.success?{commands:i.data}:t
}
```

This is artifact-level proof that the repair is present in the **installed
bundle**, not merely in `package.json`.

### 8.2 Precise remaining limitation

## 9. PACKAGE

| Item | Value |
|------|-------|
| Source HEAD (exact) | `feffc821b76a1053e216f468bbd3c235dc57e1a6` |
| Commit subject | `fix(run-commands): accept the two remaining Flint single-string argument shapes (FLINT-TOOLCALL-RED-01-CORRECTION01)` |
| Extension version | `4.1.16-5a1c485cb` (unchanged — this ACT changes no versioning input) |
| VSIX path | `dist/clinemm-4.1.16-flint-red01-corr01-feffc821b.vsix` |
| VSIX bytes | `66154598` |
| VSIX SHA-256 | `421e46dac263435debe1041b1197c03b03bdeae4f964e42667ce687b0bb77f40` |
| Package command | `bunx --bun @vscode/vsce package --out ../../dist/clinemm-4.1.16-flint-red01-corr01-feffc821b.vsix --no-dependencies` (from `apps/vscode`, after `bun run build:webview` + `bun esbuild.mjs --production`) |
| Package contents | 681 files, 63.09 MB; `extension/dist/extension.js` = 28,019,414 bytes |
| Push / PR | **NONE** — no push, no PR created |
| Branch | `main` (no ACT branch created) |
| Unrelated work | **PRESERVED** — `.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md` was modified by a test run (timestamp regeneration) and was deliberately **NOT** committed |
| Protected stash | `stash@{0}` intact and untouched |

### 9.1 Installed-artifact verification (not just `package.json`)

The VSIX was extracted to the VSIX `extension/` layout and the **shipped
minified bundle** was inspected. All six contract elements are present in
`extension/dist/extension.js`:

```
  OK   sole-key guard
  OK   no generic key guessing
  OK   empty rejected
  OK   JSON array decode (predecessor)
  OK   JSON object guard (new)
  OK   plain string -> 1-elem array (new)
INSTALLED-ARTIFACT VERDICT: ALL PRESENT
```

The canonicalizer was then **executed** out of the shipped bundle against the
LIVE shapes plus the malformed-shape rejection matrix, with the strict
`RunCommandsInputSchema` semantics applied after canonicalization:

```
PASS  LIVE  #0  commands-string    expected=ACCEPT actual=ACCEPT
PASS  LIVE  #1  command-string     expected=ACCEPT actual=ACCEPT
PASS  LIVE  #11 command-jsonarray  expected=ACCEPT actual=ACCEPT
PASS  LIVE  #5  commands-array     expected=ACCEPT actual=ACCEPT
PASS  REJ   empty commands         expected=REJECT actual=REJECT
PASS  REJ   whitespace commands    expected=REJECT actual=REJECT
PASS  REJ   empty command          expected=REJECT actual=REJECT
PASS  REJ   conflict cmd+cmds      expected=REJECT actual=REJECT
PASS  REJ   unknown sibling        expected=REJECT actual=REJECT
PASS  REJ   json object            expected=REJECT actual=REJECT
PASS  REJ   malformed json         expected=REJECT actual=REJECT
PASS  REJ   empty json array       expected=REJECT actual=REJECT
PASS  REJ   non-string member      expected=REJECT actual=REJECT
PASS  REJ   null member            expected=REJECT actual=REJECT
PASS  REJ   commands null          expected=REJECT actual=REJECT
PASS  REJ   commands empty array   expected=REJECT actual=REJECT

PASS=16  FAIL=0
INSTALLED ARTIFACT END-TO-END: GREEN
```

See `evidence/installed-artifact-verification.txt`.

### 9.2 Installation into the live profile — BLOCKED BY THE ENVIRONMENT

The artifact could **not** be installed into the live VSCodium profile
(`~/.vscodium-cline/extensions`, `~/.vscodium-clinemm/extensions`) from
this session: the extensions directories are **not writable** in this
environment (`EPERM` on both `vsce --install-extension` and a direct
directory creation), and only `/tmp` is writable under the account.

The installation attempt was a **verified no-op** — nothing was damaged:

* `~/.vscodium-cline/extensions/.obsolete` — intact, unmodified
  (10,612 bytes, timestamp unchanged);
* `extensions.json` — unchanged, still resolving to
  `s1onique.clinemm 4.1.16-5a1c485cb-0b6ec51af`;
* the previously installed extension directory — untouched.

The operator must therefore perform the installation step (8.4). This is an
environment limitation, not a defect in the artifact.

## 10. CLOSURE

**`LIVE_PARTIAL`.**

* The bounded repair is **complete and GREEN at every gate**: RED → GREEN on
  the exact live shapes, the predecessor's 20 tests green, no new failures
  anywhere, no ACT-owned diagnostics, lint/format clean.
* The packaged artifact is built at the exact commit HEAD, its identity is
  recorded (bytes + SHA-256), and its **behavior was verified by executing
  the shipped bundle** — 16/16 including all four live shapes.
* The **live behavioral qualification is NOT done**: driving the read-only
  Keycloak investigation through Flint on the newly installed VSIX requires
  the external operator harness, and this environment additionally cannot
  write to the extension profile. The precise remaining limitation is stated
  in 8.2 and the operator steps in 8.4.

**No unrelated refactoring was performed. No extra review cycle was opened.**


The live behavioral qualification — driving the read-only Keycloak
investigation through Flint on the newly installed VSIX and observing
(i) tool-call shapes and acceptance counts, (ii) absence of schema errors,
(iii) actual execution of approved commands, and (iv) task completion —
**remains outstanding**. It requires the external operator harness.

### 8.3 Predicted live outcome (to be confirmed by the operator)

Given the repair, the 12 calls of the observed session would be expected to
resolve as:

| Shape | Calls | Before | After (expected) |
|-------|-------|--------|------------------|
| `{"commands":[...]}` | 4 | ACCEPTED | ACCEPTED (unchanged) |
| `{"command":"[\"...\"]"}` | 1 | ACCEPTED | ACCEPTED (unchanged) |
| `{"commands":"shell text"}` | 5 | REJECTED | **ACCEPTED** |
| `{"command":"shell text"}` | 2 | REJECTED | **ACCEPTED** |
| **Total** | **12** | **5 accepted / 7 rejected** | **12 accepted / 0 rejected** |

This is a **prediction**, not live evidence. The ACT is therefore closed
`LIVE_PARTIAL`, not `CLOSED_CLEAN`.

### 8.4 What the operator must do to close it

1. Install `dist/clinemm-4.1.16-flint-red01-corr01-feffc821b.vsix` into the
   VSCodium profile used by the Flint/Kapitsa harness.
2. Re-run the original **read-only** Keycloak investigation through Flint.
3. Export the session transcript and confirm: no `Invalid input for tool
   run_commands` results; the approved commands actually execute; the task
   completes.


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
