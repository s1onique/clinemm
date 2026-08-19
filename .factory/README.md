# .factory

This directory holds **canonical Factory coordination artifacts** for Cline--.

- `epic-board.md` — the canonical project coordination board (Wave 1). It tracks active/closed epics, repository topology policy, the current critical path, and known P2 residue. Rows point to evidence (commits, ACTs, tests, artifacts) — they do not replace it.
- Stale board rows are P2/non-blocking. Only P0 halts, P1 gets one bounded fix cycle, P2 is batched at cleanup.
- Update the board incrementally at meaningful ACT boundaries — touch only the rows the ACT actually affects.

Evidence remains primary: executable tests, exact artifacts, live evidence, source truth, and Git identity outrank board rows. If they conflict, evidence wins; the row becomes stale metadata.
