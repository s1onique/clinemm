# LIVE Allocation Comparison

## Status

**LIVE_NOT_EXECUTED.** The author sandbox does not run a VS Code dogfood
host. The post-fix allocation profile must be measured in a follow-up
operator capture (see `09-live-before-after.md`).

## Predicted allocation collapse (from production composition)

The repair removes the TTL-driven rematerialization, which removes the
following allocation chain for every redundant listSessions call:

  Promise.all(149 readSessionManifestTitle calls)
    -> 149 readFile() → Buffer.toString() → JSON.parse()
    -> 149 SessionManifestRecord objects (each with prompt + metadata + ...)

Pre-fix (6 listSessions in 30 s):
  - 894 readSessionManifestTitle calls (6 × 149)
  - 894 Buffer.toString("utf8") -> ~5.20 MiB of string allocation
  - 894 readFile() -> file-system calls
  - 894 JSON.parse(manifest) -> CPU

Post-fix (1 listSessions in 30 s, no mutation):
  - 149 readSessionManifestTitle calls (1 × 149)
  - 149 Buffer.toString("utf8") -> ~0.87 MiB of string allocation
  - 149 readFile() -> file-system calls
  - 149 JSON.parse(manifest) -> CPU

Material reduction in the `listSessions`, `readSessionManifestTitle`,
and `Buffer.toString` allocation subtrees. (Numerically the projected
fraction of total capture allocation drops from ~21.3% to ~3.5% in the
session-listing subtree.)

This prediction is structural (it follows from removing the
6/894 redundant calls) and does not require measurement to establish
directionally. Measurement is required for closure per ACT §17.
