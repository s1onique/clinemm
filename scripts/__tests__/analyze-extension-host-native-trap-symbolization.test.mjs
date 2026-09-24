#!/usr/bin/env node
// Focused tests for analyze-extension-host-native-trap-symbolization.mjs.
// Validates SYMBOL-01..05 per ACT-CLINEMM-EXTENSION-HOST-NATIVE-TRAP-SYMBOLIZATION01 §15.
//
// P1 bounded correction (no production-code change):
//   - SYMBOL-01: one exact-PC real atos smoke (UUID dwarfdump + 1 atos call).
//   - SYMBOL-02: mismatched-UUID rejection (script halts before any atos).
//   - SYMBOL-03: pure arithmetic assertion (no atos).
//   - SYMBOL-04/05: pure-data assertions over the canonical 1-time artifact.
// Default gate never regenerates 08-faulting-thread-symbolization.json.
// Full 40-frame symbolization remains an explicit operator command.
// Target runtime: <10s, hard ceiling 30s.

import { spawnSync } from "node:child_process"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const REPO = resolve(".")
const IPS = resolve(REPO, ".factory/evidence/ACT-CLINEMM-EXTENSION-HOST-NATIVE-TRAP-SYMBOLIZATION01/VSCodium Helper (Plugin)-2026-09-24-214822.ips")
const BIN = "/Applications/VSCodium.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
const DSYM = "/tmp/electron-dsym/Electron Framework.dSYM/Contents/Resources/DWARF/Electron Framework"
const FRAMES_JSON = resolve(REPO, ".factory/evidence/ACT-CLINEMM-EXTENSION-HOST-NATIVE-TRAP-SYMBOLIZATION01/08-faulting-thread-symbolization.json")
const EXPECTED_UUID = "4c4c445a-5555-3144-a15d-57158a209f31"
const EXPECTED_PC_HEX = "0x11137a01c"
const EXPECTED_BASE_HEX = "0x10bc60000"

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg)
    process.exit(1)
  }
  console.log("ok  -", msg)
}

function lowerUUID(s) { return String(s || "").toLowerCase() }

function readUUID(path) {
  const r = spawnSync("xcrun", ["dwarfdump", "--uuid", path], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`dwarfdump failed: ${r.stderr}`)
  const m = r.stdout.match(/UUID:\s*([0-9A-Fa-f-]+)\s*\(arm64\)/)
  if (!m) throw new Error(`no UUID in: ${r.stdout}`)
  return lowerUUID(m[1])
}

// SYMBOL-03: arithmetic only
{
  const data = JSON.parse(readFileSync(FRAMES_JSON, "utf8"))
  assert(data.computed_offset_decimal === data.frame0_offset_decimal, "SYMBOL-03 computed_offset == frame[0].imageOffset")
  assert(data.computed_offset_decimal === 91332636, "SYMBOL-03 specific value 91332636")
  assert(lowerUUID(data.crash_pc_hex) === EXPECTED_PC_HEX, `SYMBOL-03 crash_pc_hex == ${EXPECTED_PC_HEX}`)
  assert(lowerUUID(data.image2_base_hex) === EXPECTED_BASE_HEX, `SYMBOL-03 image2_base_hex == ${EXPECTED_BASE_HEX}`)
}

// SYMBOL-04: classification discipline (no atos)
{
  const data = JSON.parse(readFileSync(FRAMES_JSON, "utf8"))
  const v1 = data.frames.filter((f) => f.image_index === 2 && f.classification !== "BIND_APPLIED")
  assert(v1.length === 0, "SYMBOL-04 every imageIndex=2 frame has BIND_APPLIED")
  const v2 = data.frames.filter((f) => f.image_index !== 2 && f.classification !== "UNKNOWN_NO_GUESS")
  assert(v2.length === 0, "SYMBOL-04 non-imageIndex=2 frames are UNKNOWN_NO_GUESS")
}

// SYMBOL-05: anonymous frames never guessed (no atos)
{
  const data = JSON.parse(readFileSync(FRAMES_JSON, "utf8"))
  const anon = data.frames.filter((f) => f.image_index === 8)
  assert(anon.length > 0, "SYMBOL-05 imageIndex=8 frames exist")
  for (const f of anon) {
    assert(f.classification === "UNKNOWN_NO_GUESS", `SYMBOL-05 anon frame [${f.index}] UNKNOWN_NO_GUESS`)
    assert(/UNKNOWN|anonymous/i.test(f.atos_symbol), `SYMBOL-05 anon frame [${f.index}] atos does not guess`)
  }
}

// Trap symbol attribution is partition_alloc (no atos)
{
  const data = JSON.parse(readFileSync(FRAMES_JSON, "utf8"))
  const f0 = data.frames[0]
  assert(/partition_alloc::internal::OnNoMemoryInternal/.test(f0.atos_symbol), "Frame 0 atos names OnNoMemoryInternal")
  assert(!/ares_dns_rr_get_ttl/.test(f0.atos_symbol), "Frame 0 is NOT LC_SYMTAB fallback (ares_dns_rr_get_ttl)")
}

// SYMBOL-01: one exact-PC atos smoke
{
  const binUUID = readUUID(BIN)
  const dUUID = readUUID(DSYM)
  assert(binUUID === EXPECTED_UUID, `SYMBOL-01 binary UUID == ${EXPECTED_UUID}`)
  assert(dUUID === EXPECTED_UUID, `SYMBOL-01 dSYM UUID == ${EXPECTED_UUID}`)
  assert(binUUID === dUUID, "SYMBOL-01 binary_uuid == dsym_uuid")
  const r = spawnSync("atos", ["-arch", "arm64", "-o", DSYM, "-l", EXPECTED_BASE_HEX, EXPECTED_PC_HEX], { encoding: "utf8" })
  assert(r.status === 0, `SYMBOL-01 atos status ${r.status}`)
  assert(/partition_alloc::internal::OnNoMemoryInternal/.test(r.stdout), `SYMBOL-01 PC resolves to OnNoMemoryInternal; got: ${r.stdout.slice(0,200)}`)
}

// SYMBOL-02: mismatched-UUID rejection (script halts before any atos)
{
  const otherBin = "/Applications/VSCodium.app/Contents/Resources/app/extensions/git/node_modules/@vscode/fs-copyfile/build/Release/vscode_fs.node"
  const tmp = mkdtempSync(join(tmpdir(), "symbol-02-"))
  try {
    const r = spawnSync("node", [
      "scripts/analyze-extension-host-native-trap-symbolization.mjs",
      "--ips", IPS, "--dsym-dwarf", DSYM, "--binary-path", otherBin, "--out", tmp,
    ], { encoding: "utf8" })
    assert(r.status !== 0, `SYMBOL-02 mismatched UUID rejected (status ${r.status})`)
    assert(/HALT_CRASH_BINARY_UUID_MISMATCH/.test(r.stderr + r.stdout), `SYMBOL-02 explicit halt; tail: ${r.stderr.slice(0,200)}`)
    let wrote = false
    try { readFileSync(join(tmp, "08-faulting-thread-symbolization.json"), "utf8"); wrote = true } catch {}
    assert(!wrote, "SYMBOL-02 halt before any output JSON produced")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

console.log("\nall SYMBOL-01..05 focused tests PASS  (one atos smoke only; <30s)")
