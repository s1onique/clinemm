#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
# Probe the execution boundary of a shell. Run from an UNSANDBOXED executor.
# Emits a machine-readable report. Never prints secrets.
set -u

OUT="${1:?output file required}"

{
  echo "=== PROBE_ENVIRONMENT ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "SHELL_PID=$$"
  echo "PPID=$PPID"
  echo "TMPDIR=${TMPDIR:-<unset>}"
  echo "CLINEMM_HOST_HELPER_SOCKET=${CLINEMM_HOST_HELPER_SOCKET:-<unset>}"
  echo "UNAME=$(uname -a)"
  echo "SW_VERS=$(sw_vers -productVersion 2>/dev/null || echo unknown)"

  # --- Is THIS shell inside a Seatbelt sandbox? ---
  # A nested sandbox-exec inside an existing sandbox fails with
  # "sandbox_apply: Operation not permitted" when the outer sandbox
  # denies sandbox-application (process-fork of a sandboxed child).
  if /usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true 2>/tmp/act_sbexec_err.txt; then
    echo "NESTED_SANDBOX_EXEC=OK"
  else
    echo "NESTED_SANDBOX_EXEC=FAILED rc=$?"
    echo "NESTED_SANDBOX_EXEC_STDERR=$(cat /tmp/act_sbexec_err.txt 2>/dev/null | tr '\n' '|')"
  fi
  rm -f /tmp/act_sbexec_err.txt

  # --- POSIX semaphore probe (unsandboxed baseline) ---
  PYBIN="${ACT_PYTHON:-python3}"
  echo "PYTHON_BIN=$PYBIN"
  echo "PYTHON_PATH=$($PYBIN -c 'import sys; print(sys.executable)' 2>&1)"
  "$PYBIN" - <<'PYEOF'
import multiprocessing as mp
import sys
print("PYTHON:", sys.executable)
s = mp.Semaphore(1)
s.acquire()
s.release()
print("POSIX_SEM_OK")
PYEOF
  echo "POSIX_SEM_EXIT=$?"

  echo "=== END_PROBE_ENVIRONMENT ==="
} >"$OUT" 2>&1
