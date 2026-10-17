Evidence files for ACT-CLINEMM-TART-P4-IMPORTED-SONOMA-REAL-GUEST-LIFECYCLE01
(created 2026-10-15 by the resumption session that followed the P3
operator-unblock addendum; populated post-Phase-2 by the operator and
agent in coordination).

  01-tart-exec-sw_vers.txt   — operator transcript of `tart exec
                               clinemm-p3-sonoma-imported /usr/bin/sw_vers`
                               under
                               TART_HOME=/private/tmp/clinemm-tart-p3-20261015T131912Z-30833
  02-tart-exec-uname-a.txt   — operator transcript of `tart exec
                               clinemm-p3-sonoma-imported /usr/bin/uname -a`
  03-helper-dispatch-transcript.txt
                             — agent record of the dev-fallback
                               clinemm-host-helper dispatch that
                               re-issues the Phase 2 exec pair via the
                               sealed-Tart allowlist
  04-tart-stop-transcript.txt
                             — operator transcript of `tart stop` and
                               the resulting State transition
  05-tart-list-post-shutdown.json
                             — `tart list --source local --format json`
                               after the clean shutdown, proving the
                               VM identity is preserved
  06-phase2-halt-or-pass.txt — agent's Phase 2 verdict: PASS (with
                               references to 01/02) or HALT (with
                               proximate classifier and full transcript)
  00-closure-evidence.txt    — to be written at ACT close (Phase 6 PASS
                               and Phases 2-5 verified)
  SHA256SUMS                 — final SHA-256 over each evidence file at
                               ACT close

The ClineMM Factory durability rule still applies: every ACT that
updates board status MUST stage and commit a board delta before
closure. The board delta is staged separately at ACT close, not
included in this evidence directory.
