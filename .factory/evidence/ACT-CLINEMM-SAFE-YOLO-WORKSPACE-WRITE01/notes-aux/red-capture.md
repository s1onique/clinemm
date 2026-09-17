RED captured against the REAL production seam:

REPLAY_COMMAND:
  bun /tmp/red-probe.ts

CAPABILITY (canonical, exact):
  readonlyRoots  = [<WS_ROOT>]
  writableRoots  = []        <- ROOT CAUSE: workspace is write-deny-default
  denyReadSubpaths = [<CURATED_CREDENTIAL_SET_V1>]  (conserved)
  network = "allow"          (when CLINEMM_SAFE_YOLO_NETWORK=allow)
  cwd = <WS_ROOT>

REPLAY_OUTPUT (excerpt):
  MKDIR_PRE
  MKDIR_KDENIED
  LS_KDENIED
  WRITE_KDENIED
  DONE
  RED_VERIFIED = true

EXIT_CODE = 0  (bash exits 0 because mkdir's stderr is captured inside subshell
              and the script uses `|| echo` to swallow per-command failures.)

CLASSIFICATION:
  REAL                  - real production seam
  LIVE                  - real /usr/bin/sandbox-exec + kernel
  REAL_PRODUCTION_SEAM  - CommandJobManager + defaultSandboxBackendResolver

OUTER_SEATBELT_STATUS:
  NOT_PRESENT  (this dev box has no outer Seatbelt; the ACT's "outer sandbox"
                caveat in §14 was a hypothesis for dogfood; we capture
                real-kernel proof directly).
