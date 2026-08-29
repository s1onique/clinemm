# SSH credential authority — LIVE closure cross-link

The settings-parity recon closes the precondition that the
temporary env control `CLINEMM_SAFE_YOLO_SSH_AGENT` is being
asked to replace. That precondition is that the SSH credential
authority implementation is **executable and LIVE-qualified**.

Closed on 2026-08-29 via operator-shell Phase G dogfood on
Terminal.app / iTerm2 family substrate:

```text
ACT_ID  = ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01
HEAD    = ff96ea8feecbb65e82dd3ddb14fb0269f90fb250
VERDICT = PASS_SEATBELT_SSH_AGENT_AUTHORITY_V1

SPECIMENS:
  - SSH_AUTH_SOCK visible           /private/tmp/com.apple.launchd.ScrpzaHuHe/Listeners; test -S => YES
  - ssh-add -l                      2048 SHA256:XYoaR80+0MKX48FTYnFQXs4fkX66VdRj47wgFXneU2w @id_rsa
  - cat ~/.ssh/id_rsa               EPERM (exit 1)
  - ssh ubuntu@81.177.33.219       SSH_AGENT_AUTH_OK ; host=indeep01; 6.8.0-57-generic
```

Full evidence under
`.factory/evidence/ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01/live-qualification/`
and `final-report.md` §16.

This precondition being met is the trigger for promoting the
settings-parity recon from HOLD to OPEN in `epic-board.md`.
