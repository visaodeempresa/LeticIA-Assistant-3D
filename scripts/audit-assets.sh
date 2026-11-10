#!/usr/bin/env bash
# ==============================================================================
# audit-assets.sh - 3D Assets, Textures & GLB Size Auditor
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
BLUE="\033[0;34m"
NC="\033[0m"

echo -e "${BLUE}=== 3D Assets & GLB Models Audit ===${NC}"

find "${ROOT_DIR}" -path "${ROOT_DIR}/.git" -prune -o -type f \( -name "*.glb" -o -name "*.gltf" -o -name "*.hdr" -o -name "*.exr" -o -name "*.png" -o -name "*.mp4" \) -print | sort | while read -r file; do
  size_bytes=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
  size_mb=$(awk -v b="$size_bytes" 'BEGIN { printf "%.2f", b / (1024*1024) }')
  rel_path="${file#"${ROOT_DIR}/"}"

  if [ "$size_bytes" -gt 104857600 ]; then
    echo -e "${RED}[CRITICAL > 100MB] ${rel_path} (${size_mb} MB) -> Exceeds GitHub limit! Requires Git LFS.${NC}"
  elif [ "$size_bytes" -gt 52428800 ]; then
    echo -e "${YELLOW}[WARNING > 50MB]   ${rel_path} (${size_mb} MB) -> Accepted by GitHub with soft size warning.${NC}"
  else
    echo -e "${GREEN}[OK <= 50MB]       ${rel_path} (${size_mb} MB)${NC}"
  fi
done

echo -e "\n${BLUE}=== Primary Web 3D Model Summary ===${NC}"
WEB_GLB="${ROOT_DIR}/reverse/assets/avatar-web.glb"
if [ -f "$WEB_GLB" ]; then
  echo -e "${GREEN}avatar-web.glb is present:${NC}"
  ls -lh "$WEB_GLB" | awk '{print "Size: "$5", Last Modified: "$6" "$7" "$8}'
else
  echo -e "${RED}[MISSING] avatar-web.glb not found!${NC}"
  exit 1
fi
