$ErrorActionPreference = 'Stop'

# The ui.podsc.com Actions runner lives in the default Ubuntu WSL distro. A
# rootless Podman container alone does not keep the WSL VM alive, so keep one
# foreground process attached for as long as the scheduled task is running.
& wsl.exe -d Ubuntu -- bash -lc @'
set -eu
systemctl --user start podman.socket podman.service
curl -fsS -X POST \
  --unix-socket /run/user/1000/podman/podman.sock \
  http://localhost/v1.41/containers/gitea-ui-podsc-runner/start \
  >/dev/null 2>&1 || true
while :; do
  sleep 300
done
'@

exit $LASTEXITCODE
