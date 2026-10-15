#!/usr/bin/env bash
set -uo pipefail
EVIDENCE="$GITHUB_WORKSPACE/evidence"
FAILED=0
mkdir -p "$EVIDENCE"
run_check() {
  local name="$1"
  shift
  "$@" 2>&1 | tee "$EVIDENCE/$name.log"
  local result=${PIPESTATUS[0]}
  printf '%s=%s\n' "$name" "$result" >> "$EVIDENCE/check-exit-codes.txt"
  if test "$result" -ne 0; then FAILED=1; fi
}
run_check format pnpm exec prettier --write packages/plugins/app-plugin-project-reports packages/plugins/app-plugin-projects/server/domains/reports packages/plugins/app-plugin-projects/tests/domains/reports/daily.test.ts packages/plugins/app-plugin-agents/server/core/runs/ports.ts packages/plugins/app-plugin-agents/server/core/callers/index.ts packages/plugins/app-plugin-agents/server/composition.ts packages/plugins/app-plugin-agents/tests/server/core/callers/action-ceiling.test.ts packages/apps/studio/e2e/project-reports.test.ts packages/apps/studio/e2e/support/runner.ts packages/apps/studio/client/plugins.ts packages/apps/studio/client/styles.css packages/apps/studio/server/plugins.ts packages/apps/studio/package.json
for CHECK in typecheck test build lint; do run_check "$CHECK" pnpm --filter @nocobase/app-plugin-project-reports "$CHECK"; done
run_check projects-typecheck pnpm --filter @nocobase/app-plugin-projects typecheck
run_check projects-tests pnpm --filter @nocobase/app-plugin-projects exec vitest run tests/domains/reports/daily.test.ts
run_check agents-typecheck pnpm --filter @nocobase/app-plugin-agents typecheck
run_check agents-tests pnpm --filter @nocobase/app-plugin-agents exec vitest run tests/server/core/callers/action-ceiling.test.ts
run_check studio-typecheck env NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @nocobase/studio typecheck
if test "$FAILED" -eq 0; then
  run_check studio-build env NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @nocobase/studio build
  if test "$FAILED" -eq 0; then
    # GitHub's Ubuntu image already carries Chromium/Chrome system libraries. Install the pinned Playwright browser,
    # not an unrelated apt upgrade of system libraries and fonts. Missing libraries still fail the actual test below.
    run_check chromium timeout --signal=TERM --kill-after=20s 300s pnpm --filter @nocobase/studio exec playwright install chromium
    run_check browser timeout --signal=TERM --kill-after=20s 600s env NB_STUDIO_E2E_KEEP=1 pnpm --filter @nocobase/studio exec playwright test e2e/project-reports.test.ts --workers=1 --reporter=line
  fi
fi
if test -d packages/apps/studio/test-results; then
  mkdir -p "$EVIDENCE/browser"
  find packages/apps/studio/test-results -type f \( -name '*.md' -o -name '*.png' \) -exec cp --parents '{}' "$EVIDENCE/browser/" \;
fi
run_check changesets node scripts/validate-changesets.mjs
run_check peers pnpm peers:check
run_check runtime-deps pnpm deps:check
run_check cli-reference env NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @nocobase/studio cli-reference
# Only Studio and its dependency closure are installed. The unchanged templates have no node_modules here.
# Validate every registered Studio/plugin operation rather than booting unrelated, uninstalled applications.
run_check openapi env NODE_OPTIONS=--max-old-space-size=6144 node scripts/check-openapi.mjs studio
run_check frozen-lockfile env CI=true HUSKY=0 pnpm --filter '@nocobase/app-plugin-project-reports...' --filter '@nocobase/studio...' install --frozen-lockfile --ignore-scripts
exit "$FAILED"
