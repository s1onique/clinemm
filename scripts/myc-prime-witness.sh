#!/usr/bin/env zsh
set -euo pipefail

MYC="${MYC:-/Volumes/UserData/Users/chistyakov/.myc/bin/myc}"
MARKER="${MARKER:-MYC-LIVE05-PRIME-WITNESS-$(date +%Y%m%d-%H%M%S)}"
OUT="${TMPDIR:-/tmp}/myc-prime-witness.$$"

die() { print -u2 -- "ERROR: $*"; exit 1; }

[[ -x "$MYC" ]] || die "myc not executable: $MYC"

print -- "== 1. Inspect CLI =="
"$MYC" ready --help || true
"$MYC" --help | rg -n 'task|ready|add|create|open' || true

print
print -- "== 2. Create unique ready witness =="
print -- "MARKER=$MARKER"

if "$MYC" task add --help >/dev/null 2>&1; then
  "$MYC" task add "$MARKER"
elif "$MYC" task create --help >/dev/null 2>&1; then
  "$MYC" task create "$MARKER"
elif "$MYC" create --help >/dev/null 2>&1; then
  "$MYC" create "$MARKER"
elif "$MYC" add --help >/dev/null 2>&1; then
  "$MYC" add "$MARKER"
else
  die "No supported task-creation form auto-detected. Inspect the help above and add the exact creation command to this script."
fi

print
print -- "== READY =="
READY_OUT="$("$MYC" ready)"
print -r -- "$READY_OUT"

print -r -- "$READY_OUT" | grep -F -- "$MARKER" >/dev/null \
  || die "Witness was created but is not visible in 'myc ready'"

print
print -- "== 3. Verify prime contains witness =="
"$MYC" prime | tee "$OUT"

if grep -F -- "$MARKER" "$OUT" >/dev/null; then
  print
  print -- "PASS_PRIME_WITNESS_VISIBLE"
  print -- "MARKER=$MARKER"
  rm -f "$OUT"
  exit 0
fi

print
print -u2 -- "HALT_PRIME_WITNESS_NOT_IN_PRIME"
print -u2 -- "MARKER=$MARKER"
print -u2 -- "prime output preserved at: $OUT"
exit 2
