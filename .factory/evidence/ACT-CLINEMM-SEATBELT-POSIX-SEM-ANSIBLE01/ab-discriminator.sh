#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
#
# A/B CAUSAL DISCRIMINATOR.
#
# Builds two otherwise IDENTICAL temporary Seatbelt policies:
#   A - existing ClineMM shape (NO semaphore permission)
#   B - exactly one additional rule: (allow ipc-posix-sem)
#
# Everything else is byte-identical: same process-exec/fork/signal rules,
# same filesystem rules, same network rule, same working directory, same
# environment, same python executable, same command, same launch
# mechanism (/usr/bin/sandbox-exec -f <profile>).
#
# MUST be executed from an UNSANDBOXED executor (a shell that is not itself
# inside a Seatbelt sandbox), otherwise the outer sandbox owns the denial
# and the experiment is invalid.
set -u

OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
EVDIR="$REPO/.factory/evidence/ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/act-posix-sem-XXXXXX")"
# The ABSOLUTE interpreter path. Must be the SAME python that launches the
# installed Ansible (nix ansible-core 2.21.1 -> python 3.13.15 on this
# host). An absolute path is used so that the `env -i` below cannot change
# WHICH interpreter is selected -- the ACT requires the same executable
# for A and B.
PYBIN="${ACT_PYTHON:-/run/current-system/sw/bin/python3.13}"
if [ ! -x "$PYBIN" ]; then
  PYBIN="$(command -v python3)"
fi

# The exact live ClineMM production profile shape observed on this host,
# minus the per-invocation temp path (replaced below), plus the working
# directory write grant. This is the A policy.
#
# NOTE: this mirrors what generateSeatbeltProfile() emits TODAY
# (no ipc-posix-sem). It is reproduced here so the discriminator is
# self-contained and does not depend on the working tree.
build_profile() {
  local sem_rule="$1"
  local out="$2"
  {
    echo "(version 1)"
    echo "(deny default)"
    echo "(allow process-exec)"
    echo "(allow process-fork)"
    echo "(allow signal (target same-sandbox))"
    echo "(allow sysctl-read)"
    echo "(allow mach-lookup)"
    echo "(allow file-read*)"
    echo "(allow file-write*"
    echo "  (subpath \"$WORK\")"
    echo "  (subpath \"$WORK\")"
    echo "  (literal \"/dev/null\")"
    echo "  (literal \"/dev/tty\")"
    echo "  (subpath \"/private/tmp\"))"
    echo "(allow file-read-metadata (subpath \"/\"))"
    echo "(deny network*)"
    if [ -n "$sem_rule" ]; then
      echo "$sem_rule"
    fi
  } >"$out"
}

PROBE_A="$WORK/profile-A.sb"
PROBE_B="$WORK/profile-B.sb"
build_profile "" "$PROBE_A"
build_profile "(allow ipc-posix-sem)" "$PROBE_B"

{
  echo "=== A/B CAUSAL DISCRIMINATOR ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "WORK_DIR=$WORK"
  echo "PYTHON_BIN=$PYBIN"
  echo "PYTHON_PATH=$($PYBIN -c 'import sys; print(sys.executable)' 2>&1)"
  echo "PYTHON_VERSION=$($PYBIN -V 2>&1)"
  echo

  echo "--- POLICY A (existing: no semaphore permission) ---"
  cat "$PROBE_A"
  echo "POLICY_A_SHA256=$(shasum -a 256 "$PROBE_A" | awk '{print $1}')"
  echo "POLICY_A_SEM_RULE_COUNT=$(grep -c 'ipc-posix-sem' "$PROBE_A" || true)"
  echo "POLICY_A_DIFF_VS_B:"
  diff "$PROBE_A" "$PROBE_B" || true
  echo

  echo "--- POLICY B (experimental: + (allow ipc-posix-sem)) ---"
  cat "$PROBE_B"
  echo "POLICY_B_SHA256=$(shasum -a 256 "$PROBE_B" | awk '{print $1}')"
  echo "POLICY_B_SEM_RULE_COUNT=$(grep -c 'ipc-posix-sem' "$PROBE_B" || true)"
  echo

  for POLICY in A B; do
    case "$POLICY" in
      A) PROFILE="$PROBE_A" ;;
      B) PROFILE="$PROBE_B" ;;
    esac
    echo "=== EXECUTION POLICY $POLICY ==="
    echo "PROFILE_PATH=$PROFILE"
    echo "LAUNCH=/usr/bin/sandbox-exec -f $PROFILE $PYBIN -c <probe>"
    cd "$WORK" || exit 1
    # Identical env for both policies.
    env -i \
      PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
      HOME="$HOME" \
      TMPDIR="$WORK" \
      LANG="${LANG:-en_US.UTF-8}" \
      /usr/bin/sandbox-exec -f "$PROFILE" \
      "$PYBIN" -c '
import multiprocessing as mp
import sys
print("PYTHON:", sys.executable)
try:
    s = mp.Semaphore(1)
    s.acquire()
    s.release()
except OSError as e:
    print("SEMAPHORE_ERROR_ERRNO=%d" % e.errno)
    print("SEMAPHORE_ERROR=%s" % e)
    sys.exit(1)
print("POSIX_SEM_OK")
'
    echo "POLICY_${POLICY}_EXIT=$?"
    echo
  done

  echo "=== END_A/B_CAUSAL_DISCRIMINATOR ==="
} >"$OUT" 2>&1

echo "wrote $OUT"
