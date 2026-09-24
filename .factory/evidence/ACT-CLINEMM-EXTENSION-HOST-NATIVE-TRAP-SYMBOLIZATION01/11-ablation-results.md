# Ablation Results

> **Status: deferred to ACT-CLINEMM-EXTENSION-HOST-NATIVE-TRAP-CAUSALITY01**

This ACT, per C1 ("GO for symbolization/evidence acquisition. Production repair remains unauthorized.") and per scope §11 ("Only after NT1–NT5 yields a concrete native trap site should this ACT test whether ClineMM is necessary"), is the *evidence-acquisition* ACT. The ablation against running VSCodium is *authorized* but **must be the next ACT**. Running ClineMM-enabled vs ClineMM-disabled ablation sessions against a real VSCodium install would:

1. Take 30–60 min per run × 2 (the original crash reproduced ~1m18s after Extension Host start, see parent-lifecycle observation window in `parent-lifecycle.live.json`).
2. Require careful forensic launch isolation (per ACT §11: *"Do not casually disable every extension if doing so changes Extension Host topology. Preserve the same VSCodium version and isolated user-data mechanism."*).
3. Need to be a fresh ACT whose RED proof starts from "real crash → exact trap symbol → exact source invariant → RED reproduction → necessity/ablation" (per §18), not bolted into this ACT.

## Why deferred is the correct terminal for THIS ACT

This ACT's task is closed:

- Phase A — UUID binding PROVEN (matching UUIDs).
- Phase B — crash-PC/image binding PROVEN (decimal proof: 4583825436 − 4492492800 = 91332636).
- Phase C — matching dSYM obtained from authoritative upstream (Electron GitHub release asset, SHA-256 verified against SHASUMS256.txt).
- Phase D — exact-PC symbolization PROVEN (`partition_alloc::internal::OnNoMemoryInternal(unsigned long) oom.cc:85`).
- Phase E — faulting-thread symbolization PROVEN (40 frames, imageIndex=8 explicitly UNKNOWN, imageIndex=2 bound to dSYM).
- Phase F — trap classification COMPLETED (NT3 with NT2 layered).
- Phase G — source binding COMPLETED (Electron 42.2.0 / Chromium 148.0.7778.97 / V8 14.8.178.14 / Node 24.15.0 / VSCodium 1.126.04524).

The trap site is concrete and named. ClineMM necessity is **not yet determined** — and is the load-bearing question left for the next ACT.

## Required precondition for ACT-CLINEMM-EXTENSION-HOST-NATIVE-TRAP-CAUSALITY01

```
A.  ClineMM enabled + frozen reproducer
    workload:   notify-enabled background command (the same foreground
                that the live specimen produced on 2026-09-24T18:46+
                and that the .ips reports on 2026-09-24T18:48:22+)
    env:        CLINE_DIR=/Users/.../.vscodium-clinemm-live/run-XXXXX
                same VSCodium 1.126.04524, same Electron Framework
                4c4c445a-5555-3144-a15d-57158a209f31 binary, same isolated
                user-data

B.  ClineMM disabled / minimal extension set
    workload:   same notify-enabled background command (or surrogate
                workload that exercises the same code paths without
                the ClineMM side)
    env:        same VSCodium, same Electron, same isolated user-data

For each:
  - did Extension Host become unresponsive?
  - did it crash?  (if yes) exception type?  signal?  crash PC?
    symbolized trap site?  time-to-failure?

Required interpretation (ACT §11):
  same native trap with ClineMM disabled
      => ClineMM necessity REFUTED  => NO ClineMM production repair
  trap reproducible only with ClineMM enabled
      => ClineMM association strengthened
      => still require a narrower ClineMM seam ablation
  specific ClineMM seam ablation removes trap
      => necessity established  => successor repair ACT authorized
```

## Halt conditions the successor ACT must enforce

- `HALT_ABLATION_CHANGES_UNRELATED_RUNTIME` — if specimen B with ClineMM disabled also drops other extensions, that is a topology change and the run is invalid; the comparison must hold extension topology constant *except* for the single ClineMM enablement.
- UUID consistency — every specimen B crash report must bind its image-2 UUID to `4c4c445a-5555-3144-a15d-57158a209f31` (same binary, same Electron build).
- dSYM re-use — the matching `electron-v42.2.0-darwin-arm64-dsym.tar.xz` (sha256 `5a341581905b84ae62b4f7664c0fd950ec78fef172042dd8b55dc2a8d9aea66a`) keeps the symbolization authoritative; specimen B must use the same dSYM path on the same atos invocation shape.

If the next ACT's ablation does not produce a reproducer (within its operator-driven scope, see ACT-LIVE-CLASSIFICATION01 which authorizes live specimens to operators, not to this ACT), then the ClineMM branch closes and the upstream report path opens.
