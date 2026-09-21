STALE CARD DEFERRED — AGCONT01
==============================

Per the ACT section 34:

  STALE_BACKGROUND_CARD_AFTER_TERMINAL = LIVE PROVEN
  STALE_CANCEL_AFTER_TERMINAL         = LIVE PROVEN

These are NOT in scope for AGCONT01. They are projection defects
on the TaskHeader / Cancel button, not agent-continuation defects.

The expected successor:
  ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01

This ACT does NOT touch the card projection logic. The BTCONT01
fix correctly handles the turn-state projection (awaiting_followup
commit) but the TaskHeader / Cancel button projections are
separate defects.

AGCONT01 leaves these deferred to the card-projection successor ACT.

STATUS: DEFERRED
