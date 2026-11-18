#!/usr/bin/env bash
# bb refuses server imports outside the plugin folder, so the plugin builds and type-checks against a generated copy of the core
# (apps/bb-plugin-brandwise/core, gitignored). Tests and command-line entry points of the core are left out.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p apps/bb-plugin-brandwise/core
rsync -a --delete --exclude='*.test.ts' --exclude='migrate.ts' --exclude='contract.ts' --exclude='testing.ts' packages/core/src/ apps/bb-plugin-brandwise/core/
