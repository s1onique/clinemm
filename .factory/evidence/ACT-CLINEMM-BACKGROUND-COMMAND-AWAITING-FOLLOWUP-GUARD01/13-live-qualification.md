LIVE QUALIFICATION — BCAFG01

Per ACT §17, after GREEN, a fresh VSIX should be rebuilt/installed
and the exact LIVE command should be re-run to verify the fix
under the repaired contract.

THIS ACT DID NOT REPAIR PRODUCTION SOURCE.
NO VSIX REBUILD WAS PERFORMED.
NO LIVE RE-RUN WAS ATTEMPTED.

Per ACT §12, the LIVE qualification is only meaningful AFTER a
repair is applied and GREEN. Since this ACT stopped at the
discriminator (verdict = CAPTURE_INSUFFICIENT for repair
authorization), the LIVE qualification step is deferred to the
next ACT that will perform the actual bounded repair.

If the next ACT applies a H2a repair (e.g., the owner identity
slot is guaranteed stamped at CommandJobManager.start), the
rebuild + LIVE re-run will be mandatory.

If the next ACT applies a H2b repair (e.g., the lookup queries
the sessionId-at-start-time rather than the activeSession.sessionId),
the same rebuild + LIVE re-run applies.

Until then, this evidence file is intentionally empty of
qualification data.
