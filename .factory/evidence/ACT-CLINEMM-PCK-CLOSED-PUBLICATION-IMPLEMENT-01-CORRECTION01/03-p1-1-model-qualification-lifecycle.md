# 03 — P1-1: the real-model qualification lifecycle

```text
FINDING:      The qualification script bypassed the production generation
              lifecycle.
STATUS:       CORRECTED
MODEL:        MODEL_CLOSED_CONTRACT_SUPPORTED
```

## 3.1 — The defect

The predecessor script performed the provider request FIRST:

```ts
for await (const chunk of handler.createMessage(
    CHECKPOINT_SYSTEM_PROMPT,
    [{ role: "user", content: request }],
)) {
    // Collect response.
}
```

and only afterwards invoked `runPckAttempt()` with a generator that returned
the ALREADY-COLLECTED response:

```ts
generate: async () => ({ text: rawText, ... })
```

So the production attempt's deadline did NOT bound the actual network
request, and the production cancellation contract did NOT govern it. The
script therefore did NOT qualify production generation cancellation,
deadlines, or provider lifecycle behaviour — only the model's ability to
produce a well-formed closed proposal.

The review's correction was precise:

> *"move the existing provider operation inside the generator passed to
> runPckAttempt, using its cancellation contract. Preserve the existing
> bounded attempt budget."*

## 3.2 — The correction

```ts
const outcome = await runPckAttempt({
    generate: async ({ systemPrompt, request, signal }) => {
        const handler = await createHandlerAsync({ ... });
        for await (const chunk of handler.createMessage(
            systemPrompt,
            [{ role: "user", content: request }],
        )) {
            // The PRODUCTION cancellation contract is honoured INSIDE the
            // stream: an aborted attempt stops consuming the provider
            // response immediately.
            if (signal.aborted) {
                break;
            }
            ...
        }
        ...
        signal.throwIfAborted();
        return { text: rawText, ... };
    },
    canonicalMessages,
    identity: { decisionId: "model-gate", sourcePrefixKey: "model-gate" },
    taskSignal: new AbortController().signal,
    deadlineMs,
    currentSourcePrefixKey: () => "model-gate",
});
```

What changed, precisely:

```text
the provider call runs INSIDE the production generator
the production attempt's combined deadline/cancellation signal governs it
an aborted attempt stops consuming the provider response immediately
the request that reaches the provider is the EXACT production request
the attempt budget is UNCHANGED: two attempts, no automatic retries
```

The script's own request construction is now only used to REPORT the
request size in the receipt; the request that actually reaches the
provider is the one the production attempt builds.


## 3.3 — The results

Four INDEPENDENT executions of the corrected script against the REAL
MiniMax-M3 model through the production lifecycle. The receipts are
`verification/model-contract-gate-run2.txt` (run 2),
`run3.txt` (run 3) and `run4.txt` (run 4); run 1's output is quoted in
section 3.4.

```text
RUN 2: attempt 1 REJECTED (ATOM_NOT_IN_CLOSED_VOCABULARY)
       attempt 2 ACCEPTED   -> MODEL_CLOSED_CONTRACT_SUPPORTED
RUN 3: attempt 1 ACCEPTED   -> MODEL_CLOSED_CONTRACT_SUPPORTED
RUN 4: attempt 1 ACCEPTED   -> MODEL_CLOSED_CONTRACT_SUPPORTED
```

**MODEL_CONTRACT_SUPPORTED**

### The correction is visible in the live model output

The downgrades are not hypothetical. In run 1 and run 3, the model CLAIMED
`tool_observed` for records whose cited references did not support the
selected atom, and the runtime DOWNGRADED them:

```text
RUN 1
{"id":"pck-1","kind":"observation","assurance":"model_reported",
 "statement":"operation invoked with argument: connect timeout 3 seconds"}
{"id":"pck-3","kind":"open_question","assurance":"model_reported",
 "statement":"question remains open: none"}

RUN 3
{"id":"pck-1","kind":"observation","assurance":"model_reported",
 "statement":"operation invoked with argument: connect timeout 3 seconds"}
```

And the records whose atoms ARE genuinely supported kept the stronger
assurance, so the correction did not disable the feature:

```text
RUN 1
{"id":"pck-0","assurance":"tool_observed","statement":"operation invoked: build"}
{"id":"pck-2","assurance":"tool_observed",
 "statement":"bounded search returned no match: none"}
```

`QUESTION_REMAINS_OPEN` is `model_reported` in every run, which is the
designed permanent bound.

## 3.4 — Run 1 (the first corrected execution)

```json
{"event":"model_identity","providerId":"openai-compatible","modelId":"MiniMax-M3","baseUrl":"https://api.minimax.io/v1","hasCredential":true}
{"event":"checkpoint_request","observedReferenceCount":10,"requestChars":949}
{"event":"attempt_completed","attempt":1,"elapsedMs":33393,"responseChars":14984,"usedTools":false,"aborted":false}
{"event":"candidate_evaluated","attempt":1,"SCHEMA_VALID":true,"CLOSED_VALUES_VALID":true,"REFERENCES_RESOLVED":true,"ASSURANCE_BOUNDED":true,"CANDIDATE_ACCEPTED":true,"gateCodes":[],"admittedRecordCount":4,"admittedRecords":[
  {"id":"pck-0","kind":"observation","assurance":"tool_observed","status":"active","statement":"operation invoked: build","qualificationCount":2,"evidenceRefCount":3},
  {"id":"pck-1","kind":"observation","assurance":"model_reported","status":"active","statement":"operation invoked with argument: connect timeout 3 seconds","qualificationCount":3,"evidenceRefCount":3},
  {"id":"pck-2","kind":"observation","assurance":"tool_observed","status":"unresolved","statement":"bounded search returned no match: none","qualificationCount":2,"evidenceRefCount":3},
  {"id":"pck-3","kind":"open_question","assurance":"model_reported","status":"unresolved","statement":"question remains open: none","qualificationCount":4,"evidenceRefCount":6}]}
{"event":"model_gate_result","attempts":1,"CANDIDATE_ACCEPTED":true,"verdict":"MODEL_CLOSED_CONTRACT_SUPPORTED"}
```

Note `"aborted":false` on every attempt: the corrected lifecycle drives
the request under the production signal, and no attempt was aborted.

## 3.5 — The observed latency, recorded honestly

```text
run 1  attempt 1   33 393 ms
run 2  attempt 1   41 871 ms   (rejected by the gate)
       attempt 2   25 052 ms
run 3  attempt 1   12 884 ms
run 4  attempt 1   25 560 ms
```

The review's concern stands and is NOT resolved by this correction:

```text
T_PCK < T_redundant work avoided
```

The observed checkpoint cost is 12.9 s to 41.9 s per attempt. Whether the
mechanism pays for itself is the subject of the Round C controlled
experiment (A05), which must measure BOTH correctness and TOTAL task
completion time. This ACT does not claim that it does.

## 3.6 — What is NOT claimed

```text
PRODUCTION GENERATION CANCELLATION:   the corrected script drives the
                                      request under the production signal,
                                      but a LIVE cancellation of a real
                                      provider request was NOT exercised.
                                      Only the deterministic unit suite
                                      (G5.4) exercises cancellation.
INSTALLED-LIVE QUALIFICATION:          not performed. Out of scope.
ACTUAL CONVERGENCE IMPROVEMENT:        not established. Out of scope.
```

## 3.7 — The credential handling is unchanged

The credential is read from the operator-local secrets store and is NEVER
written to any output file, log line or evidence artefact. The raw model
output is written only to the repository's gitignored `tmp/` tree. No
credential appears in this evidence tree.
