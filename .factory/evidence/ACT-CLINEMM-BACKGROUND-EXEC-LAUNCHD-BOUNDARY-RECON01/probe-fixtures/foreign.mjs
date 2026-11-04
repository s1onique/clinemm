#!/usr/bin/env node
/**
 * Negative control for ACT-CLINEMM-BACKGROUND-EXEC-LAUNCHD-BOUNDARY-RECON01.
 * Marker: CLINEMM_RECON01_FOREIGN_CONTROL
 *
 * A FOREIGN process that does NOT belong to the probe parent's process
 * group and is NOT its child. It runs with its OWN marker and self-exits
 * after a fixed interval so it cannot leak.
 *
 * It is started by the harness (a separate shell), NOT by the probe
 * parent, so it sits outside the parent's authority scope.
 */
const MARKER = "CLINEMM_RECON01_FOREIGN_CONTROL";
const LIFETIME_MS = 9000;

console.log(`FOREIGN_READY pid=${process.pid} ppid=${process.ppid} marker=${MARKER}`);
const timer = setTimeout(() => {
	console.log(`FOREIGN_SELF_EXIT pid=${process.pid}`);
	process.exit(0);
}, LIFETIME_MS);
process.on("SIGTERM", () => {
	console.log(`FOREIGN_GOT_SIGTERM pid=${process.pid}`);
	clearTimeout(timer);
	process.exit(0);
});
const keepAlive = setInterval(() => {}, 1000);
process.on("exit", () => clearInterval(keepAlive));
