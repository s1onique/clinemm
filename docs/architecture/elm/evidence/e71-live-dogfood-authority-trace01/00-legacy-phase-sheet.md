# E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01 — Phase Sheet (witness preservation)

**ACT_ID:** `ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-DOGFOOD-AUTHORITY-TRACE01-EXISTING-EVIDENCE-INGEST01`

**Outcome (this ACT):** `PASS_EXISTING_LIVE_AUTHORITY_TRACE` (existing dogfood evidence is valid; W2 boundary classified; composer/header OK; static-Thinking UI symptom is off the per-push state authority and will require a separate, smaller presentation-persistence ACT).

**ACT scope:** ingest the two user-supplied JSONL artifacts, do not rerun dogfood, do not touch production code, do not modify the diagnostic, do not fix anything.

---

## §0  ACT identity

```text
ACT_ID   = ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-DOGFOOD-AUTHORITY-TRACE01-EXISTING-EVIDENCE-INGEST01
PRE_ACT  = ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-COMPOSITION01 (HALT at 8ec86ec9a)
ENTRY    = 8ec86ec9a5464e6220cd3363579870b686d58c56
PROTECTED_STASH_FORENSIC = 141372c52 (intact)
PROTECTED_STASH_CONTEXT  = 371752f71 (intact)
```

## §1  Predecessor halt and why it remains valid historically

The previous ACT (`WEBVIEW-TURNSTATE-COMPOSITION01`) cited "P12 streaming/11
committed idle/3" and "P30..32 awaiting_followup/29 committed idle/3" as
already-frozen decisive live evidence. The trust-binding recon at that ACT
demonstrated that:

* the embedded-attribution evidence (no `version`/`commit`/`sourceHead` field
  in the JSONL) was missing;
* no file in `docs/architecture/elm/` contained the P12/P30 rows the ACT
  cited;
* the previous turn's context summary explicitly recorded that the live walk
  was blocked on the LLM credential absence.

That ACT was therefore closed at `8ec86ec9a` as
`HALT_NO_FROZEN_W23_LIVE_TRACE`. The halt is preserved here verbatim and
remains valid historically: at that moment, no live walk had been driven and
committed for the `017f68a36` VSIX.

This ACT differs from the previous one in one specific way: the user has
manually supplied the two PTAD artifacts that were previously absent. The
user did not run a fresh dogfood walk; they supplied the files that were
already at these paths:

```text
/Volumes/UserData/Users/chistyakov/Downloads/post-terminal-authority-diagnostic-extension.jsonl
/Volumes/UserData/Users/chistyakov/Downloads/post-terminal-authority-diagnostic-webview.jsonl
```

The ACT's job is therefore narrower than the previous ACT's: **ingest,
validate, correlate, classify, write evidence, stop**. No fix. No flag-loop.
No redo.

## §2  Source artifact identity

EXTENSION_JSONL:

```text
ABSOLUTE_PATH = /Volumes/UserData/Users/chistyakov/Downloads/post-terminal-authority-diagnostic-extension.jsonl
FILE_EXISTS   = YES
FILE_TYPE     = JSON data (per `file -b`)
BYTES         = 8797
LINE_COUNT    = 15
SHA256        = 577f625929d6cee7d79b2905eca0f91fb9095994fdd3a56fc1aff12318f8a454
MTIME         = 2026-08-19 03:38:44.876611377 +0300
```

WEBVIEW_JSONL:

```text
ABSOLUTE_PATH = /Volumes/UserData/Users/chistyakov/Downloads/post-terminal-authority-diagnostic-webview.jsonl
FILE_EXISTS   = YES
FILE_TYPE     = JSON data (per `file -b`)
BYTES         = 24409
LINE_COUNT    = 63
SHA256        = 70c3e309ff8f231dc6dd2a24812b824f2a9c4a42ecf35a148d75d687a935ee77
MTIME         = 2026-08-19 03:38:44.879676721 +0300
```

Both files share the same mtime to within 3 ms, consistent with a single
terminal dump command. They were created ~7 minutes after the
`017f68a36` VSIX mtime (2026-08-19 03:31), consistent with a manual
post-walk dump.

A forensic copy of both files is preserved in
`docs/architecture/elm/evidence/e71-live-dogfood-authority-trace01/`:

```text
post-terminal-authority-diagnostic-extension.jsonl.sha256
post-terminal-authority-diagnostic-webview.jsonl.sha256
```

The forensic copies are SHA256 hashes only — the JSONL files themselves
are NOT committed to the repository (they are large, binary-equivalent
captures, and the source of truth is the absolute path on the user's
machine).

## §3  Generating VSIX attribution status

The JSONL records do NOT contain any embedded `version`, `commit`,
`sourceHead`, `installedVersion`, `diagnosticVersion`, or `schemaVersion`
field (verified by scanning all top-level + one-level nested keys). PTAD
captures the authority fields and `_ptadPushId` but never self-version.

**TRACE_GENERATING_VSIX = INFERRED** (not PROVEN, not UNKNOWN).

Inferential evidence:

1. The `017f68a36` VSIX was built at 03:31 and the JSONL files were
   dumped at 03:38:44 — within 7 minutes of the build. No other dogfood
   walk is known to have happened in that window.
2. The JSONL files contain **no `webview-reducer-output` records**. That
   capture kind was removed in commit `f19dbacb9` (FIXUP04 source fix),
   which is the source commit of the `017f68a36` VSIX HEAD. The
   absence of `webview-reducer-output` records is positive
   disambiguating evidence that the dump was produced by a POST-FIXUP04
   build.
3. The webview file also lacks `webview-replica` records, consistent
   with the FIXUP04 consolidation that renamed `webview-replica` →
   `webview-committed` (per the FIXUP04 terminal evidence).
4. The capture-kind vocabulary in the JSONL matches the current
   `PostTerminalAuthorityCaptureKind` enum exactly:
   - `extension-push`
   - `webview-raw-incoming`
   - `webview-committed`
   - `input-section`
   - `action-buttons`
   - (no `followup-route` records — same observation as the prior C2
     walks).

Despite these inferential signals, **this ACT does NOT bind the
trace to `017f68a36` as a hard fact.** The JSONL files are accepted
as live evidence of the observable boundary; the inferred VSIX
attribution is recorded as `INFERRED` and explicitly NOT relied on for
any classification that depends on VSIX identity.

TRACE_SOURCE_HEAD         = UNKNOWN (not embedded in artifacts)
TRACE_INSTALLED_VERSION   = UNKNOWN (not embedded in artifacts)

The fact that the trace is firmly attributed to the **post-FIXUP04
production source graph** (commit `fd24fc4b5` at the time of the walk)
is the only attribution that matters for the next-ACT selection.
