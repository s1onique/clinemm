#!/bin/bash
# =============================================================================
# ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01
# Bounded operator qualification — PREFLIGHT ONLY.
#
# This script is intentionally staged. It does NOT launch the production
# GREEN, foreign-target, PGID, or Vitest fixtures. Those measurements must
# be issued from the installed ClineMM Background Exec path so the exact
# production Seatbelt seam is exercised. The runbook describes each stage.
#
# Usage:
#   bash operator-qualification.sh preflight
#   bash operator-qualification.sh install
#   bash operator-qualification.sh identity
#   bash operator-qualification.sh foreign-start
#   bash operator-qualification.sh foreign-stop
#   bash operator-qualification.sh collect
#
# Exit status:
#   0  requested stage completed
#   2  safety / identity preflight failed (no fixture was launched)
#   3  malformed arguments or missing prerequisite
# =============================================================================
set -euo pipefail

REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
EVID="$REPO/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01"
RAW="$EVID/raw"
FIX="$EVID/probe-fixtures"
PRODUCTION_FIX="$REPO/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01/probe-fixtures"
VSC="/Volumes/UserData/Users/chistyakov/.vscodium-clinemm"
USER_DATA="$VSC/user-data"
EXTENSIONS="$VSC/extensions"
CODIUM="/Applications/VSCodium.app/Contents/Resources/app/bin/codium"
VSIX="$REPO/dist/clinemm-signal-repair01.vsix"
BUNDLE_SHA_EXPECTED="e35de822bec46b697fad7e651206d73124796b2179c2e6a25a083adced6a8a66"
NODE="/opt/homebrew/bin/node"
OBSERVER_RUN_ID="repair01-qualification"
OBSERVER_FILE="$HOME/.cline/data/sandbox-diag/${OBSERVER_RUN_ID}.jsonl"
FOREIGN_LOG="$RAW/foreign-target.log"
FOREIGN_PID_FILE="$RAW/foreign-target.pid"
FOREIGN_LSTART_FILE="$RAW/foreign-target.lstart"
FOREIGN_ARGV_FILE="$RAW/foreign-target.argv"

mkdir -p "$RAW"

note() { printf '[repair01] %s\n' "$*"; }
fail() { note "ABORT: $*" >&2; exit 2; }
require_file() { [ -f "$1" ] || fail "required file missing: $1"; }
require_dir() { [ -d "$1" ] || fail "required directory missing: $1"; }

installed_bundle() {
	find "$EXTENSIONS" -maxdepth 3 -path '*/s1onique.clinemm-*/dist/extension.js' -type f -print 2>/dev/null | sort | tail -1
}

# Find ONLY the dogfood VSCodium main process and its Plugin extension host.
# Never use an application-wide quit, a generic extension-host pattern, or a
# process-count heuristic.
dogfood_main_pid() {
	ps -Ao pid=,command= | awk -v u="$USER_DATA" '$0 ~ /\/Applications\/VSCodium\.app\/Contents\/MacOS\/VSCodium/ && index($0, u) { print $1; exit }'
}

dogfood_extension_host_pid() {
	local main_pid="$1"
	ps -Ao pid=,ppid=,command= | awk -v p="$main_pid" '$2 == p && /VSCodium Helper \(Plugin\)/ && /node\.mojom\.NodeService/ { print $1; exit }'
}

read_argv() {
	ps -o command= -p "$1" 2>/dev/null | sed 's/^ *//'
}

read_lstart() {
	ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'
}

read_uid() {
	ps -o uid= -p "$1" 2>/dev/null | tr -d ' '
}

process_state() {
	# EPERM is existence-without-signal-authority, NOT absence. `ps` is the
	# authoritative observation fallback because it can read the process table
	# without signal permission.
	local out rc
	out="$(kill -0 "$1" 2>&1)" && { echo ALIVE; return 0; }
	rc=$?
	if printf '%s' "$out" | grep -qiE 'no such process|not exist'; then
		echo GONE
		return 0
	fi
	if [ -n "$(read_argv "$1")" ]; then
		echo UNVERIFIABLE
	else
		echo GONE
	fi
}

preflight() {
	require_file "$VSIX"
	require_file "$PRODUCTION_FIX/same-sandbox-probe.mjs"
	require_file "$FIX/pgid-cancellation-fixture.mjs"
	require_file "$FIX/foreign-target-fixture.mjs"
	require_file "$FIX/foreign-signal-attempt.mjs"
	require_file "$CODIUM"
	require_dir "$USER_DATA"
	require_dir "$EXTENSIONS"

	local main_pid host_pid host_uid operator_uid
	main_pid="$(dogfood_main_pid || true)"
	[ -n "$main_pid" ] || fail "dogfood VSCodium main process not found for $USER_DATA"
	host_pid="$(dogfood_extension_host_pid "$main_pid" || true)"
	[ -n "$host_pid" ] || fail "dogfood VSCodium Plugin extension host not found for main pid $main_pid"

	host_uid="$(read_uid "$host_pid" || true)"
	operator_uid="$(id -u)"
	[ -n "$host_uid" ] || fail "could not read dogfood extension-host uid"
	[ "$host_uid" = "$operator_uid" ] || fail "dogfood extension host uid $host_uid != operator uid $operator_uid"

	{
		echo "DOGFOOD_MAIN_PID=$main_pid"
		echo "DOGFOOD_EXTENSION_HOST_PID=$host_pid"
		echo "DOGFOOD_EXTENSION_HOST_UID=$host_uid"
		echo "OPERATOR_UID=$operator_uid"
		echo "DOGFOOD_USER_DATA=$USER_DATA"
		echo "DOGFOOD_EXTENSIONS=$EXTENSIONS"
		echo "DOGFOOD_EXTENSION_HOST_ARGV=$(read_argv "$host_pid")"
	} > "$RAW/dogfood-instance-identity.txt"

	note "preflight PASS: dogfood main=$main_pid extension-host=$host_pid"
}

install() {
	preflight
	local before after sha
	before="$(installed_bundle || true)"
	note "installing $VSIX into dogfood extension directory only"
	"$CODIUM" --install-extension "$VSIX" --force \
		--user-data-dir "$USER_DATA" --extensions-dir "$EXTENSIONS"
	after="$(installed_bundle || true)"
	[ -n "$after" ] || fail "no installed ClineMM bundle found after install"
	sha="$(shasum -a 256 "$after" | awk '{print $1}')"
	[ "$sha" = "$BUNDLE_SHA_EXPECTED" ] || fail "installed bundle sha256 $sha != expected $BUNDLE_SHA_EXPECTED"
	grep -q '(allow signal (target same-sandbox))' "$after" || fail "installed bundle lacks same-sandbox rule"
	if grep -q 'CLINEMM_DIAG_SAME_SANDBOX_SIGNAL' "$after"; then
		fail "installed bundle still contains the retired diagnostic gate"
	fi
	{
		echo "INSTALLED_BUNDLE=$after"
		echo "INSTALLED_BUNDLE_SHA256=$sha"
		echo "PREVIOUS_BUNDLE=${before:-none}"
		echo "VSIX=$VSIX"
		echo "VSIX_SHA256=$(shasum -a 256 "$VSIX" | awk '{print $1}')"
	} > "$RAW/installed-bundle-identity.txt"
	note "install PASS: $after"
}

identity() {
	preflight
	local bundle sha main_pid host_pid
	bundle="$(installed_bundle || true)"
	[ -n "$bundle" ] || fail "no installed ClineMM bundle found"
	sha="$(shasum -a 256 "$bundle" | awk '{print $1}')"
	[ "$sha" = "$BUNDLE_SHA_EXPECTED" ] || fail "installed bundle sha256 $sha != expected $BUNDLE_SHA_EXPECTED"
	grep -q '(allow signal (target same-sandbox))' "$bundle" || fail "installed bundle lacks same-sandbox rule"
	if grep -q 'CLINEMM_DIAG_SAME_SANDBOX_SIGNAL' "$bundle"; then
		fail "installed bundle still contains the retired diagnostic gate"
	fi
	main_pid="$(dogfood_main_pid)"
	host_pid="$(dogfood_extension_host_pid "$main_pid")"
	ps -Eww -p "$host_pid" | tr ' ' '\n' | grep -qx 'CLINEMM_CAPTURE_SANDBOX=1' \
		|| fail "dogfood extension host does not carry CLINEMM_CAPTURE_SANDBOX=1"
	ps -Eww -p "$host_pid" | tr ' ' '\n' | grep -qx "CLINEMM_CAPTURE_SANDBOX_RUN_ID=$OBSERVER_RUN_ID" \
		|| fail "dogfood extension host observer run id is not $OBSERVER_RUN_ID"
	{
		echo "INSTALLED_BUNDLE=$bundle"
		echo "INSTALLED_BUNDLE_SHA256=$sha"
		echo "DOGFOOD_MAIN_PID=$main_pid"
		echo "DOGFOOD_EXTENSION_HOST_PID=$host_pid"
		echo "OBSERVER_RUN_ID=$OBSERVER_RUN_ID"
		echo "OBSERVER_FILE=$OBSERVER_FILE"
	} > "$RAW/qualified-instance-identity.txt"
	note "identity PASS: exact bundle and observer-enabled dogfood extension host"
}

foreign_start() {
	require_file "$FIX/foreign-target-fixture.mjs"
	[ -f "$FOREIGN_PID_FILE" ] && fail "foreign target already exists; run foreign-stop first"
	rm -f "$FOREIGN_LOG"
	"$NODE" "$FIX/foreign-target-fixture.mjs" "$FOREIGN_LOG" >/dev/null 2>&1 &
	local pid=$!
	printf '%s\n' "$pid" > "$FOREIGN_PID_FILE"
	local i
	for i in $(seq 1 100); do
		grep -q '^FOREIGN_READY pid=[0-9][0-9]* ppid=[0-9][0-9]* marker=CLINEMM_REPAIR01_FOREIGN_TARGET$' "$FOREIGN_LOG" 2>/dev/null && break
		sleep 0.05
	done
	grep -q '^FOREIGN_READY ' "$FOREIGN_LOG" 2>/dev/null || fail "foreign target did not become ready"
	local actual
	actual="$(sed -nE 's/^FOREIGN_READY pid=([0-9]+) ppid=[0-9]+ marker=CLINEMM_REPAIR01_FOREIGN_TARGET$/\1/p' "$FOREIGN_LOG" | head -1)"
	[ -n "$actual" ] || fail "could not parse foreign target pid"
	[ "$actual" = "$pid" ] || fail "foreign marker pid $actual != supervisor-recorded pid $pid"
	read_lstart "$pid" > "$FOREIGN_LSTART_FILE"
	read_argv "$pid" > "$FOREIGN_ARGV_FILE"
	[ -s "$FOREIGN_LSTART_FILE" ] || fail "could not capture foreign target start identity"
	grep -q "$FIX/foreign-target-fixture.mjs" "$FOREIGN_ARGV_FILE" || fail "foreign target argv identity mismatch"
	note "foreign target started: pid=$pid (finite 12s lifetime)"
}

foreign_stop() {
	[ -f "$FOREIGN_PID_FILE" ] || fail "no foreign target pid file"
	local pid state
	pid="$(cat "$FOREIGN_PID_FILE")"
	[ "$pid" -gt 1 ] 2>/dev/null || fail "invalid foreign target pid"
	state="$(process_state "$pid")"
	if [ "$state" = "ALIVE" ]; then
		local current_lstart current_argv expected_lstart expected_argv
		expected_lstart="$(cat "$FOREIGN_LSTART_FILE" 2>/dev/null || true)"
		expected_argv="$(cat "$FOREIGN_ARGV_FILE" 2>/dev/null || true)"
		current_lstart="$(read_lstart "$pid")"
		current_argv="$(read_argv "$pid")"
		[ -n "$current_lstart" ] && [ "$current_lstart" = "$expected_lstart" ] || fail "foreign target start identity changed; refusing to signal"
		[ -n "$current_argv" ] && [ "$current_argv" = "$expected_argv" ] || fail "foreign target argv changed; refusing to signal"
		kill -TERM "$pid" 2>/dev/null || true
		for i in $(seq 1 60); do
			[ "$(process_state "$pid")" = "GONE" ] && break
			sleep 0.05
		done
	fi
	state="$(process_state "$pid")"
	[ "$state" = "GONE" ] || fail "foreign target was not verifiably gone (state=$state)"
	rm -f "$FOREIGN_PID_FILE" "$FOREIGN_LSTART_FILE" "$FOREIGN_ARGV_FILE"
	note "foreign target cleanup PASS: pid=$pid is gone"
}

collect() {
	require_file "$OBSERVER_FILE"
	cp "$OBSERVER_FILE" "$RAW/observer-$OBSERVER_RUN_ID.jsonl"
	shasum -a 256 "$RAW/observer-$OBSERVER_RUN_ID.jsonl" > "$RAW/observer-$OBSERVER_RUN_ID.sha256"
	note "observer stream collected to $RAW/observer-$OBSERVER_RUN_ID.jsonl"
}

case "${1:-}" in
	preflight) preflight ;;
	install) install ;;
	identity) identity ;;
	foreign-start) foreign_start ;;
	foreign-stop) foreign_stop ;;
	collect) collect ;;
	*) note "usage: $0 {preflight|install|identity|foreign-start|foreign-stop|collect}" >&2; exit 3 ;;
esac
