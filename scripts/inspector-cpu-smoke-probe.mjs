#!/usr/bin/env node
/**
 * ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01
 *
 * Real-Node smoke probe (per ACT §24). Opens a Node inspector session,
 * runs the EXACT protocol sequence the production rolling CPU profiler
 * uses:
 *
 *   Profiler.enable
 *   Profiler.setSamplingInterval
 *   Profiler.start
 *   ... bounded CPU workload ...
 *   Profiler.stop
 *
 * Asserts:
 *   profile.nodes.length > 0
 *   profile.samples.length > 0
 *   profile.timeDeltas.length > 0
 *
 * Node's documented CPU-profiler example
 * (https://nodejs.org/api/inspector.html) follows exactly this protocol
 * sequence. This probe proves the Node runtime accepts the protocol
 * surface and returns a non-empty profile for a real workload.
 *
 * Exit codes:
 *   0 = PASS
 *   1 = FAIL (assertion violation)
 *   2 = usage
 */

import { Session } from "node:inspector"

const session = new Session()

async function post(method, params) {
	return new Promise((resolve, reject) => {
		session.post(method, params ?? {}, (error, result) => {
			if (error) reject(error)
			else resolve(result)
		})
	})
}

function assert(cond, msg) {
	if (!cond) {
		console.error(`FAIL: ${msg}`)
		process.exit(1)
	}
}

const SAMPLING_INTERVAL_US = 1000

session.connect()
try {
	await post("Profiler.enable")
	console.log("Profiler.enable ok")

	// ACT §10: explicitly set sampling interval. Do not assume default.
	await post("Profiler.setSamplingInterval", { interval: SAMPLING_INTERVAL_US })
	console.log(`Profiler.setSamplingInterval ok (interval=${SAMPLING_INTERVAL_US}us)`)

	await post("Profiler.start")
	console.log("Profiler.start ok")

	// Bounded CPU workload: 1 second of allocation + math.
	const arr = []
	const t0 = Date.now()
	while (Date.now() - t0 < 1000) {
		for (let i = 0; i < 10_000; i++) {
			arr.push(Math.sqrt(i) * Math.sin(i))
		}
	}

	// Profiler.stop returns the completed profile as the protocol-level
	// result. Per ACT §3, this is the only way to get a CPU profile
	// (no getSamplingProfile equivalent exists).
	const stopResult = await post("Profiler.stop")
	// CDP can wrap the profile in { profile: { ... } }; unwrap defensively.
	const profile = stopResult && typeof stopResult === "object" && "profile" in stopResult ? stopResult.profile : stopResult
	assert(profile !== undefined, "Profiler.stop returned undefined")
	assert(typeof profile === "object", "profile is not an object")
	assert(Array.isArray(profile.nodes), `profile.nodes is not an array (got ${typeof profile.nodes})`)
	assert(Array.isArray(profile.samples), "profile.samples is not an array")
	assert(Array.isArray(profile.timeDeltas), "profile.timeDeltas is not an array")
	assert(profile.nodes.length > 0, `profile has 0 nodes`)
	assert(profile.samples.length > 0, `profile has 0 samples`)
	assert(profile.timeDeltas.length > 0, `profile has 0 timeDeltas`)
	console.log(
		`Profiler.stop returned profile: nodes=${profile.nodes.length} samples=${profile.samples.length} timeDeltas=${profile.timeDeltas.length}`,
	)
} finally {
	session.disconnect()
}

console.log("smoke probe PASS")
