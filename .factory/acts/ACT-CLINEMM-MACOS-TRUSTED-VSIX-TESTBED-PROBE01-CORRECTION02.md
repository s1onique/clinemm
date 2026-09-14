# ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01-CORRECTION02

> **Verdict in:** HALT_VSIX_TRANSFER_ARGMAX (CORRECTION01 reviewer follow-up)
> **P0 scope:** exactly one — the VSIX transfer seam.
> **Status:** CLOSED_HALTED_CLEAN
> **Result classification:** HALT_BASE_IMAGE_NOT_READY (unchanged — substrate
> residue in this Background session still blocks live Tart qualification)

## 1. Why this ACT exists

The PROBE01/CORRECTION01 transfer was:

```ts
const vsixB64 = readFileSync(args.vsixHostPath).toString("base64")
guestExec(guestIp, `echo '${vsixB64}' | base64 -d > ${guestTmpPath}; ...`)
```

That puts the entire VSIX (inflated by ~33%) into a single SSH command
string. The runner allows VSIX files up to **256 MiB**; base64 of 256 MiB is
~341 MiB of command text. Local process argv and SSH channel command-length
limits bite first, before the file ever reaches the guest.

This is not a performance issue. It is a real-artifact transfer failure
that happens before any SHA verification is meaningful:

```text
host VSIX
→ base64 inflate
→ argv of ssh
→ ssh command-line buffer
→ ssh channel
→ remote shell decode
→ guest bytes
```

The invariant CORRECTION02 enforces:

```text
host VSIX
→ ssh stdin (byte stream)
→ remote 'cat > /tmp/foo.vsix'
→ guest bytes
```

Bytes travel as a stream, never as command text.

## 2. Bounded fix

Replace the inline-base64 path with a single-purpose helper
`scpVsixToGuest()` that uses Bun.spawn with `stdin: bun.file(hostPath)`:

```ts
const proc = spawn({
  cmd: [
    "ssh",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    `admin@${guestIp}`,
    `set -e; umask 077; mkdir -p /tmp/clinemm-testbed-staging; cat > ${guestTmpPath}`,
  ],
  stdin: await Bun.file(hostPath).arrayBuffer().then(b => b),  // raw bytes
  stdout: "pipe",
  stderr: "pipe",
})
```

Then shasum-verify on the guest. SHA on host and SHA on guest must
match before the testbed continues to installation.

The activation witness, image digest, bounded-lifecycle, and host-helper
protocol are NOT re-opened. Re-opening them was explicitly forbidden by
the reviewer.

## 3. Discrimination

Add a synthetic 16-MiB fixture transfer test in
`tools/macos-vsix-testbed/guest-smoke.test.ts` (new file). It:

1. Creates a 16 MiB file of zeros under a temp dir.
2. Spawns `scpVsixToGuest()` against a LOCAL `nc -l 12345` listener
   that captures bytes received on stdin.
3. Asserts:
   - input file size == captured bytes (no truncation)
   - input file sha256 == captured bytes sha256 (no corruption)
   - ssh argv (proc.argv) does NOT contain ANY of the input bytes
     (proves bytes travel via stdin, not command text)

If the test passes on a developer Mac, the transfer seam is honest.

## 4. Acceptance criteria

| # | Criterion | Evidence file |
|---|-----------|---------------|
| 1 | `scpVsixToGuest()` implemented using Bun.spawn stdin pipe | `02-corrections.txt` |
| 2 | Inline base64 path removed from guest-smoke.ts | `02-corrections.txt` diff |
| 3 | New `guest-smoke.test.ts` with 16-MiB transfer discrimination | `06-large-file-test.txt` |
| 4 | Bun test suite green (133+ pass) | `10-gates.txt` |
| 5 | `tsc --noEmit` clean | `10-gates.txt` |
| 6 | `git diff --check` clean | `10-gates.txt` |
| 7 | Live Tart qualification still BLOCKED by substrate residue | `result.json` |

## 5. Nonblocking notes (acknowledged, NOT re-opened)

- Activation witness: structurally green per CORRECTION01.
- Image digest: structurally green per CORRECTION01.
- Bounded helper lifecycle: structurally green per CORRECTION01.
- Host-helper protocol: structurally green per PROBE01.

These are NOT re-reviewed here. They will not be re-reviewed until the
testbed can run live in the guest. That is the correct halt state.

## 6. Reopen condition for CORRECTION03

Live Tart VM with this exact transfer seam:
- `REAL_VSIX_SIZE` recorded
- `TRANSFER_METHOD` = `ssh_stdin_stream`
- `HOST_SHA256 == GUEST_SHA256` for the actual dogfood VSIX

If the live run completes, CORRECTION03 closes the testbed.
