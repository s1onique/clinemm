#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
#
# BOUNDARY CLASSIFICATION for the Ansible localhost qualification.
#
# Establishes, causally, WHICH sandbox boundary stops the Ansible
# localhost ping AFTER the POSIX-semaphore repair is in place.
#
#   V1  production profile (network:deny), ansible temp inside the
#       authorized root
#       -> isolates the AF_INET listener-socket boundary
#
#   V2  production profile (network:allow), ansible temp inside the
#       authorized root AND ANSIBLE_REMOTE_TEMP inside it
#       -> isolates the `$HOME/.ansible/tmp` filesystem boundary
#
#   V3  production profile (network:allow), ansible temp AND
#       ANSIBLE_REMOTE_TEMP inside the authorized root
#       -> the residual configuration boundary
#
# MUST run from an UNSANDBOXED executor.
set -u
OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
export PATH="/Volumes/UserData/Users/chistyakov/.bun/bin:/nix/store/a5sxfwnzi3kzxrgj3zfngcqamdhnr161-nodejs-24.18.0/bin:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
ANSIBLE_BIN="/run/current-system/sw/bin/ansible"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/act-ansible-cls-XXXXXX")"
mkdir -p "$WORK/profiles/tmp" "$WORK/profiles/ansible-temp" "$WORK/profiles/remote-temp"

cd "$REPO/apps/vscode" || exit 1
ACT_POSIX_SEM_PROFILE_OUT="$WORK/profiles" \
  "$REPO/node_modules/.bin/vitest" run --config vitest.config.ts \
  src/sdk/__tests__/act-posix-sem01.profile-snapshot.test.ts \
  >"$WORK/gen.log" 2>&1
GEN_EXIT=$?

{
  echo "=== ANSIBLE BOUNDARY CLASSIFICATION (Darwin kernel) ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "PROFILE_GENERATION_EXIT=$GEN_EXIT"
  grep -E '^PROFILE_(DENY|ALLOW)_' "$WORK/gen.log" || true
  echo

  run_case() {
    local label="$1" mode="$2" extra_env="$3"
    local PROF="$WORK/profiles/production-profile-$mode.sb"
    if [ ! -f "$PROF" ]; then
      echo "##### $label: PROFILE NOT GENERATED #####"
      return
    fi
    echo "##### $label #####"
    echo "PROFILE_MODE=$mode"
    echo "PROFILE_SHA256=$(shasum -a 256 "$PROF" | awk '{print $1}')"
    echo "SEM_RULE_COUNT=$(grep -c 'ipc-posix-sem' "$PROF" || true)"
    echo "NETWORK_RULE=$(grep -E '^\((allow|deny) network\*\)$' "$PROF" || echo NONE)"
    cd "$WORK/profiles" || exit 1
    env -i \
      PATH="/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
      HOME="$HOME" \
      TMPDIR="$WORK/profiles/tmp" \
      LANG="${LANG:-en_US.UTF-8}" \
      ANSIBLE_LOCAL_TEMP="$WORK/profiles/ansible-temp" \
      ANSIBLE_FORCE_COLOR=0 \
      ANSIBLE_NOCOLOR=1 \
      $extra_env \
      /usr/bin/sandbox-exec -f "$PROF" \
      "$ANSIBLE_BIN" -i 'localhost,' localhost -c local -m ansible.builtin.ping 2>&1
    echo "CASE_${label}_EXIT=$?"
    echo
  }

  run_case "V1_DENY_NETWORK_LOCAL_TEMP_AUTHORIZED" "deny" ""
  run_case "V2_ALLOW_NETWORK_LOCAL_TEMP_AUTHORIZED" "allow" ""
  run_case "V3_ALLOW_NETWORK_LOCAL_AND_REMOTE_TEMP_AUTHORIZED" "allow" \
    "ANSIBLE_REMOTE_TEMP=$WORK/profiles/remote-temp"

  echo "=== END_ANSIBLE_BOUNDARY_CLASSIFICATION ==="
} >"$OUT" 2>&1

echo "wrote $OUT"
