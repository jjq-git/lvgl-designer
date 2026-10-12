#!/usr/bin/env bash
set -Eeuo pipefail

commit_sha=${AUTODEPLOY_COMMIT_SHA:?AUTODEPLOY_COMMIT_SHA is required}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
deploy_root=/home/jiao/lvgl-designer
state_root=/home/jiao/.local/share/dengtec-auto-deploy
venv="$state_root/venvs/lvgl-designer"
node_bin=/home/jiao/.nvm/versions/node/v20.20.2/bin

if [[ $(git -C "$repo_root" rev-parse HEAD) != "$commit_sha" ]]; then
    echo 'Checkout does not match the requested deployment commit.' >&2
    exit 2
fi
if [[ ! "$commit_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
    echo 'Invalid deployment commit.' >&2
    exit 2
fi
if [[ ! -x "$node_bin/node" ]] || [[ ! -x "$node_bin/corepack" ]]; then
    echo "Node.js 20 and Corepack were not found in $node_bin." >&2
    exit 2
fi

export PATH="$node_bin:$PATH"
mkdir -p "$state_root/venvs" "$deploy_root/.deploy-staging"
if [[ ! -x "$venv/bin/python" ]]; then
    python3 -m venv "$venv"
fi

requirements_hash=$(sha256sum "$repo_root/backend/requirements.txt" | cut -d' ' -f1)
requirements_marker="$venv/.requirements-sha256"
if [[ ! -f "$requirements_marker" ]] || [[ $(<"$requirements_marker") != "$requirements_hash" ]]; then
    "$venv/bin/python" -m pip install -r "$repo_root/backend/requirements.txt"
    printf '%s\n' "$requirements_hash" >"$requirements_marker"
fi

cd "$repo_root"
corepack pnpm install --frozen-lockfile
corepack pnpm -r test
"$venv/bin/python" -m pytest backend/tests -q
corepack pnpm -r build

release_id="$(date +%Y%m%d-%H%M%S)-${commit_sha:0:12}"
archive="$deploy_root/.deploy-staging/incoming-lvgl-$release_id.tar.gz"
archive_tmp="$archive.tmp-$$"
cleanup() {
    rm -f -- "$archive_tmp"
}
trap cleanup EXIT

tar -czf "$archive_tmp" \
    --exclude='*/__pycache__' \
    --exclude='*/.pytest_cache' \
    --exclude='*.pyc' \
    -C "$repo_root" \
    apps/designer/dist \
    apps/build-worker/dist \
    apps/preview-host/dist \
    backend
mv "$archive_tmp" "$archive"
bash "$repo_root/scripts/deploy/remote-apply-lvgl.sh" "$archive" "$release_id" "$commit_sha"
