# Operator qualification -- ACT-CLINEMM-HOST-HELPER-BOUNDED-REQUEST-LIFECYCLE01

Run this from an **ordinary, unsandboxed Terminal** (the ClineMM
Background Exec Seatbelt context cannot write the install directory,
cannot reach the production socket, and cannot signal processes).

Prerequisites: `bun` on `PATH`, the repository checked out at
`757da08801a1b14bb87ebcd410e967eccb34b030`, and the working tree clean.

---

## 0. Constants (do not edit -- these are the committed identities)

```bash
REPO=/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
LABEL=io.clinemm.host-helper
DOMAIN="gui/$(id -u)"
INSTALL_DIR="$HOME/.clinemm/bin"
INSTALL_PATH="$INSTALL_DIR/clinemm-host-helper"
SOCKET="$HOME/.clinemm/host-helper.sock"
ARTIFACT="$REPO/tools/macos-host-helper/native/helper"

# The build_id is DERIVED FROM THE COMMITTED SOURCE BYTES and is therefore
# stable across rebuilds. It is the authoritative artifact identity.
EXPECT_BUILD_ID=585ef8cb29cb2cff695a090c5c81c7cab4958e07f6e7383cf40da0613e958052

# The binary SHA-256 is NOT byte-reproducible: `codesign -s -` embeds a
# per-signing identifier, so every rebuild produces a different SHA-256
# from identical source. (This is the PRE-EXISTING build mechanism's
# behaviour, unchanged by this ACT.) Therefore:
#   * capture the SHA-256 of the artifact you are ABOUT to install, and
#   * verify THAT value after the install.
# Do NOT treat any hard-coded SHA as a gate.
EXPECT_SIZE=106896

# The previously verified (known-good) binary, for bounded rollback.
ROLLBACK_SHA256=ccd5257402745b4e8940dda9a5d020f09984063aea26ca5c1561a4b492d6366c
```

---

## 1. Reap the ACT-owned orphan test helpers

These are the isolated helper instances spawned by the ACT's test
fixture. The sandbox could not signal them, so they are PPID-1
orphans. They hold **no** production socket. The command line below is
**exact** and cannot match the installed service (whose path is
`$HOME/.clinemm/bin/clinemm-host-helper`, not the repo tree).

```bash
echo "before: $(pgrep -f "$REPO/tools/macos-host-helper/native/helper" | wc -l | tr -d ' ')"
pkill -TERM -f "$REPO/tools/macos-host-helper/native/helper" || true
sleep 1
pkill -KILL -f "$REPO/tools/macos-host-helper/native/helper" || true
sleep 1
echo "after:  $(pgrep -f "$REPO/tools/macos-host-helper/native/helper" | wc -l | tr -d ' ')"

# The installed service must be UNTOUCHED:
echo "installed pid: $(pgrep -f "$INSTALL_PATH" | tr '\n' ' ')"
```

Expected: `before: ~334`, `after: 0`, and the installed PID still
present.

Also remove the (already-deleted-by-watchdog) fixture directories if any
remain:

```bash
rm -rf /tmp/clinemm-helper-lifecycle-* 2>/dev/null || true
rm -f  /tmp/clinemm-watchdog-probe-*.bin 2>/dev/null || true
```

---

## 2. Pre-deployment checks

```bash
echo "== current pid =="
pgrep -f "$INSTALL_PATH" | while read -r p; do ps -o pid=,lstart=,command= -p "$p"; done

echo "== current binary identity =="
shasum -a 256 "$INSTALL_PATH"
codesign -dvv "$INSTALL_PATH" 2>&1 | grep -E 'Identifier|Signature'
codesign --verify --strict "$INSTALL_PATH" && echo CODESIGN_OK
strings "$INSTALL_PATH" | grep -oE '[0-9a-f]{64}' | head -1

echo "== launchd state =="
launchctl print "$DOMAIN/$LABEL" | grep -E 'state =|pid =|path ='

echo "== socket =="
ls -l "$SOCKET"          # expect srw------- (0600)
lsof "$SOCKET"           # expect exactly ONE holder: the installed helper

echo "== helper-owned jobs (must be empty for a safe swap) =="
ps -o pid=,pgid=,command= -ax | grep -i tart | grep -v grep || echo "no tart VM"
```

**Gate:** if a legitimate helper-owned Tart VM / registered process
group IS active, obtain operator authorization before replacing, because
a replacement discards in-memory capability state.

**Gate:** record the current binary SHA-256. It must equal
`ROLLBACK_SHA256` (`ccd52574...`) for the rollback path below to be
available. If it differs, stop and record the discrepancy.

---

## 3. Build the exact committed artifact

The native binary must be built from the committed source HEAD.

```bash
cd "$REPO"
git rev-parse HEAD
# expect: 757da08801a1b14bb87ebcd410e967eccb34b030
git status --short          # expect: clean (or only untracked build sentinels)

cd "$REPO/tools/macos-host-helper/native"
./build.sh 2>&1 | grep -E 'embedded build_id|codesign --verify --strict PASS|post-rename|compiled'

# Verify the artifact identity
shasum -a 256 helper
codesign -dvv helper 2>&1 | grep -E 'Identifier|Signature'
codesign --verify --strict helper && echo CODESIGN_OK

# The build_id must equal the expected committed value
shasum -a 256 helper | awk '{print $1}'
```

**Gate:** the embedded build_id printed by `build.sh` MUST be
`EXPECT_BUILD_ID` (`585ef8cb...`). This value is derived from the
committed source bytes, so it is the authoritative check that the
artifact was built from the committed source. A different build_id
means the working tree is not at the committed source; stop.

Record the artifact SHA-256 for the install step:

```bash
ARTIFACT_SHA=$(shasum -a 256 "$ARTIFACT" | awk '{print $1}')
echo "ARTIFACT_SHA256=$ARTIFACT_SHA"
```

---

## 4. Install (atomic, same destination, same label)

Preserve the previous known-good binary for the bounded rollback, then
install through the established atomic mechanism.

```bash
# Preserve the known-good binary for rollback.
cp -p "$INSTALL_PATH" "$INSTALL_DIR/clinemm-host-helper.rollback-ccd52574"

# Install the freshly built artifact atomically (same filesystem, so
# rename(2) is atomic). The helper binary is re-signed with the
# canonical Identifier by build.sh, so its signature travels with it.
cp "$ARTIFACT" "$INSTALL_DIR/.clinemm-host-helper.new.$$"
chmod 0755 "$INSTALL_DIR/.clinemm-host-helper.new.$$"
codesign --verify --strict "$INSTALL_DIR/.clinemm-host-helper.new.$$" \
  && echo "new artifact CODESIGN_OK"
mv -f "$INSTALL_DIR/.clinemm-host-helper.new.$$" "$INSTALL_PATH"

# Verify the INSTALLED artifact (not the repo copy).
codesign --verify --strict "$INSTALL_PATH" && echo "installed CODESIGN_OK"
INSTALLED_SHA=$(shasum -a 256 "$INSTALL_PATH" | awk '{print $1}')
echo "INSTALLED_SHA256=$INSTALLED_SHA"
codesign -dvv "$INSTALL_PATH" 2>&1 | grep Identifier
```

**Gate:** the installed SHA-256 MUST equal `$ARTIFACT_SHA` captured in
section 3 (the binary is copied byte-for-byte, so it must match
exactly). If it does not, restore from the rollback copy and stop.

**Do NOT** touch the plist. The label, the socket path, the socket mode
(`SockPathMode 384` = 0600), the user-level privilege boundary and the
`launch_activate_socket("Listener")` wiring are all unchanged.

---

## 5. Activate (restart ONLY the named service)

```bash
launchctl kickstart -kp "$DOMAIN/$LABEL"
sleep 1
launchctl print "$DOMAIN/$LABEL" | grep -E 'state =|pid ='
```

**Do NOT** run `launchctl bootstrap` or `launchctl bootout`, and do not
remove the GUI/user domain.

**Gate:** `state = running` and a **new** PID (different from the
recorded pre-deployment PID).

**If the helper remains inaccessible, do NOT repeatedly restart it.**
Stop, preserve the logs and the exit status, and go to section 7.

---

## 6. Installed health qualification

Use an INDEPENDENT, bounded AF_UNIX client. The helper's socket is
user-only (0600), so this must run as the same user.

```bash
cat > /tmp/clinemm-health-probe.ts <<'EOF'
import { createConnection } from "node:net";
const SOCK = process.env.CLINEMM_SOCK!;
const started = Date.now();
await new Promise<void>((resolve) => {
  let buf = "";
  const timer = setTimeout(() => {
    console.log("HEALTH=TIMEOUT elapsed_ms=" + (Date.now() - started));
    resolve();
  }, 5000);
  const s = createConnection(SOCK, () => {
    s.write(
      JSON.stringify({
        version: 1,
        request_id: "operator-health-1",
        method: "health",
      }) + "\n",
    );
  });
  s.on("data", (c) => {
    buf += c.toString();
    const i = buf.indexOf("\n");
    if (i >= 0) {
      clearTimeout(timer);
      console.log("HEALTH=OK elapsed_ms=" + (Date.now() - started));
      console.log("RESPONSE=" + buf.slice(0, i));
      resolve();
    }
  });
  s.on("error", (e: any) => {
    clearTimeout(timer);
    console.log("HEALTH=ERROR " + e.code + " elapsed_ms=" + (Date.now() - started));
    resolve();
  });
});
process.exit(0);
EOF

CLINEMM_SOCK="$SOCKET" bun /tmp/clinemm-health-probe.ts
```

**Gate:** `HEALTH=OK` within the 5 s bound, and the response must have
`"ok":true`, `"request_id":"operator-health-1"`,
`"service":"clinemm-host-helper"`, and
`"build_id":"585ef8cb29cb2cff695a090c5c81c7cab4958e07f6e7383cf40da0613e958052"`.

Then confirm the service identity:

```bash
launchctl print "$DOMAIN/$LABEL" | grep -E 'state =|pid ='
ls -l "$SOCKET"            # expect srw------- (0600)
lsof "$SOCKET"             # expect exactly ONE holder, the NEW pid
```

---

## 7. Live adversarial qualification (OPTIONAL, operator approval)

Only after section 6 passes. Run ONE controlled partial-frame test with
an independent watchdog. Do not issue an unlimited number of retries.

```bash
cat > /tmp/clinemm-live-adversarial.ts <<'EOF'
import { createConnection } from "node:net";
const SOCK = process.env.CLINEMM_SOCK!;

// --- Client A: incomplete frame, stays open.
const a = createConnection(SOCK, () => {
  a.write('{"version":1,"request_id":"live-a","method":"heal');
});
let aClosed = false;
a.on("close", () => { aClosed = true; });
a.on("error", () => { aClosed = true; });

// --- Client B: complete health request, bounded wait.
const bResult = await new Promise<string>((resolve) => {
  let buf = "";
  const t = setTimeout(() => resolve("TIMEOUT"), 10000);
  const b = createConnection(SOCK, () => {
    b.write(
      JSON.stringify({
        version: 1,
        request_id: "live-b-health",
        method: "health",
      }) + "\n",
    );
  });
  b.on("data", (c) => {
    buf += c.toString();
    const i = buf.indexOf("\n");
    if (i >= 0) { clearTimeout(t); resolve(buf.slice(0, i)); }
  });
  b.on("error", () => { clearTimeout(t); resolve("ERROR"); });
});

console.log("A_CLOSED_BY_DEADLINE=" + aClosed);
console.log("B_RESPONSE=" + bResult);
process.exit(0);
EOF

CLINEMM_SOCK="$SOCKET" bun /tmp/clinemm-live-adversarial.ts

# The helper must be the SAME process and must still be healthy.
launchctl print "$DOMAIN/$LABEL" | grep -E 'state =|pid ='
CLINEMM_SOCK="$SOCKET" bun /tmp/clinemm-health-probe.ts
```

**Expected:** `A_CLOSED_BY_DEADLINE=true` (A is closed at the helper's
2000 ms receive deadline), `B_RESPONSE` is a valid correlated health
envelope, the launchd PID is **unchanged**, and the follow-up health
probe succeeds.

**If this fails:** stop immediately, preserve the diagnostics, and go to
section 8.

---

## 8. Rollback

If the new installed helper cannot complete health qualification:

1. Preserve the logs, the exit status, the service PID and the binary
   identity:
   ```bash
   tail -50 "$HOME/Library/Logs/clinemm-host-helper.log"
   launchctl print "$DOMAIN/$LABEL" | grep -E 'state =|pid ='
   shasum -a 256 "$INSTALL_PATH"
   ```
2. **Stop issuing probe requests.**
3. Classify the failure: installation, code-signature, launchd
   activation, or runtime transport.
4. Restore the previously verified binary through the established
   atomic installation mechanism:
   ```bash
   cp "$INSTALL_DIR/clinemm-host-helper.rollback-ccd52574" \
      "$INSTALL_DIR/.clinemm-host-helper.restore.$$"
   chmod 0755 "$INSTALL_DIR/.clinemm-host-helper.restore.$$"
   codesign --verify --strict "$INSTALL_DIR/.clinemm-host-helper.restore.$$"
   mv -f "$INSTALL_DIR/.clinemm-host-helper.restore.$$" "$INSTALL_PATH"
   codesign --verify --strict "$INSTALL_PATH"
   shasum -a 256 "$INSTALL_PATH"   # expect ROLLBACK_SHA256
   ```
5. Restart **only** the named service:
   ```bash
   launchctl kickstart -kp "$DOMAIN/$LABEL"
   sleep 1
   launchctl print "$DOMAIN/$LABEL" | grep -E 'state =|pid ='
   ```
6. Verify the restored artifact identity and health:
   ```bash
   shasum -a 256 "$INSTALL_PATH"
   CLINEMM_SOCK="$SOCKET" bun /tmp/clinemm-health-probe.ts
   ```

**Note:** the restored binary is the PRE-REPAIR one. It will serve
health again, but the wedge can recur. If a safe rollback cannot be
completed, report `HALT_HELPER_ROLLBACK_UNAVAILABLE` and preserve the
exact recovery requirement.

**Do NOT revert the source commit because an installation operation
failed.** The source commit is the repair; the installation is the
deployment.

---

## 9. Residue check

```bash
echo "== orphan isolated test helpers (expect 0) =="
pgrep -f "$REPO/tools/macos-host-helper/native/helper" | wc -l

echo "== installed service (expect exactly 1) =="
pgrep -f "$INSTALL_PATH"

echo "== socket holders (expect exactly 1) =="
lsof "$SOCKET" | tail -n +2 | wc -l

echo "== fixture dirs (expect none) =="
ls -d /tmp/clinemm-helper-lifecycle-* 2>/dev/null || echo none
```

Record the final identity:

```text
FINAL_HEAD
FINAL_TREE
HELPER_BUILD_ID
HELPER_BINARY_PATH
HELPER_BINARY_BYTES
HELPER_BINARY_SHA256
HELPER_CODESIGN_IDENTIFIER
HELPER_CODESIGN_VERIFY
LAUNCHAGENT_PLIST_SHA256
INSTALLED_HELPER_PID
INSTALLED_HELPER_BUILD_ID
INSTALLED_HELPER_SHA256
INSTALLED_HEALTH_RESULT
NEW_ORPHAN_PROCESSES
```
