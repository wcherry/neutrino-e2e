#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cleanup() {
  echo ""
  echo "Interrupted — tearing down Docker stack..."
  docker compose -f "${REPO_ROOT}/docker-compose-test.yml" down 2>/dev/null || true
  exit 130
}
trap cleanup INT TERM

# Generate a unique run ID and directory
RUN_ID="$(date +%Y%m%d_%H%M%S)_$(openssl rand -hex 4)"
BASE_DIR="${NEUTRINO_E2E_BASE_DIR:-/tmp/neutrino-e2e}"
export RUN_DIR="${BASE_DIR}/${RUN_ID}"

echo "Run ID  : ${RUN_ID}"
echo "Run dir : ${RUN_DIR}"
echo ""

# Create the full directory tree
mkdir -p \
  "${RUN_DIR}/data/auth" \
  "${RUN_DIR}/data/drive" \
  "${RUN_DIR}/data/docs" \
  "${RUN_DIR}/data/sheets" \
  "${RUN_DIR}/data/slides" \
  "${RUN_DIR}/data/photos" \
  "${RUN_DIR}/data/notes" \
  "${RUN_DIR}/data/calendar" \
  "${RUN_DIR}/data/workers" \
  "${RUN_DIR}/service-logs/auth" \
  "${RUN_DIR}/service-logs/drive" \
  "${RUN_DIR}/service-logs/docs" \
  "${RUN_DIR}/service-logs/sheets" \
  "${RUN_DIR}/service-logs/slides" \
  "${RUN_DIR}/service-logs/photos" \
  "${RUN_DIR}/service-logs/notes" \
  "${RUN_DIR}/service-logs/calendar" \
  "${RUN_DIR}/service-logs/workers" \
  "${RUN_DIR}/browser-logs" \
  "${RUN_DIR}/databases" \
  "${RUN_DIR}/playwright-artifacts" \
  "${RUN_DIR}/playwright-report"

# Separate --skip-build / --report from any playwright-specific args
BUILD_ARGS=()
PW_ARGS=()
SHOW_REPORT=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) BUILD_ARGS+=("$arg") ;;
    --report) SHOW_REPORT=true ;;
    *) PW_ARGS+=("$arg") ;;
  esac
done

# Build or pull images
"${SCRIPT_DIR}/build-images.sh" "${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}"

# Run Playwright (global-setup starts Docker, global-teardown stops it)
cd "$REPO_ROOT"
EXIT_CODE=0
npx playwright test "${PW_ARGS[@]+"${PW_ARGS[@]}"}" || EXIT_CODE=$?

echo ""
echo "Run artifacts saved to: ${RUN_DIR}"
echo "  Service logs : ${RUN_DIR}/service-logs/"
echo "  Browser logs : ${RUN_DIR}/browser-logs/"
echo "  Databases    : ${RUN_DIR}/databases/"
echo "  PW artifacts : ${RUN_DIR}/playwright-artifacts/"
echo "  PW report    : ${RUN_DIR}/playwright-report/"

if [ "$SHOW_REPORT" = true ]; then
  npx playwright show-report "${RUN_DIR}/playwright-report"
fi



exit $EXIT_CODE
