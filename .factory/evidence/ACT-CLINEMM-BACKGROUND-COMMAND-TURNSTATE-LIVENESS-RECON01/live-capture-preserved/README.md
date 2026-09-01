ACT_ID    = ACT-CLINEMM-BACKGROUND-COMMAND-TIVENESS-RECON01
SECTION   = LIVE-CAPTURE-PRESERVED
SUBJECT   = task 1788213818870_vmswf (operator's preserved specimen)

================================================================
PRESERVED LIVE CAPTURE — METADATA ONLY
================================================================

This directory is reserved for the operator's verbatim preservation
of the LIVE specimen at task 1788213818870_vmswf. The actual capture
lives in the operator's workspace at `~/.cline/data/sessions/...`
(or whatever runtime path the operator uses). This ACT only stores
the metadata describing what was captured.

The capture itself satisfies the four-value discriminator schema
that ACT-CLINEMM-TASK-CANCEL-UI-RECON01 named as its
CAPTURE_INSUFFICIENT gap:

```text
turnPhase                = idle
taskHeaderPhase          = idle
backgroundCommandRunning = true
foregroundCommandRunning = false
```

repeated across many publications and epochs for task 1788213818870_vmswf.

If the operator wishes to mirror a copy of the captured publications
under this directory, place them at:

  /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/
    ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01/
    live-capture-preserved/01-publications.jsonl
  /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/
    ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01/
    live-capture-preserved/02-transcript.jsonl
  /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/
    ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01/
    live-capture-preserved/03-epoch-writes.jsonl

The recommended mirror schema (line per publication):

```json
{
  "publicationId": "<stateVersion>",
  "epoch": <number>,
  "turnPhase": "idle",
  "taskHeaderPhase": "idle",
  "backgroundCommandRunning": true,
  "foregroundCommandRunning": false,
  "ts": <epoch-ms>,
  "taskId": "1788213818870_vmswf"
}
```

This ACT does not require the mirror to be present (the RED is reproduced
by the four-value publication shape alone, regardless of which captures
exactly correspond to which publications).

================================================================
DISCRIMINATOR NOTE
================================================================

The four-value capture above is INSUFFICIENT to discriminate the E1..E5
candidates in PHASE 4 of the source-recon file. For full discrimination,
enable TSWPD (turn-state-writer-provenance) on the bound specimen and
re-run, capturing:
  - writerId of every turnStateTracker.setWithWriter call
  - previous.phase
  - new.phase
  - seq
  - epoch
  - publicationId

This is a one-line operational action (toggle the workspace flag
`tswpdEnabled`); no code change required. The recommendation is
recorded in 02-real-seam-red-and-classification.md §PHASE 4.

================================================================
END OF LIVE-CAPTURE-PRESERVED METADATA
================================================================