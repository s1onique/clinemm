# 02 — Sentinel Seed (operator-owned; Clinemm DOES NOT seed)

The sentinel seed is deliberately NOT executed by this session, per
ACT §7 (sentinel isolation) and §5 (operator boundary). The token must
be generated at the operator's bench and stored via the supported
`myc remember ...` shape BEFORE LIVE-A; the token MUST NOT be exposed
to any model-visible transcript.

## Sentinel ID template

```text
SENTINEL_ID    = MYC-LIVE05-20260928-A
SENTINEL_TOKEN = (operator regenerates locally with uuidgen)
```

## Recommended operator steps

Run these in a fresh terminal window that no AI will ever see:

```bash
TOKEN=$(uuidgen | cut -c1-12)
echo "TOKEN=$TOKEN"     # write this down somewhere you will not forget

cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm

/Volumes/UserData/Users/chistyakov/.myc/bin/myc remember \
  "MYC-LIVE05-20260928-A = ${TOKEN}" \
  --tag clinemm-live05 --layer L1 --reach project

/Volumes/UserData/Users/chistyakov/.myc/bin/myc recall "MYC-LIVE05-20260928-A"
# expect: at least one hit containing the token
```

Then write into this evidence file (and update result.json):

```text
SENTINEL_ID          = MYC-LIVE05-20260928-A
SENTINEL_TOKEN_SHA   = <sha256 of token, never the token itself>
SENTINEL_STORED      = true
SENTINEL_RECALLABLE  = true
```

If recall fails:

```text
HALT_SENTINEL_NOT_RETRIEVABLE
```

## Sentinel isolation rule

The sentinel token must NOT appear in:
  - task prompt
  - ACT text pasted to model
  - repo files
  - AGENTS.md
  - system prompt
  - manual MCP tool call

It MAY exist only in:
  - real myc memory (the persisted memory record)
  - derived evidence after the run (e.g. PROVIDER_BOUND_SENTINEL_PRESENT
    boolean; the SHA256 of the token, NEVER the token itself)

## Clinemm evidence (this session)

```text
SENTINEL_ID          = MYC-LIVE05-20260928-A
SENTINEL_TOKEN       = PENDING_OPERATOR_LIVE_RUN
SENTINEL_STORED      = PENDING_OPERATOR_LIVE_RUN
SENTINEL_RECALLABLE  = PENDING_OPERATOR_LIVE_RUN

REASON_DEFERRED:
  ACT §7 forbids seeding a sentinel token from inside a session whose
  transcript is exposed to a model/reviewer. The token must be
  regenerated at the operator's bench and stored via the supported
  `myc remember ...` shape before LIVE-A. Per ACT §5, Clinemm does
  NOT have an operator-only terminal and does NOT launch Codium.

  This is the same deferral pattern as ACT-MYC-CLINEMM04 §3
  sentinel_seed_status block.
```