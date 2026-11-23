# 02 — The evidence authority

## What the reviewer found

Two defects.

**P0-2a — the success signal was too weak.** The canonical ledger treated a
tool result as successful whenever `block.is_error !== true`. That accepts a
result with NO affirmative success signal, and one whose structured payload
reports a failure without setting `is_error`.

**P0-2b — the source identity came from an ARGUMENT.** The source path was
extracted from the tool CALL's arguments without verifying that the tool
actually READ that path. A non-read tool with a path argument acquired source
authority, and only the FIRST path of a multi-file request was ever bound.

## The repair

**The success signal is now the PRODUCTION one.** The canonical ledger uses
`classifyToolResultStatus()` from `evidence-continuity.ts` — the same rule
the verified-outcome continuity already applies to the same canonical
history:

    is_error: true             -> failed,    not evidence
    payload success: false     -> failed,    not evidence
    payload isError: true      -> failed,    not evidence
    a payload with NO signal   -> UNKNOWN,   not evidence
    every payload success:true -> succeeded, evidence

"No evidence of failure" is not "evidence of success".

**The source identity now requires an OBSERVATION.** The extraction reads the
result payload's OWN attribution — the production `read_files` executor
persists one `{query, result, success}` payload per requested file, and
`query` is the file path — and only for source-observing tools:

    SOURCE_OBSERVING_TOOL_NAMES = { read_files }

A multi-file call binds EVERY path, and fails WHOLE if one file failed: a
read in which one file failed did not observe the set.

## The defect this repair exposed by execution

The evidence-handle trailer is a runtime-added text part appended to the tool
result the model reads. The production classifier read it as an operation
payload with no success signal, so EVERY successful result carrying a handle
classified as `unknown` — a false negative created by the annotation itself.

Fixed by excluding the runtime-added trailer from the operation-payload set.
The marker now has exactly ONE definition, in `evidence-continuity.ts`, and
`adjudication-continuity.ts` re-exports it.
