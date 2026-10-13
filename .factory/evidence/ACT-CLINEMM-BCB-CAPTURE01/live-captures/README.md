# ACT-CLINEMM-BCB-CAPTURE01 — Live-captures evidence

## Live qualification status

`LIVE_QUALIFICATION_BLOCKED_BY_ENV`.

The exact-head VSIX artifact is BUILT and SHA-256-verified (see
`SHA256SUMS` and `clinemm-4.1.16-bcb-capture01.vsix`). The install
+ live toggle + live task + dump step could NOT run in this
environment because `~/.vscodium-clinemm/extensions/` is on a
read-only mount (`touch` and `chmod` both fail with
`Operation not permitted`). No `*.jsonl` dump file was produced
on a live install.

The successor ACT must run a live task in a writable environment
to resolve `LIVE_REPRODUCED` / `LIVE_NO_REPRO` /
`CAPTURE_INSUFFICIENT`. The diagnostic IS the instrument the prior
CORR01 §13.8 disposition recommended; the build proves it.

## Files

- `clinemm-4.1.16-bcb-capture01.vsix` — exact-head VSIX built at
  `1513ce704` (post-CORR01-CLOSED_HALTED_CLEAN). Contains the BCB
  capture diagnostic. SHA-256: `591ee8e3b6319462a50ab817a93b91627298d98c0eb6d7904f66c98c534ee302`.
- `SHA256SUMS` — manifest.
