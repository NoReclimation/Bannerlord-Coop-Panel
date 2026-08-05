#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${BANNERLORD_INSTALL:-/opt/bannerlord}"
INSTANCE_ROOT="${BANNERLORD_INSTANCE:-/srv/instance}"
DATA_DIR="${INSTANCE_ROOT}/data"
EXE="${INSTALL_ROOT}/BannerlordCoopServer.exe"

export WINEPREFIX="${WINEPREFIX:-/wineprefix}"
export WINEARCH="${WINEARCH:-win64}"
export WINEDEBUG="${WINEDEBUG:--all}"

mkdir -p "${DATA_DIR}/Game Saves" "${DATA_DIR}/logs" "${WINEPREFIX}"

if [[ ! -f "${EXE}" ]]; then
  echo "[entrypoint] ERROR: missing ${EXE}" >&2
  echo "[entrypoint] Mount a shared installation at ${INSTALL_ROOT}" >&2
  exit 1
fi

if [[ ! -f "${DATA_DIR}/server-config.json" ]]; then
  echo "[entrypoint] ERROR: missing ${DATA_DIR}/server-config.json" >&2
  exit 1
fi

if [[ ! -f "${INSTANCE_ROOT}/mod-config.json" ]]; then
  echo '{"difficulty":{},"modOptions":{}}' > "${INSTANCE_ROOT}/mod-config.json"
fi

# Headless Wine: Xvfb keeps some Win32 paths happy without a real display.
Xvfb :99 -screen 0 1024x768x16 >/tmp/xvfb.log 2>&1 &
export DISPLAY=:99

cd "${INSTALL_ROOT}"
echo "[entrypoint] starting BannerlordCoopServer.exe --data-dir ${DATA_DIR}"
exec wine "${EXE}" --data-dir "${DATA_DIR}"
