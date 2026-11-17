# ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01 — LIVE QUALIFICATION (PENDING OPERATOR ACTION)

**Status: NOT EXECUTED / PENDING.** No LIVE claim is made by this ACT.
No VSIX installation was performed.

The steps below EXTEND the predecessor's procedure in
`.factory/evidence/ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01/06-live-qualification.md`.
Steps 1–5 of that procedure are unchanged; steps 6–9 here are NEW and
exercise the corrected event-session isolation.

---

## 0. Operator qualifications carried forward from the review

Two details in the live instructions need attention:

1. **The `code --install-extension` command targets the `code` CLI**, not
   necessarily the dedicated `codium-clinemm` installation. VS Code's CLI
   explicitly installs into the selected editor's extensions environment.
   Use the CLI that belongs to the **actual profile** being qualified.

2. **The default `~/.cline/data/control-seam` is NOT the established
   dogfood location.** The dogfood path is
   **`~/.vscodium-clinemm/cline-data/control-seam`**. Use the actual
   profile's path, without exposing either credential.

The invalid Leamas gate-summary binding is **P2, non-blocking**; the
targeted source evidence remains useful.

---

## 1. Build from the exact implementation HEAD

```bash
cd <repo>
git rev-parse HEAD                     # record the exact HEAD
cd apps/vscode
bun run build:webview
bun esbuild.mjs                        # extension bundle -> dist/extension.js
```

The bundle must contain the corrected markers. Verify by grepping the
built artifact for the load-bearing strings:

```bash
grep -c 'sessionId' dist/extension.js          # the session-scoped read
```

Record the bundle SHA256 in the evidence.

## 2. Install into the ACTUAL profile's editor

Use the CLI of the editor the operator actually uses for the dogfood
profile (the dedicated `codium-clinemm` installation), and verify the
installation landed in THAT profile's extension directory — not the
default `code` profile's.

## 3. Enable the seam and the mutation grant

Both records live under the ACTUAL profile's control-seam directory
(`~/.vscodium-clinemm/cline-data/control-seam` for the dogfood profile):

```text
<control-seam-dir>/opt-in.json        { "enabled": true }
<control-seam-dir>/mutation.json      { "v": 1, "enabled": true, "allowContentRead": true }
```

`allowContentRead: true` is REQUIRED for the isolation test to be
meaningful — with it off, only metadata would be observable.

## 4. Start the editor with the dogfood workspace

## 5. Start the Codex MCP client against the seam

Use the predecessor's exact client invocation (the local stdio MCP
proxy over the AF_UNIX socket).

---

## 6. NEW — start the MCP-owned session

```text
clinemm_start_act {
  "requestId": "iso01-live-1",
  "prompt": "reply with the single word PONG",
  "expectedWorkspace": "<the actual installed workspace root>"
}
```

Record the returned `sessionId` — call it **B**.

## 7. NEW — publish a FOREIGN session's event and prove it is NOT readable

While the MCP-owned session B is running, start a SECOND, UI-owned task
in the editor (a different task/session — **A**), and let it emit at
least one message.

Then read B's events:

```text
clinemm_read_events { "sessionId": "B" }
```

**REQUIRED OUTCOME:** the returned `events` array contains **NO** event
produced by session A — neither A's `text` nor A's `cursor` / `epoch` /
`type` / `kind` / `ts` metadata.

**FAIL SIGNAL (the leak):** the response contains any event whose text
is A's message text, or any additional event beyond B's own.

## 8. NEW — a LATER foreign session is also excluded

After step 7, start a THIRD task in the editor (**C**) and let it emit a
message. Read B's events again.

**REQUIRED OUTCOME:** still only B's own events. C's text and metadata
are absent.

## 9. NEW — the content-read grant OFF path

Set `allowContentRead: false` in the mutation record, restart the
extension host, and repeat steps 6–8.

**REQUIRED OUTCOME:** the foreign session's **metadata** is absent too —
not just its text. This is the ISO-3 case: with the pre-correction
code, the foreign event's `cursor` / `epoch` / `type` / `kind` / `ts`
leaked even with the grant off.

## 10. NEW — cursor continuity across a task/epoch transition

Within B's own session, read events, note the `cursor`, then let B
advance (a follow-up turn, which bumps the epoch) and read again with
`afterCursor`.

**REQUIRED OUTCOME:** the second read resumes exactly after the first
cursor and returns only B's newer events. `cursorExpired` must be
`false` — a foreign session's events must not cause a false expiry.

---

## PASS / FAIL SUMMARY

| Step | Check | PASS condition |
|---|---|---|
| 7 | foreign session A excluded | no A text, no A metadata |
| 8 | later foreign session C excluded | no C text, no C metadata |
| 9 | content-read OFF | no foreign metadata either |
| 10 | cursor continuity | resumes exactly; `cursorExpired: false` |

**Any FAIL in steps 7–10 is a `HALT_EVENT_SESSION_ISOLATION` for the
live pilot.**
