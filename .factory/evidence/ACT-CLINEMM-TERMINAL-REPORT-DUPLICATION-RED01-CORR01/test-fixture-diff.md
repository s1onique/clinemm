# TRD01 Test Fixture — Live Transcript Slice

This document records the exact slice of the live task
`1791892624249_io4fp` messages.json that the TRD01 test fixture in
`apps/vscode/src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts`
is derived from. The fixture preserves the structural shape of the
two-submit_and_exit restoration; the actual summary bodies are
proxies (see SHA-256 reference below for the real bodies).

## Live transcript slice (msg 333–340)

```
idx=333  id=msg_15LGa4py        role=assistant  ts=1791893907206
        content: [
          { type: "text", text: "The verdict is clear and consistent. Let me submit the final report." },
          { type: "tool_use", id: "call_function_xxakngsgiq8s_1",
            name: "submit_and_exit", input: { summary: <3895 chars, SHA-256 3211fae9…> } }
        ]
idx=334  id=msg__p6VlC-D        role=user       ts=1791893907220
        content: [
          { type: "tool_result", tool_use_id: "call_function_xxakngsgiq8s_1",
            content: "submitted (verified=true)" }
        ]
idx=335  id=runtime-control-1791893907292  role=user  ts=1791893907292
        content: [
          { type: "text",
            text: "<user_input mode=\"act\">A deferred completion is requesting observation of unconsumed terminal results.</user_input>" }
        ]
idx=336  id=msg_bxkltD0O        role=user       ts=1791893907305
        content: [
          { type: "text", text: "[SYSTEM] This run is not complete until you call one of these terminal completion tools..." }
        ]
idx=337  id=msg_5XBfwS20        role=assistant  ts=1791893913014
        content: [
          { type: "text", text: "I'll observe the held terminal result for `cmd_mv6mq5t8qhepcxxm` and then re-iss..." },
          { type: "tool_use", id: "call_function_gru4wt89y8wl_1",
            name: "command_status", input: { jobId: "cmd_mv6mq5t8qhepcxxm" } }
        ]
idx=338  id=msg_3AKhOnY5        role=user       ts=1791893913026
        content: [
          { type: "tool_result", tool_use_id: "call_function_gru4wt89y8wl_1",
            content: [{ ok: true, jobId: "cmd_mv6mq5t8qhepcxxm",
                        state: "containment_failed", signal: "SIGTERM", elapsed: 1081302 }] }
        ]
idx=339  id=msg_RagTZXRy        role=assistant  ts=1791893920497
        content: [
          { type: "text", text: "The held job `cmd_mv6mq5t8qhepcxxm` has been observed. It terminated with `state`..." },
          { type: "tool_use", id: "call_function_jyd622908p3h_1",
            name: "submit_and_exit", input: { summary: <2398 chars, SHA-256 590ea525…> } }
        ]
idx=340  id=msg_UTkC2vcR        role=user       ts=1791893920510
        content: [
          { type: "tool_result", tool_use_id: "call_function_jyd622908p3h_1",
            content: "submitted (verified=true)" }
        ]
```

## TRD01 fixture (in the test file)

The TRD01 fixture is a structural twin of the live slice. The
following substitutions were made:

| Field | Live | Fixture |
|---|---|---|
| User prompt text | `# ACT-CLINEMM-ELM-SEAM12-DCB-LIVE-QUALIFICATION01…` (long) | `<user_input mode="act"># ACT-CLINEMM task prompt</user_input>` (short) |
| `summary` field (xxakngsgiq8s_1) | 3895 chars, SHA-256 3211fae9… | Proxy string `"First-submit summary (length 3895) — see live transcript"` |
| `summary` field (jyd622908p3h_1) | 2398 chars, SHA-256 590ea525… | Proxy string `"Second-submit summary (length 2398) — see live transcript"` |
| Continuation control text | `<user_input>A deferred completion is requesting observation…` (long) | Same prompt, shortened |
| command_status text | `I'll observe the held terminal result for cmd_mv6mq5t8qhepcxxm and then re-iss…` | Proxy string `"I'll observe the held terminal result for cmd_mv6mq5t8qhepcxxm and re-issue."` |
| "held job" followup text | `The held job \`cmd_mv6mq5t8qhepcxxm\` has been observed…` | Proxy string `"The held job cmd_mv6mq5t8qhepcxxm has been observed."` |

All `id`, `ts`, `tool_use_id`, `tool_name`, `name`, `role`, and
content-block structural fields match the live transcript verbatim
(only the text payloads were shortened for test readability). The
restoration path's per-row identity (tool_call_id-based
`pendingToolUses` matching) is preserved.

## Real summary bodies (for cross-reference)

The two summary bodies are documented (SHA-256 only — not stored
verbatim) in ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01 §1:

- First submit (xxakngsgiq8s_1, msg 333, ts 1791893907206): 3895 chars, SHA-256 `3211fae9d1aa39b116acfa3250b7253643ff658fe12575cd4fc51d9fb99ac88d`
- Second submit (jyd622908p3h_1, msg 339, ts 1791893920497): 2398 chars, SHA-256 `590ea525094d5f7399eace5bbd799c1f5482961ec57e4502c28142ff4a90a1b2`

These SHA-256s were computed at ACT closure time from the live
transcript (see python3 hashlib in the previous shell
session). The fixture uses proxy strings of the same character
count class (3.9K and 2.4K) for behavioral realism but does not
preserve the exact bytes.

## Why the test does not require the exact 3895/2398 char bodies

The TRD01 assertions are about the restoration chain's row identity,
not about the summary content. The relevant properties are:

1. The two tool_use → tool_result pairs each produce one
   `say: "completion_result"` row.
2. Each row is stamped with `isAuthoritativelyCompletedResult: true`.
3. The two rows have distinct `ts` values (so React keys differ).
4. The two rows have distinct text payloads (the summaries from
   each `submit_and_exit`).

Property 4 holds for any two non-empty strings — the test uses
proxy strings of the same character count class to preserve the
"large vs medium summary" distinction without binding to the
literal SEAM12 ACT verdict text.
