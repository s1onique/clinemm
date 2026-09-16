#!/bin/bash
set -u
echo "=== BOOTSTRAP_PROBE_3_START $(date -u +%FT%TZ) ==="
echo "--- attempt: bootstrap with a real plist file into user/501 ---"
OUT1=$(launchctl bootstrap user/501 /tmp/clinemm-helper-bootstrap-probe/com.clinemm.probe.plist 2>&1)
RC1=$?
echo "USER501_RC=$RC1 OUTPUT=$OUT1"
echo "--- check if probe plist service is registered in user/501 ---"
launchctl print user/501 2>&1 | grep -i 'com.clinemm.probe' | head -5 || echo "(no com.clinemm.probe service in user/501)"
echo "--- attempt: bootstrap with a real plist file into gui/501 ---"
OUT2=$(launchctl bootstrap gui/501 /tmp/clinemm-helper-bootstrap-probe/com.clinemm.probe.plist 2>&1)
RC2=$?
echo "GUI501_RC=$RC2 OUTPUT=$OUT2"
echo "--- check if probe plist service is registered in gui/501 ---"
launchctl print gui/501 2>&1 | grep -i 'com.clinemm.probe' | head -5 || echo "(no com.clinemm.probe service in gui/501)"
echo "=== BOOTSTRAP_PROBE_3_END ==="
