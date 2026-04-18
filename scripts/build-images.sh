#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PARENT_DIR="$(cd "${REPO_ROOT}/.." && pwd)"

GHCR_OWNER="${GHCR_OWNER:-wcherry}"
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
  esac
done

if [ "$SKIP_BUILD" = "true" ]; then
  echo "Skipping image build (--skip-build)"
  exit 0
fi

SERVICES=(auth drive docs sheets slides photos notes calendar worker web)

for SERVICE in "${SERVICES[@]}"; do
  IMAGE="neutrino-${SERVICE}:test"
  REPO_PATH="${PARENT_DIR}/neutrino-${SERVICE}"

  if [ -d "$REPO_PATH" ]; then
    echo ""
    echo "=== Building neutrino-${SERVICE} from local source ==="
    docker build --no-cache -t "$IMAGE" "$REPO_PATH"
  else
    echo ""
    echo "=== neutrino-${SERVICE}: local repo not found — pulling from GHCR ==="
    REMOTE_IMAGE="ghcr.io/${GHCR_OWNER}/neutrino-${SERVICE}:latest"
    docker pull "$REMOTE_IMAGE"
    docker tag "$REMOTE_IMAGE" "$IMAGE"
    echo "Tagged ${REMOTE_IMAGE} as ${IMAGE}"
  fi
done

echo ""
echo "All images ready."
