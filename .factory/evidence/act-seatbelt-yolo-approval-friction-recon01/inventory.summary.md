# ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01 — Inventory Summary (CORRECTION02)

Generated: 2026-09-08T18:06:09.007Z
Seatbelt effective mode: seatbelt-experimental

## Key decision (load-bearing quadrant: effective YOLO + Seatbelt + no requires_approval)

```
PRE  (SYNTHETIC, no pathAuthorityEvidence):  152 cells  →  137 ALLOW  +  15 ASK
POST (PRODUCTION-EQUIVALENT path evidence): 152 cells  →  152 ALLOW  +  0 ASK

Diff:  55 ASK vanished under production evidence
       248 ASK survived under production evidence
```

## PRE ASK breakdown by source family (descending count)

| Source family (decision.source) | Count |
|---|---|
| host_workspace_realpath_authority (host_workspace_realpath_authority) | 15 |

## POST ASK breakdown by source family (descending count)

| Source family (decision.source) | Count |
|---|---|

## Dogfood witnesses (real prompt reproduction at the seam)

### DOGFOOD_PROMPT_01_PRE (PRE / SYNTHETIC (no pathAuthorityEvidence))

- command: `mkdir synthetic-dir`
- baseHostMode: `safe-only`
- sessionOverride: `none`
- effectiveHostMode: `safe-only`
- model_requires_approval: `undefined`
- final_decision: `ask`
- prompt_would_fire: `YES`
- approval_source: `host_mode_safe_only_fallthrough`

### DOGFOOD_PROMPT_01_POST (POST / PRODUCTION-EQUIVALENT)

- command: `mkdir synthetic-dir`
- baseHostMode: `safe-only`
- sessionOverride: `none`
- effectiveHostMode: `safe-only`
- model_requires_approval: `undefined`
- final_decision: `ask`
- prompt_would_fire: `YES`
- approval_source: `host_mode_safe_only_fallthrough`

### DOGFOOD_PROMPT_02_PRE (PRE / SYNTHETIC (no pathAuthorityEvidence))

- command: `mkdir synthetic-dir`
- baseHostMode: `safe-only`
- sessionOverride: `all`
- effectiveHostMode: `all`
- model_requires_approval: `undefined`
- final_decision: `allow`
- prompt_would_fire: `NO`
- approval_source: `host_mode_all`

### DOGFOOD_PROMPT_02_POST (POST / PRODUCTION-EQUIVALENT)

- command: `mkdir synthetic-dir`
- baseHostMode: `safe-only`
- sessionOverride: `all`
- effectiveHostMode: `all`
- model_requires_approval: `undefined`
- final_decision: `allow`
- prompt_would_fire: `NO`
- approval_source: `host_mode_all`

## Full evidence

Per-cell JSONL rows (one per command × matrix cell × composition): `inventory.jsonl`
Diff rows (PRE → POST verdict change): `inventory.diff.jsonl`
