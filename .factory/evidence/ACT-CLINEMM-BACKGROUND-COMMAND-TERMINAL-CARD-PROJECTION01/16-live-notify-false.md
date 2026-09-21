16 — LIVE Notify-False (Operator Dogfood, Pending)
=====================================================

SCENARIO:
  Start this in the background and return immediately.
  Do not notify me when it finishes:
  sh -c 'echo STARTED; sleep 30; echo FINISHED'

EXPECTED WHILE RUNNING:
  ● Backgrounded
  Cancel

EXPECTED AFTER 30s:
  No model notification (notify=false is the default)
  BUT card transitions to terminal / no Cancel

This ACT proves the row projection is INDEPENDENT of the notify
marker (BCNT01 family already qualified notify-on-terminal in the
predecessor ACT). BCTCP-CTL-04 (deadline) + BCTCP-CTL-03 (cancelled)
+ BCTCP-02 (natural exit) all assert the row regardless of whether
notify is requested. No BCTCP test sets up notify — the projection
updates unconditionally on terminal.
