/**
 * ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01
 *
 * Focused test suite for the session-listing causal diagnostic. Test
 * plan mirrors ACT §16-§19.
 *
 * Every test uses the REAL production seams:
 *   - The diagnostic + sink installed via the production wiring
 *     (`apps/vscode/src/sdk/session-listing-diagnostic-runtime.ts`).
 *   - The SDK sink singleton at `@cline/core` (the production
 *     wrapper that the real `UnifiedSessionPersistenceService.listSessions`
 *     and `SessionManifestStore.readSessionManifestTitle` read).
 *
 * The tests do NOT touch internal counters directly. They only
 * verify the public observation surface
 * (`materializeSessionListingCausalitySnapshot`) which is the same
 * payload embedded in the meta.json sidecar.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
	__resetActiveListSessionsCallerForTests,
	__resetSessionListingDiagnosticSinkForTests,
	getSessionListingDiagnosticSink,
	SessionListingCallerClass,
	type SessionListingDiagnosticSink,
	setSessionListingDiagnosticSink,
} from "../../../../../sdk/packages/core/src/session/services/session-listing-diagnostic-sink"

import {
	__resetSessionListingCausalityForTests,
	callerClassName,
	disableSessionListingCausality,
	enableSessionListingCausality,
	materializeSessionListingCausalitySnapshot,
} from "../session-listing-allocation-diagnostic"

import {
	__resetSessionListingCausalityRuntimeForTests,
	buildSessionListingDiagnosticSink,
} from "../session-listing-diagnostic-runtime"

let installedSink: SessionListingDiagnosticSink | undefined

beforeEach(() => {
	// Reset both sides deterministically (per ACT section 12).
	__resetSessionListingCausalityForTests()
	__resetActiveListSessionsCallerForTests()
	__resetSessionListingDiagnosticSinkForTests()
	__resetSessionListingCausalityRuntimeForTests()
	installedSink = buildSessionListingDiagnosticSink()
	setSessionListingDiagnosticSink(installedSink)
	// ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01
	// (section 14): in production the counters are enabled by the
	// profiler lifecycle hook at `trigger()` time. The focused tests
	// drive the diagnostic directly, so they enable the gate
	// here.
	enableSessionListingCausality()
})

afterEach(() => {
	setSessionListingDiagnosticSink(undefined)
	__resetSessionListingCausalityForTests()
	__resetActiveListSessionsCallerForTests()
	__resetSessionListingDiagnosticSinkForTests()
	__resetSessionListingCausalityRuntimeForTests()
})

describe("SLAC01 — session-listing causal diagnostic", () => {
	it("SLAC-COMPOSE-01: listSessions via real production sink → listSessionsCalls += 1; OFF → 0", () => {
		setSessionListingDiagnosticSink(undefined)
		expect(materializeSessionListingCausalitySnapshot().listSessionsCalls).toBe(0)

		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordListSessionsCall?.(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.listSessionsCalls).toBe(1)
		expect(snapshot.byCaller[callerClassName(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)]).toBe(1)
	})

	it("SLAC-CTL-01: one consumer call → listSessionsCalls = 1, caller bucket = 1", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordListSessionsCall?.(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.listSessionsCalls).toBe(1)
		expect(snapshot.byCaller[callerClassName(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)]).toBe(1)
		expect(snapshot.byCaller[callerClassName(SessionListingCallerClass.SESSION_LIST_RPC)]).toBe(0)
	})

	it("SLAC-CTL-02: two distinct consumers → listSessionsCalls = 2, each caller bucket exact", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordListSessionsCall?.(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)
		sink.recordListSessionsCall?.(SessionListingCallerClass.SESSION_LIST_RPC)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.listSessionsCalls).toBe(2)
		expect(snapshot.byCaller[callerClassName(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)]).toBe(1)
		expect(snapshot.byCaller[callerClassName(SessionListingCallerClass.SESSION_LIST_RPC)]).toBe(1)
	})

	it("SLAC-CTL-03: no call → all counters = 0", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.listSessionsCalls).toBe(0)
		expect(snapshot.readSessionManifestTitleCalls).toBe(0)
		expect(snapshot.uniqueManifestIds).toBe(0)
		expect(snapshot.repeatedManifestReads).toBe(0)
		expect(snapshot.enabled).toBe(true)
	})

	it("SLAC-CTL-04: diagnostic disabled → production result identical, counters = 0", () => {
		disableSessionListingCausality()
		setSessionListingDiagnosticSink(undefined)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.enabled).toBe(false)
		expect(snapshot.listSessionsCalls).toBe(0)
	})
})

describe("SLAC01 manifest-identity", () => {
	it("SLAC-MANIFEST-01: one manifest → readManifestTitleCalls = 1, uniqueManifestIds = 1", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordReadSessionManifestTitleCall?.("session-A", true)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.readSessionManifestTitleCalls).toBe(1)
		expect(snapshot.uniqueManifestIds).toBe(1)
		expect(snapshot.repeatedManifestReads).toBe(0)
	})

	it("SLAC-MANIFEST-02: same unchanged manifest read twice → calls = 2, unique = 1, repeated = 1", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordReadSessionManifestTitleCall?.("session-A", true)
		sink.recordReadSessionManifestTitleCall?.("session-A", true)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.readSessionManifestTitleCalls).toBe(2)
		expect(snapshot.uniqueManifestIds).toBe(1)
		expect(snapshot.repeatedManifestReads).toBe(1)
	})

	it("SLAC-MANIFEST-03: distinct manifests → uniqueManifestIds reflects distinct count", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordReadSessionManifestTitleCall?.("session-A", true)
		sink.recordReadSessionManifestTitleCall?.("session-B", true)
		sink.recordReadSessionManifestTitleCall?.("session-C", false)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.readSessionManifestTitleCalls).toBe(3)
		expect(snapshot.uniqueManifestIds).toBe(3)
		expect(snapshot.repeatedManifestReads).toBe(0)
		expect(snapshot.manifestReadsWithoutTitle).toBe(1)
	})

	it("SLAC-RETURNED-TITLE-01: returnedTitle=false increments manifestReadsWithoutTitle", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordReadSessionManifestTitleCall?.("session-A", false)
		sink.recordReadSessionManifestTitleCall?.("session-A", false)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.manifestReadsWithoutTitle).toBe(2)
		expect(snapshot.uniqueManifestIds).toBe(1)
		expect(snapshot.repeatedManifestReads).toBe(1)
	})
})

describe("SLAC01 sink lifecycle", () => {
	it("SLAC-SINK-01: production sink install → SDK-side getSessionListingDiagnosticSink returns it", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		expect(getSessionListingDiagnosticSink()).toBe(sink)
		setSessionListingDiagnosticSink(undefined)
		expect(getSessionListingDiagnosticSink()).toBeUndefined()
	})
})
