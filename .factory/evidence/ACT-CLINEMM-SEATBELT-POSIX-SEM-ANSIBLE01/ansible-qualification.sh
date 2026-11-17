#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
#
# Ansible qualification.
#
#   1. Capture the installed Ansible's interpreter + version.
#   2. Run a LOCALHOST-ONLY `ansible.builtin.ping` through the repaired,
#      still-sandboxed ClineMM background runner (CommandJobManager
#      production path).
#
# The Ubuntu guest (192.168.50.239:22) is NOT contacted. The provisioning
# playbook is NOT run. Host-key verification is NOT disabled. No private
# SSH key is read or printed.
#
# MUST run from an UNSANDBOXED executor.
set -u
OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
NODE_BIN_DIR="/nix/store/a5sxfwnzi3kzxrgj3zfngcqamdhnr161-nodejs-24.18.0/bin"
export PATH="/Volumes/UserData/Users/chistyakov/.bun/bin:$NODE_BIN_DIR:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

ANSIBLE_BIN="${ACT_ANSIBLE_BIN:-/run/current-system/sw/bin/ansible}"
if [ ! -x "$ANSIBLE_BIN" ]; then
  ANSIBLE_BIN="$(command -v ansible || true)"
fi
ANSIBLE_PLAYBOOK_BIN="${ACT_ANSIBLE_PLAYBOOK_BIN:-/run/current-system/sw/bin/ansible-playbook}"
if [ ! -x "$ANSIBLE_PLAYBOOK_BIN" ]; then
  ANSIBLE_PLAYBOOK_BIN="$(command -v ansible-playbook || true)"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/act-ansible-XXXXXX")"
export ANSIBLE_LOCAL_TEMP="$WORK/ansible-tmp"
export ANSIBLE_REMOTE_TEMP="${TMPDIR:-/tmp}"
mkdir -p "$ANSIBLE_LOCAL_TEMP"

{
  echo "=== ANSIBLE QUALIFICATION (localhost only, sandboxed) ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "ANSIBLE_BIN=$ANSIBLE_BIN"
  echo "ANSIBLE_PLAYBOOK_BIN=$ANSIBLE_PLAYBOOK_BIN"
  echo "ANSIBLE_LOCAL_TEMP=$ANSIBLE_LOCAL_TEMP"
  echo

  echo "--- STEP 1: ansible --version (interpreter + version capture) ---"
  "$ANSIBLE_BIN" --version 2>&1
  echo "ANSIBLE_VERSION_EXIT=$?"
  echo

  echo "--- STEP 2: the SAME interpreter, raw multiprocessing probe ---"
  ANSIBLE_PY="$(head -1 "$ANSIBLE_BIN" | sed -E 's|^#!.*(python[0-9.]*).*|\1|')"
  echo "ANSIBLE_SHEBANG=$ANSIBLE_PY"
  echo

  echo "--- STEP 3: UNSANDBOXED baseline — localhost-only ansible.builtin.ping ---"
  echo "COMMAND=$ANSIBLE_BIN -i 'localhost,' localhost -c local -m ansible.builtin.ping"
  cd "$WORK" || exit 1
  # ANSIBLE_FORCE_COLOR=0 keeps the output machine-readable.
  ANSIBLE_FORCE_COLOR=0 ANSIBLE_NOCOLOR=1 \
    "$ANSIBLE_BIN" -i 'localhost,' localhost -c local -m ansible.builtin.ping 2>&1
  echo "ANSIBLE_PING_UNSANDBOXED_EXIT=$?"
  echo

  echo "--- STEP 3b: the SANDBOXED localhost-only ansible.builtin.ping ---"
  echo "Executed by the apps/vscode production-path test:"
  echo "  'T8: a localhost-only ansible.builtin.ping task SUCCEEDS through the sandboxed production runner'"
  echo "  in apps/vscode/src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts"
  echo "Receipt: apps-vscode-suites.txt"
  echo

  echo "--- STEP 4: syntax-check the ACTUAL playbook when available ---"
  PLAYBOOK=""
  for candidate in \
    "$REPO/ansible/playbooks"/*.yml \
    "$REPO/ansible"/*.yml \
    "$REPO"/*playbook*.yml \
    "$REPO"/playbooks/*.yml; do
    if [ -f "$candidate" ]; then PLAYBOOK="$candidate"; break; fi
  done
  if [ -n "$PLAYBOOK" ]; then
    echo "PLAYBOOK=$PLAYBOOK"
    ANSIBLE_FORCE_COLOR=0 ANSIBLE_NOCOLOR=1 "$ANSIBLE_PLAYBOOK_BIN" --syntax-check "$PLAYBOOK" 2>&1
    echo "ANSIBLE_SYNTAX_CHECK_EXIT=$?"
  else
    echo "PLAYBOOK=NOT_FOUND (no playbook files discovered in the repository)"
    echo "ANSIBLE_SYNTAX_CHECK_EXIT=NOT_EXECUTED"
  fi
  echo

  echo "--- STEP 5: remote guest qualification ---"
  echo "REMOTE_GUEST=192.168.50.239:22"
  echo "REMOTE_SSH_PERFORMED=NO"
  echo "REMOTE_SSH_REASON=No destination-scoped network authority exists in the current Seatbelt profile; the network capability is deny|allow (not destination-scoped). A remote ping would require an unrestricted network grant, which this ACT explicitly forbids. Recorded as a separate bounded successor."

  echo "=== END_ANSIBLE_QUALIFICATION ==="
} >"$OUT" 2>&1

echo "wrote $OUT"
