#!/bin/bash
set -u
echo "=== BOOTSTRAP_PROBE_2_START $(date -u +%FT%TZ) ==="
echo "--- attempt 1: launchctl bootstrap user/501 with the helper binary ---"
OUT1=$(launchctl bootstrap user/501 /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools/macos-host-helper/native/helper 2>&1)
RC1=$?
echo "USER501_RC=$RC1 OUTPUT=$OUT1"
echo "--- attempt 2: launchctl bootstrap (no domain) with the helper binary ---"
OUT2=$(launchctl bootstrap gui/501 /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools/macos-host-helper/native/helper 2>&1)
RC2=$?
echo "GUI501_RC=$RC2 OUTPUT=$OUT2"
echo "--- check if helper is registered in user/501 ---"
launchctl print user/501 2>&1 | grep -i clinemm | head -5 || echo "(no clinemm service in user/501)"
echo "--- check whether bootout of the previously-failed entry helps ---"
BO=$(launchctl bootout gui/501 /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools/macos-host-helper/native/helper 2>&1)
BORC=$?
echo "BOOTOUT_RC=$BORC OUTPUT=$BO"
echo "=== BOOTSTRAP_PROBE_2_END ==="
