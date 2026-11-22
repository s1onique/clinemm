#!/usr/bin/env node
/**
 * MYC prime equivalence checker — ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01
 *
 * PROVES (or REFUTES) that extracting the MYC prime injection into the
 * `runPrimeBeforeModel` closure did not change the prime's behaviour.
 *
 * The previous checker used HARD-CODED LINE-NUMBER SLICES and read the
 * pre-ACT file from a temp path, so it neither reproduced for anyone else
 * nor actually compared the two function bodies. This version:
 *
 *   1. locates both bodies by STABLE STRING ANCHORS and extracts them by
 *      brace matching, so the extraction does not depend on formatting,
 *      line numbers, or any other code in the file;
 *   2. compares the two bodies as a pure TOKEN STREAM (all whitespace
 *      collapsed), so a reflow cannot mask or fake a difference;
 *   3. EXITS NONZERO when the bodies differ, so the artifact cannot be
 *      read as a proof of equivalence when it is not.
 *
 * Usage:
 *   node verify-prime-equivalence.mjs <pre-ACT-hooks-adapter.ts> <current-hooks-adapter.ts>
 *
 * Exit codes: 0 = bodies are token-stream identical (equivalence PROVEN)
 *             1 = bodies differ (equivalence REFUTED)
 *             2 = the inputs could not be parsed (no claim is made)
 */
import fs from "node:fs"

/**
 * Extract the MYC prime body from a hooks-adapter source.
 *
 * HEAD -> the body of the `async beforeModel(` method.
 * NOW  -> the body of the `const runPrimeBeforeModel = async (` closure.
 *
 * In both cases the prime logic lives in the `try { ... } catch { ... }`
 * block. Brace matching from the anchor extracts it exactly, so the result
 * is independent of surrounding wrappers.
 */
function extractPrimeBody(src, label) {
	const anchor = label === "HEAD" ? "async beforeModel(" : "const runPrimeBeforeModel = async ("
	const start = src.indexOf(anchor)
	if (start < 0) {
		throw new Error(`anchor not found for ${label}: ${anchor}`)
	}
	// Locate the BODY brace, not a brace inside the return TYPE.
	//
	// The HEAD signature is:
	//   async beforeModel(
	//     ctx: AgentBeforeModelContext,
	//   ): Promise<
	//     { messages?: ...; options?: ... } | undefined
	//   > {
	// so "the first { after the anchor" lands INSIDE the return type, not
	// at the function body. Taking that brace would compare two type
	// fragments and report a false PASS.
	//
	// The body brace is the one that follows the end of the signature:
	//   - for the closure, the arrow `=>` precedes it;
	//   - for the method, the return type ends with `> ` before it.
	// We therefore scan forward from the anchor, skipping over any brace
	// that belongs to a TYPE by tracking `<>` nesting, and take the first
	// `{` that is not inside a type argument list.
	const bodyStart = findBodyBrace(src, start, label)
	if (bodyStart < 0) {
		throw new Error(`body start not found for ${label}`)
	}
	let depth = 0
	for (let i = bodyStart; i < src.length; i++) {
		const c = src[i]
		if (c === "{") {
			depth++
		} else if (c === "}") {
			depth--
			if (depth === 0) {
				return src.slice(bodyStart + 1, i)
			}
		}
	}
	throw new Error(`unbalanced braces for ${label}`)
}

/**
 * Find the `{` that opens the function BODY, skipping braces that belong
 * to the return type.
 *
 * Strategy: walk forward from the anchor and track angle-bracket nesting.
 * A `{` encountered while `angleDepth > 0` belongs to a type argument
 * (e.g. `Promise<{ messages?: ... }>`) and is skipped. The first `{`
 * found at `angleDepth === 0` is the body brace.
 */
function findBodyBrace(src, start, label) {
	let angleDepth = 0
	for (let i = start; i < src.length; i++) {
		const c = src[i]
		if (c === "<") {
			angleDepth++
			continue
		}
		if (c === ">") {
			if (angleDepth > 0) {
				angleDepth--
			}
			continue
		}
		if (c === "{") {
			if (angleDepth > 0) {
				// This brace is inside a type argument list -> not the body.
				continue
			}
			return i
		}
	}
	return -1
}

/** Strip comments and normalize whitespace. */
const norm = (s) =>
	s
		.replace(/\/\/[^\n]*/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/[ \t]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.trim()

/** Collapse ALL whitespace -> a pure token sequence. */
const tok = (s) => norm(s).replace(/\s+/g, " ").trim()

const [, , headPath, nowPath] = process.argv
if (!headPath || !nowPath) {
	console.error("usage: node verify-prime-equivalence.mjs <pre-ACT.ts> <current.ts>")
	process.exit(2)
}

let head
let now
try {
	head = fs.readFileSync(headPath, "utf8")
	now = fs.readFileSync(nowPath, "utf8")
} catch (error) {
	console.error(`RESULT: INPUT_ERROR (${error.message}) - no claim is made`)
	process.exit(2)
}

let a
let b
try {
	a = tok(extractPrimeBody(head, "HEAD"))
	b = tok(extractPrimeBody(now, "NOW"))
} catch (error) {
	console.error(`RESULT: PARSE_ERROR (${error.message}) - no claim is made`)
	process.exit(2)
}

console.log("HEAD prime body tokens:", a.length)
console.log("NOW  prime body tokens:", b.length)

// SANITY GUARD: the prime body is a substantial function. A tiny
// extraction means the anchor/brace-matching resolved to something other
// than the real body (e.g. a fragment of the return type), which would
// compare two unrelated fragments and report a FALSE PASS. Refuse to make
// any claim in that case.
const MIN_BODY_TOKENS = 500
if (a.length < MIN_BODY_TOKENS || b.length < MIN_BODY_TOKENS) {
	console.error(`RESULT: EXTRACTION_TOO_SMALL (HEAD ${a.length}, NOW ${b.length}, minimum ${MIN_BODY_TOKENS}) - the bodies were not extracted correctly, so no equivalence claim is made.`)
	process.exit(2)
}

console.log("token-stream EQUAL:", a === b)

if (a !== b) {
	let i = 0
	while (i < Math.min(a.length, b.length) && a[i] === b[i]) {
		i++
	}
	console.log("first divergence at token index", i)
	console.log("HEAD: ..." + a.slice(Math.max(0, i - 160), i + 240))
	console.log("NOW : ..." + b.slice(Math.max(0, i - 160), i + 240))
	console.log("RESULT: FAIL - the extracted prime bodies are NOT equivalent")
	process.exit(1)
}

console.log("RESULT: PASS - the extracted prime bodies are token-stream identical")
