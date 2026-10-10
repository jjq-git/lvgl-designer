#!/usr/bin/env bash
set -Eeuo pipefail

archive=${1:?archive path is required}
release_id=${2:?release id is required}
commit_sha=${3:?commit sha is required}

root=/home/jiao/lvgl-designer
staging_root="$root/.deploy-staging"
backup_root="$root/.deploy-backups"
dist_target="$root/apps/designer/dist"
build_worker_target="$root/apps/build-worker/dist"
preview_host_target="$root/apps/preview-host/dist"
backend_target="$root/backend"

if [[ ! "$release_id" =~ ^[0-9A-Za-z._-]+$ ]] || [[ ! "$commit_sha" =~ ^[0-9a-fA-F]+$ ]]; then
    echo 'Invalid release metadata.' >&2
    exit 2
fi
if [[ "$archive" != "$staging_root/"* ]] || [[ ! -f "$archive" ]]; then
    echo 'Archive is outside the deployment staging directory or does not exist.' >&2
    exit 2
fi

mkdir -p "$staging_root" "$backup_root"
exec 9>"$root/.deploy.lock"
flock -w 180 9 || { echo 'Another deployment holds the lock.' >&2; exit 3; }

stage=$(mktemp -d "$staging_root/lvgl-$release_id-XXXXXX")
backup="$backup_root/lvgl-$release_id"
cleanup() {
    rm -rf -- "$stage"
}
trap cleanup EXIT

if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    echo 'Archive contains an unsafe path.' >&2
    exit 2
fi
tar -xzf "$archive" -C "$stage"
test -f "$stage/apps/designer/dist/index.html"
test -f "$stage/apps/build-worker/dist/lvgl-build-worker.mjs"
test -f "$stage/apps/build-worker/dist/lvgl-site-publication-worker.mjs"
test -f "$stage/apps/preview-host/dist/preview-host.js"
test -f "$stage/apps/preview-host/dist/lvgl_runtime.wasm"
test -f "$stage/backend/app/__init__.py"
test -f "$stage/backend/requirements.txt"

"$root/.venv/bin/python" -m pip install -r "$stage/backend/requirements.txt"

if [[ -e "$backup" ]]; then
    echo "Backup already exists: $backup" >&2
    exit 2
fi
mkdir -p "$backup"
mkdir -p "$(dirname "$dist_target")"

mv "$dist_target" "$backup/designer-dist"
mv "$build_worker_target" "$backup/build-worker-dist"
mv "$preview_host_target" "$backup/preview-host-dist"
mv "$backend_target" "$backup/backend"
mv "$stage/apps/designer/dist" "$dist_target"
mv "$stage/apps/build-worker/dist" "$build_worker_target"
mv "$stage/apps/preview-host/dist" "$preview_host_target"
mv "$stage/backend" "$backend_target"

rollback() {
    echo 'Deployment failed; restoring the previous LVGL release.' >&2
    systemctl --user stop lvgl-designer-api.service lvgl-designer-worker.service || true
    [[ -e "$dist_target" ]] && mv "$dist_target" "$backup/failed-designer-dist"
    [[ -e "$build_worker_target" ]] && mv "$build_worker_target" "$backup/failed-build-worker-dist"
    [[ -e "$preview_host_target" ]] && mv "$preview_host_target" "$backup/failed-preview-host-dist"
    [[ -e "$backend_target" ]] && mv "$backend_target" "$backup/failed-backend"
    mv "$backup/designer-dist" "$dist_target"
    mv "$backup/build-worker-dist" "$build_worker_target"
    mv "$backup/preview-host-dist" "$preview_host_target"
    mv "$backup/backend" "$backend_target"
    systemctl --user start lvgl-designer-worker.service lvgl-designer-api.service || true
}

if ! systemctl --user restart lvgl-designer-worker.service lvgl-designer-api.service; then
    rollback
    exit 1
fi

healthy=false
for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 http://127.0.0.1:8003/api/health >/dev/null; then
        healthy=true
        break
    fi
    sleep 1
done
if [[ "$healthy" != true ]]; then
    rollback
    exit 1
fi

printf '%s %s\n' "$release_id" "$commit_sha" >"$staging_root/last-lvgl-release"
rm -f -- "$archive"
echo "LVGL release deployed: $release_id ($commit_sha)"
