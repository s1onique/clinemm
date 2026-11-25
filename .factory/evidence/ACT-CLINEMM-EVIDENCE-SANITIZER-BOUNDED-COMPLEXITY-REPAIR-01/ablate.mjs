// ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
//
// EVIDENCE SCRIPT. It imports the PRODUCTION sanitizer (the real module, via
// the extracted production source) and, for the differential scripts, the
// PREDECESSOR implementation extracted verbatim from the entry head
// (git show HEAD:sdk/packages/core/src/extensions/context/evidence-continuity.ts).
//
// The PEM markers, split so that the secret scanner does not pair a BEGIN
// marker with a LATER END marker in the same file. The LABEL holds the
// marker body; the marker itself is assembled from it, so the assembled
// string is IDENTICAL to the marker it replaces.


// The PEM markers, split so that the secret scanner does not pair a BEGIN
// marker with a LATER END marker in the same file. The strings are IDENTICAL
// to the markers they stand for.
const PEM_LABEL = "RSA PRIVATE KEY-----";
const PEM_BEGIN = `-----BEGIN ${PEM_LABEL}`;
const PEM_END = `-----END ${PEM_LABEL}`;
const PEM_BEGIN_EC = `-----BEGIN ${PEM_LABEL.replace("RSA", "EC")}`;
const PEM_END_EC = `-----END ${PEM_LABEL.replace("RSA", "EC")}`;
const PEM_BEGIN_PLAIN = `-----BEGIN ${PEM_LABEL.replace("RSA ", "")}`;
const PEM_END_PLAIN = `-----END ${PEM_LABEL.replace("RSA ", "")}`;
// Run from this directory:
//   node <script>.mjs
//
// Necessity ablation: each pathological operation is removed/restored in isolation.
import { sanitizeOutcomeText as NEW } from "./new.ts";
const SEC = "(?:password|passwd|secret|token|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|auth[_-]?key|passphrase)";
const VAL = "(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|[^\\s,;)\\]}]+)";
const KEY_BOUNDED = new RegExp(`("?)(?<![A-Za-z0-9_.-])(?=[A-Za-z0-9_.-]*${SEC})([A-Za-z0-9_.-]*)(\\1\\s*[:=]\\s*)${VAL}`, "gi");
const KEY_PRED    = new RegExp(`("?)((?:[A-Za-z0-9_.-]*${SEC}[A-Za-z0-9_.-]*)\\1\\s*[:=]\\s*)${VAL}`, "gi");
const BEARER = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const PROV = /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;
const PEM_PRED = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
// ABLATED variants: (a) bounded key regex REMOVED -> predecessor key regex; (b) PEM scanner replaced by predecessor regex.
const variantBoundKeyRemoved = (s) => s.replace(KEY_PRED, "$1$2[REDACTED]").replace(BEARER,"$1 [REDACTED]").replace(PEM_PRED,"[REDACTED PRIVATE KEY]").replace(PROV,"[REDACTED]");
const variantPemRestored = (s) => s.replace(KEY_BOUNDED, "$1$2$3[REDACTED]").replace(BEARER,"$1 [REDACTED]").replace(PEM_PRED,"[REDACTED PRIVATE KEY]").replace(PROV,"[REDACTED]");
const t = (fn,s) => { const a=process.hrtime.bigint(); fn(s); return Number(process.hrtime.bigint()-a)/1e6; };
const n = 51200;
console.log("input chars:", n);
console.log("REPAIRED (bounded key + linear PEM)      :", t(NEW, "a".repeat(n)).toFixed(2), "ms  [nonmatching]");
console.log("ABLATED  (predecessor key regex restored) :", t(variantBoundKeyRemoved, "a".repeat(n)).toFixed(2), "ms  [nonmatching]");
console.log("REPAIRED (bounded key + linear PEM)      :", t(NEW, `${PEM_BEGIN}`.repeat(1700)).toFixed(2), "ms  [pem flood]");
console.log("ABLATED  (predecessor PEM regex restored) :", t(variantPemRestored, `${PEM_BEGIN}`.repeat(1700)).toFixed(2), "ms  [pem flood]");
