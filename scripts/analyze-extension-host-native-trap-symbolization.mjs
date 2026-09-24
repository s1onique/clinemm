#!/usr/bin/env node
/**
 * ACT-CLINEMM-EXTENSION-HOST-NATIVE-TRAP-SYMBOLIZATION01
 *
 * Per-frame symbolization of an Apple .ips crash with a UUID-matched
 * dSYM. Only imageIndex=2 frames are bound to atos; everything else is
 * reported UNKNOWN (never guessed). See ACT sections 5, 7, 8, 15 for
 * the SYMBOL-01..05 invariants.
 */
import { writeFile, mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { argv, exit } from "node:process"
import { readFileSync } from "node:fs"

const MAX_FRAMES = 40

function parseArgs(args) {
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith("--")) continue
    if (i + 1 >= args.length) break
    out[a.slice(2)] = args[i + 1]
    i++
  }
  return out
}

function die(msg, code = 4) {
  console.error(`FATAL: ${msg}`)
  exit(code)
}

function readIpsBody(ipsPath) {
  const lines = readFileSync(ipsPath, "utf8").split("\n")
  if (lines.length < 2) die(`unrecognized .ips format: ${ipsPath}`)
  let bodyStart = 1
  while (bodyStart < lines.length && lines[bodyStart].trim() === "") bodyStart++
  try {
    return JSON.parse(lines.slice(bodyStart).join("\n"))
  } catch (e) {
    die(`unparseable .ips body: ${e.message}`)
  }
}

function lowerUUID(u) {
  return String(u || "").toLowerCase()
}

function readUUID(p) {
  const r = spawnSync("xcrun", ["dwarfdump", "--uuid", p], { encoding: "utf8" })
  if (r.status !== 0) die(`dwarfdump failed for ${p}: ${r.stderr}`)
  const m = r.stdout.match(/UUID:\s*([0-9A-Fa-f-]+)\s*\(arm64\)/)
  if (!m) die(`could not parse uuid from: ${r.stdout}`)
  return lowerUUID(m[1])
}

function atos(binaryPath, baseHex, addrHex) {
  const r = spawnSync(
    "atos",
    ["-arch", "arm64", "-o", binaryPath, "-l", baseHex, addrHex],
    { encoding: "utf8" },
  )
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() }
}

async function main() {
  const args = parseArgs(argv.slice(2))
  if (!args.ips || !args["dsym-dwarf"] || !args["binary-path"] || !args.out)
    die("usage: --ips <ips> --dsym-dwarf <dwarf> --binary-path <binary> --out <dir>")

  const ipsPath = resolve(args.ips)
  const dsymDwarf = resolve(args["dsym-dwarf"])
  const binaryPath = resolve(args["binary-path"])
  const outDir = resolve(args.out)

  const body = readIpsBody(ipsPath)
  const ft = body.faultingThread
  if (ft !== 0) die(`only faultingThread=0 supported; got ${ft}`)

  // imageIndex in .ips frames refers to the position in usedImages array
  const images = body.usedImages || []
  const im2 = images[2]
  if (!im2) die("usedImages[2] (Electron Framework) not present")

  const dsymUUID = readUUID(dsymDwarf)
  const binUUID = readUUID(binaryPath)
  if (lowerUUID(im2.uuid) !== dsymUUID)
    die(`HALT_DSYM_UUID_MISMATCH crash=${im2.uuid} dsym=${dsymUUID}`)
  if (lowerUUID(im2.uuid) !== binUUID)
    die(`HALT_CRASH_BINARY_UUID_MISMATCH crash=${im2.uuid} bin=${binUUID}`)

  const baseImg2 = Number(im2.base)
  const pcDecimal = body.exception.rawCodes[1]
  const computedOffset = pcDecimal - baseImg2

  const frames = body.threads[ft].frames || []
  const frame0Offset = frames[0] ? Number(frames[0].imageOffset) : -1
  if (computedOffset !== frame0Offset)
    die(`HALT_CRASH_PC_IMAGE_BINDING_MISMATCH computed=${computedOffset} reported=${frame0Offset}`)

  const baseImg2Hex = "0x" + baseImg2.toString(16)
  const pcHex = "0x" + pcDecimal.toString(16)

  const limit = Math.min(frames.length, MAX_FRAMES)
  const symFrames = []
  for (let i = 0; i < limit; i++) {
    const fr = frames[i]
    const ii = fr.imageIndex
    const io = Number(fr.imageOffset)
    const ip = images[ii]
    let base, atosOut
    if (ii === 2) {
      base = baseImg2
      // atos must be called with the dSYM dwarf object, NOT the runtime binary
      // (runtime Electron binary has stripped DWARF; only LC_SYMTAB remains).
      atosOut = atos(dsymDwarf, baseImg2Hex, "0x" + (base + io).toString(16))
    } else if (ii === 8 || ip == null) {
      base = 0
      atosOut = { status: -1, stdout: `UNKNOWN: imageIndex=${ii} (anonymous / unbound)`, stderr: "" }
    } else {
      base = Number(ip.base)
      atosOut = { status: -1, stdout: `UNKNOWN: imageIndex=${ii} (${ip.name}) not bound to Electron dSYM`, stderr: "" }
    }
    symFrames.push({
      index: i,
      image_index: ii,
      image_name: (ip && ip.name) || null,
      image_offset_decimal: io,
      image_offset_hex: "0x" + io.toString(16),
      base_used_decimal: base,
      absolute_address_decimal: base + io,
      absolute_address_hex: "0x" + (base + io).toString(16),
      ips_symbol: fr.symbol || null,
      ips_symbol_location: fr.symbolLocation || null,
      atos_symbol: atosOut.stdout,
      atos_status: atosOut.status,
      classification: ii === 2 ? "BIND_APPLIED" : "UNKNOWN_NO_GUESS",
    })
  }

  const result = {
    schema_version: 1,
    crash_report_path: ipsPath,
    crash_report_sha256: args.ipsSha256 || null,
    binary_path: binaryPath,
    binary_uuid: binUUID,
    dsym_dwarf: dsymDwarf,
    dsym_uuid: dsymUUID,
    faulting_thread: ft,
    crash_pc_decimal: pcDecimal,
    crash_pc_hex: pcHex,
    image2_base_decimal: baseImg2,
    image2_base_hex: baseImg2Hex,
    computed_offset_decimal: computedOffset,
    frame0_offset_decimal: frame0Offset,
    symbol_source: {
      binary_atos: "atos -arch arm64 -o <dSYM Contents/Resources/DWARF/Electron Framework> -l <hex-base> <hex-addr>",
      notes: "Only imageIndex=2 frames are bound to the dSYM. imageIndex=8 is anonymous and never symbolized. The runtime binary is not used as -o because it has stripped DWARF.",
    },
    frames: symFrames,
  }

  await mkdir(outDir, { recursive: true })
  const outPath = resolve(outDir, "08-faulting-thread-symbolization.json")
  await writeFile(outPath, JSON.stringify(result, null, 2) + "\n")
  console.log(`wrote ${outPath}  (${symFrames.length} frames)`)
}

main().catch((e) => die(e.stack || String(e)))
