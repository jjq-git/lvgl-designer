#!/usr/bin/env bash
set -Eeuo pipefail

archive=${1:?archive path is required}
release_id=${2:?release id is required}
sync_tool=${3:?sync tool path is required}

root=/home/jiao/lvgl-designer
staging_root="$root/.deploy-staging"
backup_root="$root/.deploy-backups"
data_root="$root/lvgl_data"

if [[ ! "$release_id" =~ ^[0-9A-Za-z._-]+$ ]]; then
    echo 'Invalid release metadata.' >&2
    exit 2
fi
if [[ "$archive" != "$staging_root/"* ]] || [[ ! -f "$archive" ]]; then
    echo 'Archive is outside the deployment staging directory or does not exist.' >&2
    exit 2
fi
if [[ "$sync_tool" != "$staging_root/"* ]] || [[ ! -f "$sync_tool" ]]; then
    echo 'Sync tool is outside the deployment staging directory or does not exist.' >&2
    exit 2
fi

mkdir -p "$staging_root" "$backup_root"
exec 9>"$root/.deploy.lock"
flock -w 180 9 || { echo 'Another deployment holds the lock.' >&2; exit 3; }

stage=$(mktemp -d "$staging_root/lvgl-data-$release_id-XXXXXX")
cleanup() {
    rm -rf -- "$stage"
}
trap cleanup EXIT

if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    echo 'Archive contains an unsafe path.' >&2
    exit 2
fi
tar -xzf "$archive" -C "$stage"
test -f "$stage/projects.db"
test -f "$stage/assets.db"

systemctl --user stop lvgl-designer-worker.service lvgl-designer-api.service
restore_services=true
trap 'if [[ "$restore_services" == true ]]; then systemctl --user start lvgl-designer-worker.service lvgl-designer-api.service || true; fi; cleanup' EXIT

if ! "$root/.venv/bin/python" "$sync_tool" merge \
    "$stage" "$data_root" "$backup_root" "$release_id" --owner-id 1; then
    backup="$backup_root/lvgl-data-$release_id"
    rm -f "$data_root/projects.db-wal" "$data_root/projects.db-shm"
    rm -f "$data_root/assets.db-wal" "$data_root/assets.db-shm"
    [[ -f "$backup/projects.db" ]] && cp -f "$backup/projects.db" "$data_root/projects.db"
    [[ -f "$backup/assets.db" ]] && cp -f "$backup/assets.db" "$data_root/assets.db"
    exit 1
fi

systemctl --user start lvgl-designer-worker.service lvgl-designer-api.service
healthy=false
for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 http://127.0.0.1:8003/api/health >/dev/null; then
        healthy=true
        break
    fi
    sleep 1
done
if [[ "$healthy" != true ]]; then
    systemctl --user stop lvgl-designer-worker.service lvgl-designer-api.service || true
    backup="$backup_root/lvgl-data-$release_id"
    rm -f "$data_root/projects.db-wal" "$data_root/projects.db-shm"
    rm -f "$data_root/assets.db-wal" "$data_root/assets.db-shm"
    cp -f "$backup/projects.db" "$data_root/projects.db"
    cp -f "$backup/assets.db" "$data_root/assets.db"
    systemctl --user start lvgl-designer-worker.service lvgl-designer-api.service || true
    exit 1
fi

restore_services=false
rm -f -- "$archive" "$sync_tool"
echo "LVGL project data synchronized: $release_id"
