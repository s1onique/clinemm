#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
#
# BOUNDARY CLASSIFIER for the Ansible localhost qualification.
#
# The POSIX-semaphore repair is GREEN (the multiprocessing SemLock no
# longer fails with EPERM). Ansible's `LocalManager` now fails with
# "Local RPC server did not start." — a DIFFERENT boundary.
#
# This script discriminates the two candidate causes:
#
#   A) the AF_INET listener socket for the local RPC host is denied by
#      `(deny network*)`   -> hypothesized
#   B) something else in the sandbox
#
# by running the SAME localhost-only ansible ping under three profiles
# that differ ONLY in the network rule:
#
#   P1  network:deny   (the CURRENT production profile)
#   P2  network:allow  (the explicit opt-in profile)
#
# If P1 fails and P2 succeeds, the boundary is the AF_INET listener
# socket, i.e. the network rule — NOT the POSIX semaphore.
#
# MUST run from an UNSANDBOXED executor.
set -u
OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
EVDIR="$REPO/.factory/evidence/ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01"
export PATH="/Volumes/UserData/Users/chistyakov/.bun/bin:/nix/store/a5sxfwnzi3kzxrgj3zfngcqamdhnr161-nodejs-24.18.0/bin:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
ANSIBLE_BIN="/run/current-system/sw/bin/ansible"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/act-ansible-ab-XXXXXX")"
# The profiles grant WRITE authority to $WORK/profiles (it is the
# capability's writableRoots). Ansible's local temp must live inside an
# authorized writable root, so it goes under that same subtree.
mkdir -p "$WORK/profiles/tmp" "$WORK/profiles/ansible-temp"

# Generate the production profiles through the REAL production backend,
# under NODE (the production extension-host runtime), via the apps/vscode
# Vitest harness. Node's `realpathSync` handles the AF_UNIX host-helper
# socket correctly; Bun's does not (Bun returns EOPNOTSUPP for a socket
# inode on this filesystem). This is a HARNESS runtime choice, NOT a
# production behaviour change.
cd "$REPO/apps/vscode" || exit 1
ACT_POSIX_SEM_PROFILE_OUT="$WORK/profiles" \
  "$REPO/node_modules/.bin/vitest" run --config vitest.config.ts \
  src/sdk/__tests__/act-posix-sem01.profile-snapshot.test.ts \
  >"$WORK/gen.log" 2>&1
GEN_EXIT=$?

{
  echo "=== ANSIBLE NETWORK BOUNDARY A/B (Darwin kernel) ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "WORK_DIR=$WORK"
  echo "PROFILE_GENERATION_EXIT=$GEN_EXIT"
  grep -E '^PROFILE_(DENY|ALLOW)_' "$WORK/gen.log" || true
  echo

  for MODE in deny allow; do
    PROF="$WORK/profiles/production-profile-$MODE.sb"
    if [ ! -f "$PROF" ]; then
      echo "PROFILE_$MODE=NOT_GENERATED"
      cat "$WORK/gen-$MODE.log"
      continue
    fi
    echo "########## PROFILE MODE: $MODE ##########"
    echo "PROFILE_SHA256=$(shasum -a 256 "$PROF" | awk '{print $1}')"
    echo "SEM_RULE_COUNT=$(grep -c 'ipc-posix-sem' "$PROF" || true)"
    echo "NETWORK_RULE=$(grep -E '^\((allow|deny) network\*\)$' "$PROF" || echo NONE)"
    echo
    cd "$WORK" || exit 1
    env -i \
      PATH="/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
      HOME="$HOME" \
      TMPDIR="$WORK/profiles/tmp" \
      LANG="${LANG:-en_US.UTF-8}" \
      ANSIBLE_LOCAL_TEMP="$WORK/profiles/ansible-temp" \
      ANSIBLE_FORCE_COLOR=0 \
      ANSIBLE_NOCOLOR=1 \
      /usr/bin/sandbox-exec -f "$PROF" \
      "$ANSIBLE_BIN" -i 'localhost,' localhost -c local -m ansible.builtin.ping 2>&1
    echo "MODE_${MODE}_EXIT=$?"
    echo
  done

  echo "=== END_ANSIBLE_NETWORK_BOUNDARY_AB ==="
} >"$OUT" 2>&1

echo "wrote $OUT"
