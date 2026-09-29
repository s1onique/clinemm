# 01 — RED reproduction (typed tool-call discriminator)

## Baseline tests (live HEAD `766f47ff6`, before any repair)

```text
src/sdk/__tests__/myc-prime-automation.tool-call-discriminator01.red.test.ts

APMCP-07  McpError(code=RequestTimeout)         → expected tool_timeout        ✗ (received client_request_failed)
APMCP-08  McpError(code=MethodNotFound)         → expected method_not_found    ✗ (received client_request_failed)
APMCP-09  response.isError=true                  → expected tool_returned_error ✗ (received ??? — current code goes to result_parse branch)
APMCP-10  generic Error throw                    → expected unknown_client_error ✗ (received client_request_failed)
APMCP-11  GREEN regression (happy path)          → PASS
APMCP-12  diagnostic OFF                         → PASS

2 pass, 4 fail
```

## RED analysis

The current `runMycPrimeOnSessionStart` catch block in `myc-prime-automation.ts:299-344` collapses every `client.request` throw into a single `failureClass=client_request_failed`, regardless of whether the SDK error is:

1. a typed `McpError` with `code: ErrorCode.RequestTimeout` (timeout),
2. a typed `McpError` with `code: ErrorCode.MethodNotFound` (tool missing),
3. a typed `McpError` with any other code (transport, internal, parse),
4. a non-typed `Error` (e.g. transport pipe glitch).

Additionally, `response.isError === true` is currently NOT inspected — the helper routes through the result-parse branch which classifies it as `result_parse + non_text_response` (or similar), NOT as `tool_call + tool_returned_error`.

This is the **structural discrimination gap** identified in ACT §6/H6.

## RED fixes the diagnostic must apply

In `myc-prime-automation.ts`, the catch block (and a new isError guard BEFORE the result-parse branch) must inspect:

```ts
error instanceof McpError
  → error.code === ErrorCode.RequestTimeout → "tool_timeout"
  → error.code === ErrorCode.MethodNotFound → "method_not_found"
  → else                                     → "unknown_client_error"
response?.isError === true                  → "tool_returned_error"
otherwise                                  → "unknown_client_error"
```

## RED tests pass iff the discriminator is expanded

Without any production change, APMCP-07..APMCP-10 fail (4/4 RED).
With the discriminator expansion (this ACT's repair), APMCP-07..APMCP-10 turn GREEN (6/6 PASS).

ABLATION: removing the discriminator expansion restores the 4 RED failures.