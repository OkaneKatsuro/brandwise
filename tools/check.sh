#!/usr/bin/env bash
# Everything CI checks, in one command: Markdown is English, the core's tests pass, the plugin type-checks.
# Needs the dependencies of packages/core and apps/bb-plugin-brandwise installed (npm install in each).
# Database tests run when DATABASE_URL is set or the repository has a .env; without either they skip.
set -euo pipefail
cd "$(dirname "$0")/.."
tools/check-english.sh
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then set -a; . ./.env; set +a; fi
(cd packages/core && npm test)
tools/sync-plugin-core.sh
(cd apps/bb-plugin-brandwise && node_modules/.bin/tsc --noEmit)
echo "ok: all checks passed"
