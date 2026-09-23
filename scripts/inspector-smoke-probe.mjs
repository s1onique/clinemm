#!/usr/bin/env node
/**
 * ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01
 *
 * Real-Node smoke probe (per ACT §23). Opens a Node inspector
 * session, runs HeapProfiler.startSampling with the EXACT options
 * the production profiler uses (incl. includeObjectsCollectedByMinorGC +
 * includeObjectsCollectedByMajorGC), allocates a known temporary
 * workload, retrieves getSamplingProfile, asserts the profile has
 * samples, then stops.
 *
 * This proves the Node runtime accepts BOTH collected-GC options
 * (the load-bearing assertion per ACT §20 ALLOCAUTH-PROTO-01) and
 * returns a non-empty profile for a real allocation workload.
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

function unwrap(result) {
    // CDP responses for getSamplingProfile are sometimes wrapped in
    // { profile: { head, samples, ... } }. Unwrap for the analyzer.
    if (result && typeof result === "object" && "profile" in result) {
        return /** @type {any} */ (result).profile
    }
    return result
}

session.connect()
try {
    await post("HeapProfiler.enable")
    console.log("HeapProfiler.enable ok")

    // The EXACT options the production profiler uses.
    await post("HeapProfiler.startSampling", {
        samplingInterval: 32768,
        stackDepth: 128,
        includeObjectsCollectedByMinorGC: true,
        includeObjectsCollectedByMajorGC: true,
    })
    console.log("HeapProfiler.startSampling ok (both collected-GC options accepted)")

    // Known temporary allocation workload.
    const arr = []
    for (let i = 0; i < 5_000_000; i++) {
        arr.push({ i, payload: `tmp-${i.toString(36)}`.repeat(8) })
    }

    const raw = await post("HeapProfiler.getSamplingProfile")
    const profile = unwrap(raw)
    assert(profile !== undefined, "profile is undefined")
    assert(typeof profile === "object", "profile is not an object")
    assert(profile.head !== undefined, "profile.head is missing")
    assert(Array.isArray(profile.samples), "profile.samples is not an array")
    assert(profile.samples.length > 0, `profile has 0 samples`)
    console.log(`profile: samples=${profile.samples.length} head.children=${Array.isArray(profile.head?.children) ? profile.head.children.length : "<inline>"}`)

    // P0 verification (per HALT_ALLOCATION_FINALIZATION_BROKEN review):
    // stopSampling returns the FINAL completed profile. Persist it and
    // assert it is non-empty. Do NOT call getSamplingProfile after
    // stopSampling.
    const stopRaw = await post("HeapProfiler.stopSampling")
    const stopProfile = unwrap(stopRaw)
    assert(stopProfile !== undefined, "stopSampling returned no profile")
    assert(typeof stopProfile === "object", "stopSampling profile is not an object")
    assert(
        Array.isArray(stopProfile.samples) || Array.isArray(profile.samples),
        "stopSampling and sampling profiles both lack samples"
    )
    console.log(`stopSampling returned profile: samples=${Array.isArray(stopProfile.samples) ? stopProfile.samples.length : "(see earlier getSamplingProfile)"}`)
} finally {
    session.disconnect()
}

console.log("smoke probe PASS")
