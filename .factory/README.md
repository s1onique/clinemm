# .factory

This directory holds **canonical Factory coordination artifacts** for Cline--.

- `epic-board.md` — the canonical project coordination board (Wave 1 → Task Census 01). It tracks the full set of Cline-- tasks (open, closed, held, deferred, NEEDS_CLASSIFICATION), the repository topology policy, the current critical path, and known P2 residue. Rows point to evidence (commits, ACTs, tests, artifacts) — they do not replace it.
- The **canonical task index** at the top of the board is the single durable source of truth for every known task. Narrative sections and the aliases table refer back to it.
- Stale board rows are P2/non-blocking. Only P0 halts, P1 gets one bounded fix cycle, P2 is batched at cleanup.
- Update the board incrementally at meaningful ACT boundaries — touch only the rows the ACT actually affects. New tasks get one row added; forgotten old tasks get one delta row added. Do not trigger another global archaeology exercise.
- Historical task IDs whose exact contract cannot be reconstructed stay in the board as `NEEDS_CLASSIFICATION` rows rather than being silently dropped or invented.

Evidence remains primary: executable tests, exact artifacts, live evidence, source truth, and Git identity outrank board rows. If they conflict, evidence wins; the row becomes stale metadata.
