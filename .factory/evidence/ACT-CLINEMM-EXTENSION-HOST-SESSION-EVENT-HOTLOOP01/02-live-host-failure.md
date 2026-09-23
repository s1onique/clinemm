# 02 — LIVE Host Failure Observation

## VSCodium automatic capture

```text
VSCodium local Extension Host
→ becomes UNRESPONSIVE
→ automatic profiler attaches
→ captures CPU profile
→ ClineMM identified as dominant contributor
→ extension host terminates unexpectedly
→ automatically restarts
```

VS Code runs extensions in a shared Node.js Extension Host. Because
JavaScript execution there is single-threaded, one extension can
monopolize that process and make all hosted extensions unresponsive.
VS Code explicitly captures CPU profiles when this occurs
([Microsoft/vscode Wiki][1]).

## Profile metadata

```text
file:        /Volumes/UserData/Users/chistyakov/Downloads/exthost-66cdb2.cpuprofile
size:        362,814 bytes
nodes:       284
samples:     38,457
deltas:      38,457
duration:    5,379.2 ms
extension:   s1onique.clinemm-4.1.16-99006fbcc
installed:   /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/
source HEAD: 99006fbccaacb150b78e54dad7bdadc2a1390238
```

[1]: https://github.com/microsoft/vscode/wiki/Explain-extension-causes-high-cpu-load