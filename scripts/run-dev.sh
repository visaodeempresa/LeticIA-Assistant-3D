#!/usr/bin/env bash
# ==============================================================================
# run-dev.sh - Local 3D Avatar Studio Development Server
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PORT="${1:-8080}"

echo "========================================================"
echo " Starting LetícIA-Assistant-3D Studio (Three.js r178)   "
echo " Root directory: ${ROOT_DIR}/reverse                    "
echo " Port: ${PORT}                                          "
echo " Open in browser: http://localhost:${PORT}              "
echo "========================================================"

cd "${ROOT_DIR}/reverse"
exec python3 -m http.server "${PORT}"
