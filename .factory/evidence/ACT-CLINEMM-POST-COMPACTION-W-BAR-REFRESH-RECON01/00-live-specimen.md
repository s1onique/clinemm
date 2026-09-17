# 00-live-specimen.md

EVIDENCE = LIVE_UI

COMPACTION_MODE = manual

PRE_W_DIVIDER  = 382.3k
POST_W_DIVIDER = 29.6k

PRE_MESSAGES  = 419
POST_MESSAGES = 39

TOP_BAR_AFTER_COMPACTION = 412.7k

OBSERVATION =
  Manual compaction completed successfully
  Divider updated 382.3k → 29.6k
  Message-count reduction updated 419 → 39
  Persistent top context bar did NOT reflect the compacted result
  Bar shows 412.7k, a delta of ≈383.1k from the divider POST

DELTA = 383.1k tokens (lit. POST_W to TOP_BAR_AFTER)

UNKNOWN_TOP_BAR_BEFORE = UNOBSERVED
  Cannot claim 412.7k was the pre-compaction value.
  The bar may have been larger, smaller, or the same.

ENTRY_HEAD = c1eb079bf9700388bd7440daea10808360db7d18
ENTRY_TREE = 9c17c8f076e8960ccc00dfb8fb75e4a04c915b3c
BRANCH     = main
WORKTREE   = clean

PRIMARY_QUESTION =
  Why does the manual-compaction completion path publish/display a
  compacted result of roughly 29.6k working tokens while the persistent
  top working-context bar continues to show roughly 412.7k?
