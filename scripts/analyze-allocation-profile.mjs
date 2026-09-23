#!/usr/bin/env node
/**
 * ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01
 *
 * Bounded SamplingHeapProfile analyzer. Reads the JSON artifacts
 * produced by `apps/vscode/src/sdk/extension-host-allocation-profiler.ts`
 * and emits:
 *
 *   - Top-N allocation stacks aggregated by leaf function + caller chain
 *   - Per-leaf sampled bytes + sample count + share
 *
 * Metric semantics (per ACT §31):
 *   - "sample count"   = statistical count from V8 sampling
 *   - "sampled allocation bytes" = sum of `size` across samples
 *                                  attributed to a stack
 *   - we do NOT infer call count or absolute bytes allocated
 *
 * Usage:
 *   node scripts/analyze-allocation-profile.mjs <profile.json> [topN]
 *
 * Profile schema accepted (both shapes):
 *   (A) Flat: { head: { callFrame, children: [nodeId, ...] },
 *               samples: [{ nodeId, size, ... } | nodeId],
 *               nodes: [ { id, callFrame, parent? } ] }
 *   (B) Tree: { head: { callFrame, children: [ node ] },
 *               samples: [{ nodeId, size, ... }] }
 *     -> tree flattened into a nodes map by walking from head.
 */

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const args = process.argv.slice(2)
if (args.length < 1) {
    console.error("usage: node scripts/analyze-allocation-profile.mjs <profile.json> [topN]")
    process.exit(2)
}

const profilePath = resolve(args[0])
const topN = Number.parseInt(args[1] ?? "20", 10)

const raw = JSON.parse(await readFile(profilePath, "utf8"))
if (typeof raw !== "object" || raw === null) {
    console.error("profile is not a JSON object")
    process.exit(2)
}

// Unwrap { profile: { ... } } wrapper if present.
const profile = (raw && typeof raw === "object" && "profile" in raw)
    ? /** @type {any} */ (raw).profile
    : /** @type {any} */ (raw)

/**
 * Flatten a (B)-shape tree into a nodes map.
 */
function flattenTree(head) {
    /** @type {Map<number, any>} */
    const map = new Map()
    /** @type {any[]} */
    const stack = [head]
    while (stack.length > 0) {
        const n = stack.pop()
        if (!n || typeof n !== "object") continue
        if (typeof n.id === "number") {
            map.set(n.id, n)
        }
        if (Array.isArray(n.children)) {
            for (const c of n.children) stack.push(c)
        }
    }
    return map
}

let nodesById
if (Array.isArray(profile.nodes) && profile.nodes.length > 0) {
    nodesById = new Map()
    for (const n of profile.nodes) {
        if (n && typeof n === "object" && typeof n.id === "number") {
            nodesById.set(n.id, n)
        }
    }
} else if (profile.head) {
    nodesById = flattenTree(profile.head)
} else {
    console.error("profile has neither nodes array nor head")
    process.exit(2)
}

/**
 * Walk from a leaf node up to the root, collecting call frames.
 */
function stackForLeaf(leafId) {
    /** @type {any[]} */
    const frames = []
    let current = nodesById.get(leafId)
    const seen = new Set()
    while (current && !seen.has(current.id)) {
        seen.add(current.id)
        if (current.callFrame) frames.push(current.callFrame)
        const parentId = current.parent
        if (typeof parentId !== "number") break
        current = nodesById.get(parentId)
    }
    return frames.reverse()
}

function formatFrame(callFrame) {
    if (!callFrame) return "<unknown>"
    const fn = callFrame.functionName || "(anonymous)"
    const url = callFrame.url || "<no-url>"
    const line = callFrame.lineNumber ?? 0
    const col = callFrame.columnNumber ?? 0
    return `${fn} @ ${url}:${line}:${col}`
}

function stackKey(frames) {
    if (frames.length === 0) return "<empty>"
    const leaf = frames[frames.length - 1]
    const leafStr = `${leaf.functionName ?? ""}|${leaf.url ?? ""}|${leaf.lineNumber ?? 0}|${leaf.columnNumber ?? 0}`
    const callerFrames = frames.slice(0, -1)
    const callerStr = callerFrames.map((f) => `${f.functionName ?? ""}@${f.url ?? ""}:${f.lineNumber ?? 0}`).join(" -> ")
    return `${leafStr}|||${callerStr}`
}

const buckets = new Map()
const samples = profile.samples
if (Array.isArray(samples)) {
    for (const s of samples) {
        let leafId
        let size
        if (typeof s === "number") {
            leafId = s
            size = 0
        } else if (s && typeof s === "object") {
            leafId = s.nodeId ?? s.id
            size = typeof s.size === "number" ? s.size : 0
        } else {
            continue
        }
        if (typeof leafId !== "number") continue
        const frames = stackForLeaf(leafId)
        if (frames.length === 0) continue
        const key = stackKey(frames)
        let bucket = buckets.get(key)
        if (!bucket) {
            const leaf = frames[frames.length - 1]
            const callerStack = frames.slice(0, -1).reverse()
            bucket = { leaf, callerStack, sampledBytes: 0, sampleCount: 0 }
            buckets.set(key, bucket)
        }
        bucket.sampledBytes += size
        bucket.sampleCount += 1
    }
}

const rows = [...buckets.values()]
rows.sort((a, b) => b.sampledBytes - a.sampledBytes || b.sampleCount - a.sampleCount)
const totalSamples = rows.reduce((acc, r) => acc + r.sampleCount, 0)
const totalSampledBytes = rows.reduce((acc, r) => acc + r.sampledBytes, 0)

const top = rows.slice(0, topN)

console.log(`# allocation-profile analysis`)
console.log(`profile: ${profilePath}`)
console.log(`total samples: ${totalSamples}`)
console.log(`total sampled bytes: ${totalSampledBytes}`)
console.log(`unique stacks: ${rows.length}`)
console.log(``)
console.log(`## Top ${top.length} allocation leaves`)
console.log(``)
console.log(`| Allocation leaf / stack | Sampled bytes | Allocation samples | Share | Classification |`)
console.log(`| ----------------------- | ------------: | -----------------: | ----: | -------------- |`)
for (const r of top) {
    const share = totalSampledBytes > 0 ? (r.sampledBytes / totalSampledBytes) * 100 : 0
    const leaf = formatFrame(r.leaf)
    const stack = r.callerStack.map((f) => formatFrame(f)).join(" <- ")
    const combined = stack.length > 0 ? `${leaf} <- ${stack}` : leaf
    const classification = share >= 40 ? "DOMINANT" : share >= 10 ? "MATERIAL" : "SMALL"
    console.log(`| ${combined.replaceAll("|", "\\|")} | ${r.sampledBytes} | ${r.sampleCount} | ${share.toFixed(2)}% | ${classification} |`)
}
console.log(``)
console.log(`## ACT §32 candidate set (explicit suspects)`)
const suspectNames = [
    "captureContinuationCardinalityAuthorityRecord",
    "xmlTagsRemoval",
    "normalizeUserInput",
    "PendingPromptsController.drain",
    "TurnStateTracker.setWithWriter",
]
for (const name of suspectNames) {
    const matched = rows.filter((r) => r.leaf?.functionName === name)
    if (matched.length === 0) {
        console.log(`- ${name}: NOT FOUND in this profile`)
    } else {
        const total = matched.reduce((acc, r) => acc + r.sampleCount, 0)
        const bytes = matched.reduce((acc, r) => acc + r.sampledBytes, 0)
        console.log(`- ${name}: samples=${total} bytes=${bytes}`)
    }
}
