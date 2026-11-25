export function sanitizeOutcomeText(text: string): string {
	const afterCredentials = text
		// KEY=value / KEY: value assignments whose key names a secret.
		// The value runs to the end of the quoted string (spaces and all)
		// or to the next delimiter, so a multi-word secret is consumed
		// whole rather than partially.
		//
		// ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01:
		// the pattern is now BOUNDED. The predecessor's pattern had NO
		// anchor on the start of the key run, so the engine retried the
		// whole key run at EVERY offset inside it and backtracked through
		// the run's characters each time. That is quadratic in the length
		// of the run, which is why a 50 KiB body with no match did not
		// terminate.
		//
		// The `(?<![A-Za-z0-9_.-])` guard is the run boundary: it makes the
		// engine attempt the match only at the START of a key run, so a run
		// is scanned once instead of once per offset. It is
		// SEMANTICS-CONSERVING rather than a policy change, because the
		// predecessor's greedy key run already spanned the entire run and
		// the left-to-right scan always preferred the run's start; a match
		// beginning at a later offset of the same run could therefore never
		// be preferred over the one beginning at the run's start.
		//
		// The `(?=...)` SECRET lookahead is likewise a restructuring and not
		// a narrowing: it requires the key run to contain a secret name,
		// exactly as the predecessor's inner group did, but it lets the
		// engine REJECT a position without first consuming and backtracking
		// the whole run.
		.replace(
			/("?)(?<![A-Za-z0-9_.-])(?=[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|auth[_-]?key|passphrase))([A-Za-z0-9_.-]*)(\1\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;)\]}]+)/gi,
			"$1$2$3[REDACTED]",
		)
		// Bearer headers.
		.replace(
			/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
			"$1 [REDACTED]",
		);
	const afterPem = redactPemPrivateKeys(afterCredentials);
	// Common provider-shaped keys that are not key=value.
	return afterPem.replace(
		/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
		"[REDACTED]",
	);
}

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * The literal that opens a PEM `BEGIN` marker.
 */
const PEM_BEGIN_LITERAL = "-----BEGIN ";

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * The literal that opens a PEM `END` marker.
 */
const PEM_END_LITERAL = "-----END ";

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * The tail that closes a PEM marker, after the `[A-Z ]*` run.
 */
const PEM_MARKER_TAIL = "PRIVATE KEY-----";

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * The marker that closes a PEM private-key block.
 *
 * The `[A-Z ]*` run is GREEDY, so a marker such as
 * `-----END PRIVATE KEY PRIVATE KEY-----` is matched as ONE marker whose
 * extent covers both tails. The greedy extent is preserved exactly by
 * matching the marker with a STICKY regex anchored at a known literal
 * offset: the engine performs the same greedy-and-backtrack search it
 * performed inside the predecessor's pattern.
 */
const PEM_END_MARKER = /-----END [A-Z ]*PRIVATE KEY-----/y;

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * One located PEM `END` marker.
 */
interface PemEndMarker {
	/** The offset at which the marker starts. */
	readonly start: number;
	/** The offset just past the end of the marker. */
	readonly end: number;
}

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * True for the characters the `[A-Z ]*` run of a PEM marker accepts.
 */
function isPemMarkerRunChar(code: number): boolean {
	// `A`-`Z` and the space.
	return (code >= 65 && code <= 90) || code === 32;
}

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * The length of the `[A-Z ]*` run that starts at `offset`.
 */
function pemMarkerRunLength(text: string, offset: number): number {
	let index = offset;
	while (index < text.length && isPemMarkerRunChar(text.charCodeAt(index))) {
		index++;
	}
	return index - offset;
}

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * Locate every PEM `END` marker, in increasing offset order.
 *
 * Every occurrence of the `-----END ` literal is tried, INCLUDING
 * OVERLAPPING ones, because the predecessor's pattern was attempted at
 * every position too. The extent of each marker is computed with the
 * STICKY regex, so it is exactly the extent the predecessor's pattern
 * would have produced at that offset.
 */
function locatePemEndMarkers(text: string): PemEndMarker[] {
	const markers: PemEndMarker[] = [];
	const scanner = new RegExp(PEM_END_MARKER.source, PEM_END_MARKER.flags);
	let offset = text.indexOf(PEM_END_LITERAL);
	while (offset !== -1) {
		scanner.lastIndex = offset;
		const match = scanner.exec(text);
		if (match !== null) {
			markers.push({ start: offset, end: offset + match[0].length });
		}
		offset = text.indexOf(PEM_END_LITERAL, offset + 1);
	}
	return markers;
}

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * The index of the first entry of `markers` whose `start` is at or after
 * `value`. The entries are sorted by `start`, so this is a binary search.
 */
function lowerBoundByStart(
	markers: readonly PemEndMarker[],
	value: number,
): number {
	let low = 0;
	let high = markers.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (markers[mid].start < value) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low;
}

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * Redact PEM private-key blocks with a DETERMINISTIC, LINEAR scan.
 *
 * WHY NOT A SINGLE REGEX.
 *
 * The predecessor's pattern was
 * `-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`.
 * The lazy `[\s\S]*?` span makes the engine, for EACH `BEGIN` marker,
 * rescan forward to the end of the input looking for an `END` marker. A
 * body with many `BEGIN` markers and no matching `END` therefore costs
 * O(number of markers x body length) — quadratic — and that is exactly the
 * shape of a truncated or partially-redacted key dump.
 *
 * WHY THIS IS THE SAME RESULT.
 *
 * The predecessor matched, repeatedly:
 *
 *   1. The LEFTMOST `BEGIN` marker at or after the current scan position.
 *   2. Its extent, with the GREEDY `[A-Z ]*` run backtracking until the
 *      `PRIVATE KEY-----` tail fits.
 *   3. The NEAREST `END` marker that starts at or after that `BEGIN`
 *      marker's END, with the same greedy extent rule.
 *   4. The whole span from the `BEGIN` marker's START to the `END`
 *      marker's END, which the replacement consumed.
 *   5. Then the scan resumed at the end of that consumed span.
 *
 * This scan performs exactly those steps, with the `END` markers located
 * ONCE and the `BEGIN` markers resolved without a nested rescan:
 *
 *   1. The `END` markers are located in a single left-to-right pass.
 *   2. The `BEGIN` markers are visited in increasing offset order, and
 *      each one's greedy extent is resolved by walking the run from its
 *      LONGEST form down to its shortest — the same order the engine's
 *      backtracking used.
 *   3. Each `BEGIN` is paired with the nearest `END` that starts at or
 *      after the `BEGIN` marker's end.
 *   4. The scan resumes after the consumed span, so a `BEGIN` marker
 *      inside an already-consumed block is consumed with it, exactly as
 *      the predecessor's lazy span consumed it.
 *
 * A `BEGIN` with no `END` after it is left verbatim, exactly as the
 * predecessor left it when its span search failed.
 *
 * The total cost is O(body length) plus O(markers), with no nested
 * rescan.
 */
function redactPemPrivateKeys(text: string): string {
	if (!text.includes(PEM_BEGIN_LITERAL)) {
		return text;
	}
	const endMarkers = locatePemEndMarkers(text);
	let result = "";
	let cursor = 0;
	let beginOffset = text.indexOf(PEM_BEGIN_LITERAL);
	while (beginOffset !== -1) {
		if (beginOffset >= cursor) {
			const runStart = beginOffset + PEM_BEGIN_LITERAL.length;
			const runLength = pemMarkerRunLength(text, runStart);
			// The engine's backtracking order: the LONGEST run first, then
			// progressively shorter ones.
			let closed = false;
			for (let run = runLength; run >= 0; run--) {
				const tailStart = runStart + run;
				if (!text.startsWith(PEM_MARKER_TAIL, tailStart)) {
					continue;
				}
				const beginEnd = tailStart + PEM_MARKER_TAIL.length;
				const endIndex = lowerBoundByStart(endMarkers, beginEnd);
				if (endIndex >= endMarkers.length) {
					// No `END` marker closes this `BEGIN`. A SHORTER run
					// would end even earlier, so it cannot close it either.
					break;
				}
				const end = endMarkers[endIndex];
				result += text.slice(cursor, beginOffset);
				result += "[REDACTED PRIVATE KEY]";
				cursor = end.end;
				closed = true;
				break;
			}
			if (closed) {
				beginOffset = text.indexOf(PEM_BEGIN_LITERAL, cursor);
				continue;
			}
		}
		beginOffset = text.indexOf(PEM_BEGIN_LITERAL, beginOffset + 1);
	}
	if (result.length === 0) {
		return text;
	}
	return result + text.slice(cursor);
}
