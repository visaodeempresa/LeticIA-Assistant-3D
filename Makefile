# ==============================================================================
# LetícIA-Assistant-3D - Automation Makefile
# ==============================================================================

.PHONY: help dev audit clean

help:
	@echo "Available commands in LetícIA-Assistant-3D:"
	@echo "  make dev     - Start local Three.js 3D Avatar Studio server (port 8080)"
	@echo "  make audit   - Inspect 3D GLB meshes, textures, and file size limits"
	@echo "  make clean   - Remove temporary files and caches"

dev:
	@./scripts/run-dev.sh

audit:
	@./scripts/audit-assets.sh

clean:
	@find . -type f -name ".DS_Store" -delete
	@find . -type f -name "*.tmp" -delete
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@echo "[OK] Workspace cleaned."
