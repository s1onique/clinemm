# 06 — Provider Capture Summary (LIVE-G / LIVE-H / LIVE-I / LIVE-J)

## §15 LIVE-G: provider-bound capture

Provider capture is enabled by the recipe's env flags:

```bash
export CLINE_CAPTURE_PROVIDER_REQUEST=full
export CLINE_CAPTURE_DIR=/tmp/clinemm-myc-prime-captures
mkdir -p "$CLINE_CAPTURE_DIR"
rm -rf "$CLINE_CAPTURE_DIR"/*
```

After the live run, the operator inspects:

```bash
ls -la /tmp/clinemm-myc-prime-captures/
find /tmp/clinemm-myc-prime-captures -type f -name '*.json' | head
ls /tmp/clinemm-myc-prime-captures/ai-sdk/
```

Capture fields (operator fills in after live run):

```text
PROVIDER_CAPTURE_PRESENT       = PENDING_OPERATOR_LIVE_RUN
PROVIDER_CAPTURE_STAGE         = PENDING_OPERATOR_LIVE_RUN  (target: ai_sdk_prompt)
PROVIDER_CAPTURE_MODE          = PENDING_OPERATOR_LIVE_RUN  (target: full)
PROVIDER_CAPTURE_ID            = PENDING_OPERATOR_LIVE_RUN
PROVIDER_CAPTURE_SESSION_ID    = PENDING_OPERATOR_LIVE_RUN
```

Failure boundary:

```text
PROVIDER_CAPTURE_PRESENT=false -> HALT_PROVIDER_CAPTURE_NOT_ACTIVE
```

If the provider path is unsupported by the current capture seam:

```text
CAPTURE_INSUFFICIENT
```

## §16 LIVE-H: diagnostics ↔ provider correlation

The correlation id is the captureId recorded in the diagnostic
snapshot's `capture.captureId` field. Required:

```text
MYC_DIAG_CAPTURE_ID == PROVIDER_CAPTURE_ID
```

Do NOT correlate by "close timestamp" — use the explicit id. If no
trustworthy join exists:

```text
CAPTURE_INSUFFICIENT
```

## §17 LIVE-I: provider-bound prime

The provider-bound prompt must contain exactly one prime packet
(from the myc recorder) and that packet must contain the sentinel.

```bash
cat /tmp/clinemm-myc-prime-captures/ai-sdk/<file>.json | jq . > /tmp/json.dump
grep -c '<prime_packet source="myc" session="' /tmp/json.dump
# expect: 1

grep -c "$TOKEN" /tmp/json.dump
# expect: 1
```

DO NOT commit the full payload. Commit only derived evidence:

```text
PROVIDER_CAPTURE_RAW_SHA256 = <shasum -a 256 output>
PROVIDER_BOUND_PRIME_PACKET_COUNT       = PENDING_OPERATOR_LIVE_RUN
PROVIDER_BOUND_PRIME_PACKET_SESSION_ID  = PENDING_OPERATOR_LIVE_RUN
PROVIDER_BOUND_SENTINEL_PRESENT         = PENDING_OPERATOR_LIVE_RUN
```

Targets:

```text
PROVIDER_BOUND_PRIME_PACKET_COUNT       = 1
PROVIDER_BOUND_PRIME_PACKET_SESSION_ID  = S
PROVIDER_BOUND_SENTINEL_PRESENT         = true
```

Failure boundaries:

```text
injection=1 but capture=0   -> HALT_PRIME_PACKET_LOST_BEFORE_PROVIDER
capture > 1                 -> HALT_DUPLICATE_PRIME_INJECTION
capture = 0 (and present)   -> HALT_PRIME_NOT_MODEL_VISIBLE
```

This is the decisive content proof of the chain:

  persisted myc memory
    → real myc prime
    → injected prime packet
    → actual provider-bound prompt

If this evidence is clean, the myc prime path is live-proven
end-to-end. The bounded-bootstrap repair on HEAD 89249175c is not
strictly required to reach this point (the prime packet injection
runs in the FIRST turn's bootstrap, not the second/finalization
turn). But the FINALIZATION-RUN-BOOTSTRAP-STALL01 repair is what
makes the second run reach `agent_turn_done` so that
`task_completion_committed=1` is observable.