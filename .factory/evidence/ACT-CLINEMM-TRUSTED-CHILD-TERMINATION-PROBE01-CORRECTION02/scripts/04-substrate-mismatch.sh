#!/bin/bash
echo "=== SUBSTRATE_MISMATCH_PROBE_START $(date -u +%FT%TZ) ==="
echo ""
echo "--- A. THIS shell's launchd context (the spawning substrate) ---"
echo "managername=$(launchctl managername)"
echo "user/501 session line:"
launchctl print user/501 2>&1 | grep -E '^\s+session\s+='
echo "Our pid's launchd context:"
launchctl print pid/$$ 2>&1 | head -25
echo ""
echo "--- B. ALL host-helper processes on this substrate ---"
echo "(filtering to com.clinemm-managed + ad-hoc helper binaries)"
echo ""
echo "B.1 Are there any registered com.clinemm.* services in user/501?"
launchctl print user/501 2>&1 | grep -E '^\s+com\.clinemm' || echo "(none)"
echo ""
echo "B.2 Are there any registered com.clinemm.* services in gui/501?"
launchctl print gui/501 2>&1 | grep -E '^\s+com\.clinemm' || echo "(none)"
echo ""
echo "B.3 Are there any com.clinemm.* plist files in standard LaunchAgent paths?"
find ~/Library/LaunchAgents /Library/LaunchAgents -name 'com.clinemm*' 2>/dev/null || true
find /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools -name '*.plist' 2>/dev/null || echo "(no plist files anywhere under tools/)"
echo ""
echo "B.4 sample helper binary process + its launchd domain"
SAMPLE_PID=$(ps -axo pid,command | awk '$2 ~ /macos-host-helper\/native\/helper$/ && $2 !~ /awk/ {print $1; exit}')
echo "SAMPLE_PID=$SAMPLE_PID"
if [ -n "$SAMPLE_PID" ]; then
  echo "ps:"
  ps -p "$SAMPLE_PID" -o pid,ppid,pgid,sess,command 2>&1
  echo "launchctl print pid/$SAMPLE_PID:"
  launchctl print "pid/$SAMPLE_PID" 2>&1 | head -25
fi
echo ""
echo "B.5 distribution of helper processes by creator"
ps -axo pid,ppid,command | awk '$3 ~ /macos-host-helper\/native\/helper$/ && $3 !~ /awk/' | head -10
echo ""
echo "--- C. Does the helper.c itself document the Background-session limitation? ---"
echo "(helper.c:836-841 setpgid comment)"
sed -n '836,845p' /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools/macos-host-helper/native/helper.c
echo ""
echo "--- D. Our session attribute ---"
echo "ps -o sess= -p \$\$ = $(ps -o sess= -p $$)"
echo ""
echo "=== SUBSTRATE_MISMATCH_PROBE_END ==="
