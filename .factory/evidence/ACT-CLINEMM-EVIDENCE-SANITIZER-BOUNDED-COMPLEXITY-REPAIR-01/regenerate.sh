#!/usr/bin/env bash
# ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
#
# Regenerate the evidence scripts' inputs, then run them.
#
#   bash regenerate.sh
#
# REQUIRES: node >= 22 (the production extension-host runtime).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
CORE="$REPO/sdk/packages/core"
PROD="$CORE/src/extensions/context/evidence-continuity.ts"

# 1. The PRODUCTION sanitizer, extracted from the real module.
python3 - "$PROD" "$HERE/new.ts" <<'PY'
import sys
src = open(sys.argv[1]).read()
i = src.index('export function sanitizeOutcomeText')
k = src.index('function redactPemPrivateKeys')
kend = src.index('\n}\n', k) + 3
open(sys.argv[2], 'w').write(src[i:kend])
PY

# 2. The PREDECESSOR sanitizer, extracted VERBATIM from the entry head.
git -C "$REPO" show \
  1d45a8d845eca27bce311949a08fca7868f211cd:sdk/packages/core/src/extensions/context/evidence-continuity.ts \
  > "$HERE/pred-full.ts"
python3 - "$HERE/pred-full.ts" "$HERE/pred.mjs" <<'PY'
import sys
src = open(sys.argv[1]).read()
i = src.index('export function sanitizeOutcomeText')
j = src.index('\n}\n', i) + 3
body = src[i:j].replace(
    'export function sanitizeOutcomeText(text: string): string {',
    'export function sanitizeOutcomeText(text) {')
open(sys.argv[2], 'w').write(body)
PY

# 3. Run the evidence scripts.
cd "$HERE"
for script in ablate.mjs ladder2.mjs difffuzz.mjs diffcases.mjs pemfuzz.mjs; do
  echo "=== $script ==="
  node "$script"
done
