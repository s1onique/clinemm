#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
#
# Capture the FULL stdout/stderr of the sandboxed localhost-only
# ansible.builtin.ping so the failure boundary can be classified
# precisely.
#
# The profile is the REPAIRED PRODUCTION profile, produced by the REAL
# production backend (SeatbeltSandboxBackendExperimental.prepare()).
#
# MUST run from an UNSANDBOXED executor.
set -u
OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
EVDIR="$REPO/.factory/evidence/ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01"
NODE_BIN_DIR="/nix/store/a5sxfwnzi3kzxrgj3zfngcqamdhnr161-nodejs-24.18.0/bin"
export PATH="/Volumes/UserData/Users/chistyakov/.bun/bin:$NODE_BIN_DIR:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
ANSIBLE_BIN="/run/current-system/sw/bin/ansible"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/act-ansible-sb-XXXXXX")"
mkdir -p "$WORK/tmp" "$WORK/ansible-tmp"

# Generate the REPAIRED PRODUCTION profile (network:deny) via the real backend.
cd "$REPO" || exit 1
bun "$EVDIR/gen-production-profile.ts" "$WORK" deny >"$WORK/gen.log" 2>&1
PROF="$WORK/production-profile-deny.sb"
if [ ! -f "$PROF" ]; then
  echo "PROFILE_GENERATION_FAILED" >"$OUT"
  cat "$WORK/gen.log" >>"$OUT"
  exit 1
fi

{
  echo "=== SANDBOXED ANSIBLE LOCALHOST PING (repaired production profile) ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "PROFILE_SHA256=$(shasum -a 256 "$PROF" | awk '{print $1}')"
  echo "PROFILE_SEM_RULE_COUNT=$(grep -c 'ipc-posix-sem' "$PROF" || true)"
  echo "ANSIBLE_BIN=$ANSIBLE_BIN"
  echo "WORK_DIR=$WORK"
  echo
  echo "--- PROFILE ---"
  cat "$PROF"
  echo
  echo "--- COMMAND ---"
  echo "ANSIBLE_LOCAL_TEMP=$WORK/ansible-tmp ANSIBLE_FORCE_COLOR=0 ANSIBLE_NOCOLOR=1 $ANSIBLE_BIN -i 'localhost,' localhost -c local -m ansible.builtin.ping"
  echo
  cd "$WORK" || exit 1
  env -i \
    PATH="/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    HOME="$HOME" \
    TMPDIR="$WORK/tmp" \
    LANG="${LANG:-en_US.UTF-8}" \
    ANSIBLE_LOCAL_TEMP="$WORK/ansible-tmp" \
    ANSIBLE_FORCE_COLOR=0 \
    ANSIBLE_NOCOLOR=1 \
    /usr/bin/sandbox-exec -f "$PROF" \
    "$ANSIBLE_BIN" -i 'localhost,' localhost -c local -m ansible.builtin.ping 2>&1
  echo "SANDBOXED_ANSIBLE_EXIT=$?"
  echo "=== END_SANDBOXED_ANSIBLE ==="
} >"$OUT" 2>&1

echo "wrote $OUT"
