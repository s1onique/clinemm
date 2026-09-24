#!/usr/bin/env node

/**
 * ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01
 *
 * Bounded V8 CPU profile analyzer for the rolling-segment captures
 * produced by `apps/vscode/src/sdk/extension-host-cpu-profiler.ts`.
 *
 * Reads one or more `segment-NNN.cpuprofile` JSON files and emits:
 *
 *   - Top-N raw-sample leaves aggregated by leaf function + caller chain
 *   - Per-leaf hitCount, raw sample share, timeDelta stats (first, max, p95)
 *   - TimeDelta attribution guards (per ACT §25):
 *       - first_timeDelta (pathological first sample)
 *       - max_timeDelta (outlier gap)
 *       - p95_timeDelta
 *       - sampleShare vs deltaShare (delta dominated by outlier?)
 *       - TIMEDELTA_ATTRIBUTION_UNRELIABLE flag when deltaShare is
 *         unreliable due to a single dominant gap.
 *
 * Metric semantics (per ACT §25):
 *   - "raw sample share" = leaf.hitCount / sum(all hitCount)
 *   - "delta share"      = leaf.sum(timeDeltas) / sum(all timeDeltas)
 *     — only valid when no single delta dominates the distribution.
 *
 * Usage:
 *   node scripts/analyze-cpu-profile.mjs <profile-or-dir> [topN]
 */

import { readFileSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"

const args = process.argv.slice(2)
if (args.length < 1) {
	console.error("usage: node scripts/analyze-cpu-profile.mjs <profile-or-dir> [topN]")
	process.exit(2)
}

const inputPath = isAbsolute(args[0]) ? args[0] : resolve(args[0])
const topN = Number.parseInt(args[1] ?? "20", 10)

async function resolveSegmentFiles(path) {
	const s = await stat(path)
	if (s.isFile()) {
		return [{ path, segmentIndex: 0 }]
	}
	if (s.isDirectory()) {
		const entries = await readdir(path)
		const files = entries
			.filter((f) => /^segment-\d+\.cpuprofile$/.test(f))
			.sort()
			.map((f) => resolve(path, f))
		return files.map((p, i) => ({ path: p, segmentIndex: i }))
	}
	throw new Error(`unsupported path: ${path}`)
}

function pct(n, total) {
	if (total === 0) return 0
	return (n / total) * 100
}

function quantile(sorted, q) {
	if (sorted.length === 0) return 0
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))
	return sorted[idx]
}

function formatFrame(callFrame) {
	const fn = callFrame.functionName || "(anonymous)"
	const url = callFrame.url || "<native>"
	const line = callFrame.lineNumber ?? -1
	const col = callFrame.columnNumber ?? -1
	return `${fn} @ ${url}:${line}:${col}`
}

function analyzeOne(profilePath, segmentIndex) {
	const raw = JSON.parse(readFileSync(profilePath, "utf8"))
	const nodes = Array.isArray(raw.nodes) ? raw.nodes : []
	const samples = Array.isArray(raw.samples) ? raw.samples : []
	const timeDeltas = Array.isArray(raw.timeDeltas) ? raw.timeDeltas : []

	const totalSamples = samples.length
	const totalDeltas = timeDeltas.reduce((acc, d) => acc + (typeof d === "number" ? d : 0), 0)

	const firstTimeDelta = timeDeltas.length > 0 ? timeDeltas[0] : 0
	const sortedDeltas = timeDeltas
		.filter((d) => typeof d === "number")
		.slice()
		.sort((a, b) => a - b)
	const maxTimeDelta = sortedDeltas.length > 0 ? sortedDeltas[sortedDeltas.length - 1] : 0
	const p95TimeDelta = quantile(sortedDeltas, 0.95)

	// Build leaf stats from samples.
	const leafStats = new Map()
	for (let i = 0; i < samples.length; i++) {
		const nid = samples[i]
		const td = i < timeDeltas.length && typeof timeDeltas[i] === "number" ? timeDeltas[i] : 0
		let bucket = leafStats.get(nid)
		if (!bucket) {
			bucket = {
				nodeId: nid,
				hitCount: 0,
				deltaSum: 0,
				firstDelta: td,
				maxDelta: td,
				minDelta: td,
				deltas: [],
			}
			leafStats.set(nid, bucket)
		}
		bucket.hitCount += 1
		bucket.deltaSum += td
		bucket.deltas.push(td)
		if (td > bucket.maxDelta) bucket.maxDelta = td
		if (td < bucket.minDelta) bucket.minDelta = td
	}

	// Compute per-leaf p95 delta.
	for (const bucket of leafStats.values()) {
		const sorted = bucket.deltas.slice().sort((a, b) => a - b)
		bucket.p95Delta = quantile(sorted, 0.95)
		delete bucket.deltas
	}

	const rows = []
	for (const bucket of leafStats.values()) {
		const node = nodes.find((n) => n && n.id === bucket.nodeId)
		const callFrame = node?.callFrame ? node.callFrame : {}
		const sampleShare = pct(bucket.hitCount, totalSamples)
		const deltaShare = pct(bucket.deltaSum, totalDeltas)
		const outlierFraction = bucket.deltaSum > 0 ? bucket.maxDelta / bucket.deltaSum : 0
		const unreliable = outlierFraction > 0.5
		rows.push({
			nodeId: bucket.nodeId,
			functionName: callFrame.functionName || "(anonymous)",
			url: callFrame.url || "<native>",
			line: callFrame.lineNumber ?? -1,
			column: callFrame.columnNumber ?? -1,
			hitCount: bucket.hitCount,
			rawSampleShare: sampleShare,
			deltaSumUs: bucket.deltaSum,
			deltaShare,
			maxDeltaUs: bucket.maxDelta,
			p95DeltaUs: bucket.p95Delta,
			firstDeltaUs: bucket.firstDelta,
			outlierFraction,
			timedeltaUnreliable: unreliable,
		})
	}

	rows.sort((a, b) => b.hitCount - a.hitCount || b.deltaSumUs - a.deltaSumUs)
	const top = rows.slice(0, topN)

	return {
		profilePath,
		segmentIndex,
		totalSamples,
		totalDeltas,
		firstTimeDelta,
		maxTimeDelta,
		p95TimeDelta,
		leafCount: rows.length,
		top,
	}
}

const segments = await resolveSegmentFiles(inputPath)
if (segments.length === 0) {
	console.error("no segment-*.cpuprofile files found")
	process.exit(2)
}

console.log(`# cpu-profile analysis`)
console.log(`input: ${inputPath}`)
console.log(`segments: ${segments.length}`)
console.log(`topN: ${topN}`)
console.log(``)

const aggregateByIdentity = new Map()
for (const seg of segments) {
	const result = analyzeOne(seg.path, seg.segmentIndex)
	console.log(`## segment ${seg.segmentIndex}: ${seg.path}`)
	console.log(
		`  samples=${result.totalSamples} deltas=${result.totalDeltas} first_delta=${result.firstTimeDelta} max_delta=${result.maxTimeDelta} p95_delta=${result.p95TimeDelta}`,
	)
	console.log(`  | # | hitCount | rawSampleShare | deltaShare | max_delta | p95_delta | first_delta | unreliable | leaf |`)
	console.log(`  | -: | -------: | -------------: | ---------: | --------: | --------: | ----------: | :--------- | :--- |`)
	for (let i = 0; i < result.top.length; i++) {
		const r = result.top[i]
		const leaf = formatFrame({
			functionName: r.functionName,
			url: r.url,
			lineNumber: r.line,
			columnNumber: r.column,
		})
		console.log(
			`  | ${i + 1} | ${r.hitCount} | ${r.rawSampleShare.toFixed(3)}% | ${r.deltaShare.toFixed(3)}% | ${r.maxDeltaUs} | ${r.p95DeltaUs} | ${r.firstDeltaUs} | ${r.timedeltaUnreliable ? "YES" : "no"} | ${leaf.replaceAll("|", "\\|")} |`,
		)
		const idKey = `${r.functionName}|||${r.url}|||${r.line}|||${r.column}`
		let agg = aggregateByIdentity.get(idKey)
		if (!agg) {
			agg = {
				functionName: r.functionName,
				url: r.url,
				line: r.line,
				column: r.column,
				totalHitCount: 0,
				appearances: 0,
				segmentsWithAppearance: new Set(),
			}
			aggregateByIdentity.set(idKey, agg)
		}
		agg.totalHitCount += r.hitCount
		agg.appearances += 1
		agg.segmentsWithAppearance.add(seg.segmentIndex)
	}
	console.log(``)
}

console.log(`## stable-identity aggregate across segments`)
const aggregated = [...aggregateByIdentity.values()]
aggregated.sort((a, b) => b.totalHitCount - a.totalHitCount)
console.log(`| total_hits | appearances | segments | leaf |`)
console.log(`| ---------: | ----------: | :------- | :--- |`)
for (const r of aggregated.slice(0, topN)) {
	const leaf = formatFrame({
		functionName: r.functionName,
		url: r.url,
		lineNumber: r.line,
		columnNumber: r.column,
	})
	const segs = [...r.segmentsWithAppearance].sort((a, b) => a - b).join(",")
	console.log(`| ${r.totalHitCount} | ${r.appearances} | ${segs} | ${leaf.replaceAll("|", "\\|")} |`)
}
