# Source Binding

This file binds the symbolized trap path to the exact Electron / Chromium / V8 / Node / VSCodium versions whose binary produced the live SIGTRAP crash packet. Source-line references are for retrospective forensic localization only; no ClineMM production repair is performed in this ACT.

## Installed binary identity (Phase A — PROVEN)

| Source                   | Value                                                         |
|--------------------------|---------------------------------------------------------------|
| Crash image index        | usedImages[2]                                                 |
| Crash image name         | Electron Framework                                            |
| Crash image arch         | arm64                                                         |
| Crash image base (dec)   | 4492492800                                                    |
| Crash image uuid (lower) | 4c4c445a-5555-3144-a15d-57158a209f31                          |
| Installed binary path    | /Applications/VSCodium.app/.../Electron Framework.framework/Versions/A/Electron Framework |
| Installed binary uuid    | 4C4C445A-5555-3144-A15D-57158A209F31 (arm64) — **MATCH**       |
| Installed binary sha256  | 04c6edcf10d7c197e0773f6c86eefe1437b7f55a09d4799cf576e57afca06bec |

UUID binding is the only authority for atos. The runtime binary carries **no embedded DWARF** (`__debug` section count = 0). The LC_SYMTAB fallback alone produces the misleading `ares_dns_rr_get_ttl` label; all symbolization in this ACT uses the upstream dSYM tarball, never the runtime binary.

## Version inventory (Phase G — DISCOVERED FROM INSTALLED BINARY, NOT GUESSED)

Discovered via embedded version strings in the runtime binary, cross-referenced with the upstream Electron 42 blog post and the Electron v42.2.0 release notes.

| Component  | Version              | Provenance                                                                  |
|------------|----------------------|-----------------------------------------------------------------------------|
| Electron   | 42.2.0               | CFBundleVersion of Electron Framework.framework/Resources/Info.plist; dSYM/Contents/Info.plist agrees |
| Chromium   | 148.0.7778.97        | strings Electron Framework — version-stamped embedded                       |
| V8         | 14.8.178.14          | strings Electron Framework                                                  |
| Node.js    | 24.15.0              | strings Electron Framework                                                  |
| VSCodium   | 1.126.04524          | app/package.json                                                            |
| macOS      | 14.7.4 (23H420)      | .ips header os_version                                                      |
| Xcode      | 16.4 (16F6) / DTXcode 1640 | Electron Framework.framework/Resources/Info.plist DTXcodeBuild       |

The Electron 42 release notes (https://www.electronjs.org/blog/electron-42-0) quote Chromium 148.0.7778.96 for the family; the installed binary carries 148.0.7778.97 (a `.97` rolling patch).

## Symbolized trap source-of-truth (Phase D + E — PROVEN)

Command:

```
atos -arch arm64 -o '/tmp/electron-dsym/Electron Framework.dSYM/Contents/Resources/DWARF/Electron Framework' -l 0x10bc60000 0x11137a01c
```

Output:

```
partition_alloc::internal::OnNoMemoryInternal(unsigned long)  (in Electron Framework)  (oom.cc:85)
```

The upstream Chromium source for this trap (commit `87740a8` is the v42.2.0 release commit per GitHub) lives in the Chromium source tree under `partition_alloc/oom.cc`. The body of `OnNoMemoryInternal` calls `base::ImmediateCrash()` — a deliberate SIGTRAP reached when PartitionAlloc cannot back an allocation.

### Path through V8 (frames 4..6 from 08-faulting-thread-symbolization.json)

```
(anonymous namespace)::V8OOMErrorCallback(char const*, v8::OOMDetails const&)               // node_bindings.cc:202 (Electron)
v8::Utils::ReportOOMFailure(v8::internal::Isolate*, char const*, v8::OOMDetails const&)    // api.cc (Chromium V8)
v8::internal::V8::FatalProcessOutOfMemory(v8::internal::Isolate*, char const*, OOMDetails) // api.cc:280 (Chromium V8)
```

`base::ImmediateCrash()` semantics: per `base/immediate_crash.h`, this is an `__builtin_trap()`-equivalent; on arm64 it produces `BRK 0`, which macOS reports as `EXC_BREAKPOINT / SIGTRAP / trace trap:5`. The diagnosis is **OOM-driven, not assertion-driven**.

## What this is NOT

- **Not** `ares_dns_rr_get_ttl` — that label came from the runtime LC_SYMTAB fallback that this ACT explicitly avoided by UUID-binding atos to the dSYM.
- **Not** `v8::internal::compiler::*CompilationDependencies::*` (frame 10 in the unsymbolized report) — also an LC_SYMTAB alias.
- **Not** a Node `CHECK` / `DCHECK` — no Node CHECK frames appear in the symbolicated trace.
- **Not** a native third-party addon — image 8 is anonymous (zero-base) and is explicitly not guessed, per the SYMBOL-05 invariant.

## What is now required before any ClineMM repair is authorized

Per ACT §17 and §18, the repair matrix is dependent on causal attribution. NT3 with pending ablation → no repair until ablation. NT4 with ablated ClineMM seam → successor repair ACT names that seam. NT6/NT7 unresolved → no repair.

Therefore the immediate successor ACT is one of:

- `ACT-CLINEMM-EXTENSION-HOST-NATIVE-TRAP-CAUSALITY01` — run with-ClineMM vs without-ClineMM ablation; record whether the trap reproduces in both, only one, or with shifted symbols.
- If OOM reproduces with or without ClineMM: this trap is independent of ClineMM and the chain closes; track upstream as `ACT-CLINEMM-EXTENSION-HOST-OOM-UPSTREAM-REPORT01`.
- If OOM reproduces only with ClineMM: ablation narrows to a specific ClineMM seam (background-command lifecycle, timer/callback lifecycle, seatbelt/cgroup resource usage, or memory-bound session-state accumulation), and the successor repair ACT names that seam.
