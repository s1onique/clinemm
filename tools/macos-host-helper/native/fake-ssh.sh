#!/bin/sh
# Multi-mode fake: dispatch on $0 basename.
SELF=$(basename "$0")
case "$SELF" in
  ssh-keygen)
    KEY_PATH=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -f) KEY_PATH="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    if [ -n "$KEY_PATH" ]; then
      # Note: we DO NOT write a real-looking OpenSSH private key
      # here, because gitleaks' private-key rule scans for the
      # "-----BEGIN OPENSSH PRIVATE KEY-----" sentinel. The fake
      # key below is just a sentinel + placeholder that satisfies
      # the helper's stat() check in tbr_provision_ssh_identity.
      # The real helper uses ssh-keygen which produces a real key
      # in production.
      printf 'FAKE_KEY_NO_REAL_OPENSSH_BLOB\n' > "$KEY_PATH"
      printf 'placeholder-for-tbr_provision_ssh_identity-test\n' >> "$KEY_PATH"
      chmod 0600 "$KEY_PATH"
      printf 'ssh-ed25519 FAKEKEY_PLACEHOLDER testkey@test\n' > "$KEY_PATH.pub"
    fi
    exit 0
    ;;
  ssh)
    # Capture argv if requested.
    if [ -n "$FAKE_SSH_CAPTURE_PATH" ]; then
      echo "$0" > "$FAKE_SSH_CAPTURE_PATH"
      i=0
      for a in "$@"; do
        echo "argv[$i]=$((i+1))=$a" >> "$FAKE_SSH_CAPTURE_PATH"
        i=$((i+1))
      done
    fi
    # Detect WAIT_SSH vs command: WAIT_SSH calls `ssh <ip> true`
    # with no extra command args after the user@ip. Commands have
    # additional positional args after user@ip. We pick the file
    # based on whether the last arg is "true".
    LAST=""
    for a in "$@"; do LAST="$a"; done
    if [ "$LAST" = "true" ]; then
      # WAIT_SSH: use FAKE_SSH_EXIT_FILE (always 0 in tests).
      if [ -n "$FAKE_SSH_EXIT_FILE" ]; then
        CODE=$(cat "$FAKE_SSH_EXIT_FILE" 2>/dev/null | head -1)
        exit ${CODE:-0}
      fi
      exit 0
    fi
    # Command: use FAKE_SSH_CMD_EXIT_FILE.
    if [ -n "$FAKE_SSH_CMD_EXIT_FILE" ]; then
      CODE=$(cat "$FAKE_SSH_CMD_EXIT_FILE" 2>/dev/null | head -1)
      exit ${CODE:-0}
    fi
    exit 0
    ;;
  scp)
    exit 0
    ;;
esac
exit 0
