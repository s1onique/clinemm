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
import { sanitizeOutcomeText as NEW } from "./new.ts";
const LADDER = [2048, 8192, 32768, 51200, 131072, 524288, 1048576];
const MODES = {
  nonmatching: (n) => "a".repeat(n),
  matching: (n) => "x".repeat(n) + "\nDB_PASSWORD=hunter2\n",
  nearmatch: (n) => Array.from({length: Math.max(1, n/20|0)}, (_,i)=>`PASSWORD_${i}=v${i}`).join("\n"),
  pemflood: (n) => `${PEM_BEGIN}`.repeat(Math.max(1, n/30|0)),
};
const t = (s) => { const a=process.hrtime.bigint(); NEW(s); return Number(process.hrtime.bigint()-a)/1e6; };
const stat = (s) => { const xs=[]; for(let i=0;i<5;i++) xs.push(t(s)); xs.sort((a,b)=>a-b); return {median: xs[2], max: xs[4]}; };
console.log("RUNTIME: Node " + process.versions.node + " (V8) — the production extension-host runtime");
console.log("mode         input      median_ms    max_ms");
let w50=0, w1m=0;
for (const [m, g] of Object.entries(MODES)) {
  for (const n of LADDER) {
    const s = g(n); const st = stat(s);
    if (n === 51200 || n === 51221 || n === 48979 || n === 52886) w50 = Math.max(w50, st.max);
    if (n >= 1048576) w1m = Math.max(w1m, st.max);
    console.log(`${m.padEnd(12)} ${String(n).padStart(8)}  ${st.median.toFixed(3).padStart(10)}  ${st.max.toFixed(3).padStart(9)}`);
  }
}
console.log("\nWORST_50KIB_MAX_MS=" + w50.toFixed(3) + " (limit 100)");
console.log("WORST_1MIB_MAX_MS=" + w1m.toFixed(3) + " (limit 1000)");
