// Smoke test: load the compiled kernel and run a small event sequence
// to verify the JS interop shape, the inbound decoder, the outbound
// effect emission, and the closed-tag enforcement.
//
// This is a diagnostic script. It is NOT a replacement for the
// invariant + replay tests; those live in tests/ and require elm-test.

import fs from "node:fs"

const kernelPath = process.argv[2] || "/tmp/completion-authority.js"
const code = fs.readFileSync(kernelPath, "utf8")
const scope = {}
const fn = new Function("scope", code + "; return this.Elm;")
const Elm = fn(scope)

if (!Elm.Main || typeof Elm.Main.init !== "function") {
	console.error("FAIL: Elm.Main.init not exported")
	process.exit(2)
}

const ports = Elm.Main.init({}).ports
if (!ports.inbound || !ports.outbound) {
	console.error("FAIL: ports.inbound or ports.outbound missing")
	process.exit(2)
}

const received = []
ports.outbound.subscribe((v) => received.push(v))

const events = [
	{ tag: "task_started", taskId: "task-1" },
	{ tag: "run_started", runId: "run-1", origin: "explicit_user" },
	{ tag: "submit_and_exit_seen", submitId: "submit-1" },
	{ tag: "task_completion_committed", completionId: "c-1" },
	{ tag: "completion_presented", completionId: "c-1" },
	{ tag: "garbage_tag", foo: "bar" },
]

for (const e of events) {
	ports.inbound.send(e)
}

setTimeout(() => {
	console.log(`received ${received.length} outbound messages:`)
	for (const v of received) console.log("  ", JSON.stringify(v))

	// Required invariants:
	const hasReady = received.some((v) => v.kind === "ready")
	const hasStateForTaskStarted = received.some((v) => v.kind === "state" && v.model && v.model.task === "active")
	const hasDecodeError = received.some((v) => v.kind === "decode_error")

	if (!hasReady) {
		console.error("FAIL: no ready message")
		process.exit(1)
	}
	if (!hasStateForTaskStarted) {
		console.error("FAIL: no state with task=active after task_started")
		process.exit(1)
	}
	if (!hasDecodeError) {
		console.error("FAIL: unknown tag did not produce a decode_error")
		process.exit(1)
	}
	console.log("PASS: kernel round-trips a tagged event sequence")
	process.exit(0)
}, 100)
