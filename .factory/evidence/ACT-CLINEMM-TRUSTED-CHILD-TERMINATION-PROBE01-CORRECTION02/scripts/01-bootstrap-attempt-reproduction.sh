#!/bin/bash
set -u
echo "=== BOOTSTRAP_PROBE_START $(date -u +%FT%TZ) ==="
echo "host_uname=$(uname -a)"
echo "host_whoami=$(whoami) uid=$(id -u)"
echo "host_managername=$(launchctl managername 2>&1 || echo unavailable)"
echo "--- user/501 session ---"
launchctl print user/501 2>&1 | head -8
echo "--- gui/501 session ---"
launchctl print gui/501 2>&1 | head -8
echo "--- attempting launchctl bootstrap gui/501 with the helper binary ---"
BOOTSTRAP_OUTPUT=$(launchctl bootstrap gui/501 /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools/macos-host-helper/native/helper 2>&1)
BOOTSTRAP_RC=$?
echo "BOOTSTRAP_RC=$BOOTSTRAP_RC"
echo "BOOTSTRAP_OUTPUT=$BOOTSTRAP_OUTPUT"
echo "--- after bootstrap, is helper registered in gui/501? ---"
launchctl print gui/501 2>&1 | grep -i clinemm | head -5 || echo "(no clinemm service in gui/501)"
echo "=== BOOTSTRAP_PROBE_END ==="
