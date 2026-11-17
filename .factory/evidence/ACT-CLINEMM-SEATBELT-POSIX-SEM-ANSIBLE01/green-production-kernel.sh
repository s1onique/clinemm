#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
#
# T2 / T4 GREEN verification against the REPAIRED PRODUCTION profile.
#
# The profile is produced by the REAL production backend
# (`SeatbeltSandboxBackendExperimental.prepare()` -> `generateSeatbeltProfile()`)
# and launched through the SAME mechanism production uses:
#   /usr/bin/sandbox-exec -f <profile> <executable> <args...>
#
# MUST run from an UNSANDBOXED executor.
set -u
OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
EVDIR="$REPO/.factory/evidence/ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01"
NODE_BIN_DIR="/nix/store/a5sxfwnzi3kzxrgj3zfngcqamdhnr161-nodejs-24.18.0/bin"
export PATH="/Volumes/UserData/Users/chistyakov/.bun/bin:$NODE_BIN_DIR:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
PYBIN="${ACT_PYTHON:-/run/current-system/sw/bin/python3.13}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/act-green-XXXXXX")"
mkdir -p "$WORK/profiles/tmp"

# Generate the REPAIRED PRODUCTION profiles through the REAL production
# backend, under NODE (the production extension-host runtime), via the
# apps/vscode Vitest harness. Node's `realpathSync` handles the AF_UNIX
# host-helper socket correctly; Bun's does not (Bun returns EOPNOTSUPP
# for a socket inode on this filesystem). This is a HARNESS runtime
# choice, NOT a production behaviour change.
cd "$REPO/apps/vscode" || exit 1
ACT_POSIX_SEM_PROFILE_OUT="$WORK/profiles" \
  "$REPO/node_modules/.bin/vitest" run --config vitest.config.ts \
  src/sdk/__tests__/act-posix-sem01.profile-snapshot.test.ts \
  >"$WORK/gen.log" 2>&1
GEN_EXIT=$?

{
  echo "=== T2/T4 GREEN: repaired PRODUCTION profile, Darwin kernel ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "PYTHON_BIN=$PYBIN"
  echo "PYTHON_VERSION=$($PYBIN -V 2>&1)"
  echo "WORK_DIR=$WORK"
  echo "PROFILE_GENERATION_EXIT=$GEN_EXIT"
  grep -E '^PROFILE_(DENY|ALLOW)_' "$WORK/gen.log" || true
  echo

  PROF="$WORK/profiles/production-profile-deny.sb"
  PROF_ALLOW="$WORK/profiles/production-profile-allow.sb"
  if [ ! -f "$PROF" ] || [ ! -f "$PROF_ALLOW" ]; then
    echo "PROFILE_GENERATION_FAILED"
    cat "$WORK/gen.log"
    exit 1
  fi
  echo "--- PRODUCTION PROFILE (network:deny) verbatim ---"
  cat "$PROF"
  echo "PROFILE_SHA256=$(shasum -a 256 "$PROF" | awk '{print $1}')"
  echo "PROFILE_SEM_RULE_COUNT=$(grep -c 'ipc-posix-sem' "$PROF" || true)"
  echo
  echo "--- PRODUCTION PROFILE (network:allow) verbatim ---"
  cat "$PROF_ALLOW"
  echo "PROFILE_ALLOW_SHA256=$(shasum -a 256 "$PROF_ALLOW" | awk '{print $1}')"
  echo "PROFILE_ALLOW_SEM_RULE_COUNT=$(grep -c 'ipc-posix-sem' "$PROF_ALLOW" || true)"
  echo

  cd "$WORK/profiles" || exit 1

  echo "--- STEP 2 (T2): exact RED probe under the repaired production profile ---"
  env -i PATH="/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" TMPDIR="$WORK/profiles/tmp" LANG="${LANG:-en_US.UTF-8}" \
    /usr/bin/sandbox-exec -f "$PROF" \
    "$PYBIN" -c '
import multiprocessing as mp
import sys
print("PYTHON:", sys.executable)
s = mp.Semaphore(1)
s.acquire()
s.release()
print("POSIX_SEM_OK")
'
  echo "T2_EXIT=$?"
  echo

  echo "--- STEP 3 (T2): multiprocessing worker + queue (beyond semaphore construction) ---"
  env -i PATH="/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" TMPDIR="$WORK/profiles/tmp" LANG="${LANG:-en_US.UTF-8}" \
    /usr/bin/sandbox-exec -f "$PROF" \
    "$PYBIN" -c '
import multiprocessing as mp

def worker(q):
    q.put(("worker-ok", mp.current_process().name))

if __name__ == "__main__":
    ctx = mp.get_context("fork")
    q = ctx.Queue()
    procs = [ctx.Process(target=worker, args=(q,)) for _ in range(3)]
    for p in procs:
        p.start()
    results = [q.get(timeout=30) for _ in range(3)]
    for p in procs:
        p.join(timeout=30)
    codes = [p.exitcode for p in procs]
    print("QUEUE_RESULTS:", results)
    print("EXIT_CODES:", codes)
    assert all(c == 0 for c in codes), codes
    print("MP_WORKER_QUEUE_OK")
'
  echo "T2_WORKER_EXIT=$?"
  echo

  echo "--- STEP 4 (T4): security conservation negative controls ---"
  echo "[T4-a] write OUTSIDE authorized roots must be DENIED:"
  # NOTE: canonical /tmp is an ALWAYS-WRITABLE subpath in the profile BY
  # DESIGN (ACT-CLINEMM-SEATBELT-TEMP-WRITE-AUTHORITY01), so it is NOT a
  # valid "outside the authorized roots" probe. The probe therefore uses a
  # path under the user's HOME, which is neither a capability writable
  # root nor an always-writable literal.
  OUTSIDE_PROBE="$HOME/act-outside-write-probe-$$.txt"
  rm -f "$OUTSIDE_PROBE"
  env -i PATH="/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" TMPDIR="$WORK/profiles/tmp" \
    /usr/bin/sandbox-exec -f "$PROF" \
    /bin/sh -c 'echo leak > "'"$OUTSIDE_PROBE"'" 2>/tmp/act-outside-err.txt; echo "WRITE_EXIT=$?"; head -1 /tmp/act-outside-err.txt 2>/dev/null'
  echo "T4A_HOST_EXIT=$?"
  echo "T4A_FILE_EXISTS_ON_HOST=$([ -f "$OUTSIDE_PROBE" ] && echo YES_LEAKED || echo NO_DENIED)"
  rm -f "$OUTSIDE_PROBE"
  echo

  echo "[T4-b] authorized workspace write must SUCCEED:"
  env -i PATH="/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" TMPDIR="$WORK/profiles/tmp" \
    /usr/bin/sandbox-exec -f "$PROF" \
    /bin/sh -c 'echo authorized > "'"$WORK"'/profiles/authorized-write.txt"; echo "WRITE_EXIT=$?"; cat "'"$WORK"'/profiles/authorized-write.txt"'
  echo "T4B_HOST_EXIT=$?"
  echo

  echo "[T4-c] default network egress must be DENIED (network:deny profile):"
  env -i PATH="/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" TMPDIR="$WORK/profiles/tmp" \
    /usr/bin/sandbox-exec -f "$PROF" \
    "$PYBIN" -c '
import socket, sys
s = socket.socket()
s.settimeout(5)
try:
    s.connect(("1.1.1.1", 53))
except OSError as e:
    print("NETWORK_DENIED errno=%d %s" % (e.errno, e))
    sys.exit(7)
print("NETWORK_UNEXPECTEDLY_ALLOWED")
sys.exit(0)
'
  echo "T4C_EXIT=$? (7 == denied as expected)"
  echo

  echo "[T4-d] sensitive environment values must remain SANITIZED:"
  # NOTE: the sanitization contract is enforced by the BACKEND's
  # `materializeEnvironment`, which produces the child's env. Using
  # `env -i` here would BYPASS that contract and would therefore not
  # test it. The load-bearing proof is the live test
  #   sdk/packages/core/src/runtime/sandbox/macos/seatbelt-posix-sem01.live.test.ts
  #   "T4-e: sensitive environment values remain sanitized"
  # which runs the REAL prepared invocation with the REAL materialized
  # env. This standalone probe is a CROSS-CHECK of the profile only:
  # it shows that the profile itself does not grant any environment
  # authority (the env is passed by the executor, not the profile).
  echo "T4D_NOTE=sanitization is an EXECUTOR contract, proven by seatbelt-posix-sem01.live.test.ts T4-e"
  env -i PATH="/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" TMPDIR="$WORK/profiles/tmp" \
    /usr/bin/sandbox-exec -f "$PROF" \
    /bin/sh -c 'echo "PROFILE_GRANTS_ENV_AUTHORITY=n/a (env is supplied by the executor, not the profile)"'
  echo "T4D_HOST_EXIT=$?"
  echo

  echo "[T4-e] explicit network opt-in (network:allow profile) behavior unchanged:"
  env -i PATH="/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" TMPDIR="$WORK/profiles/tmp" \
    /usr/bin/sandbox-exec -f "$PROF_ALLOW" \
    "$PYBIN" -c '
import socket, sys
s = socket.socket()
s.settimeout(5)
try:
    s.connect(("1.1.1.1", 53))
    print("NETWORK_ALLOW_OK")
    sys.exit(0)
except OSError as e:
    print("NETWORK_ALLOW_FAILED errno=%d %s" % (e.errno, e))
    sys.exit(1)
'
  echo "T4E_EXIT=$? (0 == explicit opt-in still allows)"
  echo

  echo "[T4-f] SSH-agent authority remains opt-in (no AF_UNIX rule in deny profile):"
  echo "PROFILE_DENY_HAS_AF_UNIX=$(grep -c 'AF_UNIX' "$PROF" || true)"
  echo "PROFILE_DENY_HAS_SSH_AGENT_RULE=$(grep -c 'system-socket' "$PROF" || true)"
  echo "[T4-g] host-helper socket authority remains gated on network mode:"
  echo "PROFILE_DENY_HAS_HOST_HELPER=$(grep -c 'host-helper.sock' "$PROF" || true)"
  echo "PROFILE_ALLOW_HAS_HOST_HELPER=$(grep -c 'host-helper.sock' "$PROF_ALLOW" || true)"
  echo

  echo "=== END_T2_T4_GREEN ==="
} >"$OUT" 2>&1

echo "wrote $OUT"
