#!/usr/bin/env bash
# Synchronises Rust crate versions with the @tauri-apps/plugin-* npm packages
# resolved in package-lock.json.
#
# Tauri aborts the build when npm and Rust plugin major.minor versions differ.
# This script runs `cargo update` on every tauri-plugin-* crate so Cargo.lock
# always tracks whatever the npm lockfile resolved to.
#
# Usage:
#   bash scripts/sync-tauri-plugins.sh          # from repo root
set -euo pipefail

# Skip silently when Rust is not installed (CI frontend-only steps, npm-only machines)
if ! command -v cargo &>/dev/null; then
  echo "cargo not found — skipping Tauri plugin sync"
  exit 0
fi

LOCKFILE="package-lock.json"

if [ ! -f "$LOCKFILE" ]; then
  echo "ERROR: $LOCKFILE not found — run from the repo root" >&2
  exit 1
fi

# Extract all @tauri-apps/plugin-* names from package-lock.json
plugins=$(node -e "
const lock = require('./$LOCKFILE');
const pkgs = lock.packages || {};
Object.keys(pkgs)
  .filter(k => k.startsWith('node_modules/@tauri-apps/plugin-'))
  .map(k => k.replace('node_modules/@tauri-apps/', ''))
  .forEach(p => console.log(p));
")

if [ -z "$plugins" ]; then
  echo "No @tauri-apps/plugin-* packages found in $LOCKFILE — nothing to sync"
  exit 0
fi

# Build a `-p <crate>` argument list:
#   plugin-dialog → tauri-plugin-dialog
cargo_args=()
while IFS= read -r plugin; do
  cargo_args+=("-p" "tauri-${plugin}")
done <<< "$plugins"

echo "Syncing Rust crates: ${cargo_args[*]}"
(cd src-tauri && cargo update "${cargo_args[@]}")
echo "Done — Cargo.lock updated"
