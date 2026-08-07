#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${BANNERLORD_INSTALL:-/opt/bannerlord}"
INSTANCE_ROOT="${BANNERLORD_INSTANCE:-/srv/instance}"
DATA_DIR="${INSTANCE_ROOT}/data"
EXE="${INSTALL_ROOT}/BannerlordCoopServer.exe"
MODULES_ARG_FILE="${INSTANCE_ROOT}/modules.arg"

export WINEPREFIX="${WINEPREFIX:-/wineprefix}"
export WINEARCH="${WINEARCH:-win64}"
export WINEDEBUG="${WINEDEBUG:--all}"

mkdir -p "${DATA_DIR}/Game Saves" "${DATA_DIR}/logs" "${WINEPREFIX}"

# Wine refuses a prefix not owned by the current euid. Bind mounts keep the
# host agent UID, while this image runs as root — fix ownership before wine.
if [[ "$(id -u)" -eq 0 ]]; then
  chown -R root:root "${WINEPREFIX}" || true
fi

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

MODULES_ARG=""
if [[ -f "${MODULES_ARG_FILE}" ]]; then
  MODULES_ARG="$(tr -d '\r\n' < "${MODULES_ARG_FILE}" || true)"
fi

# Headless Wine: Xvfb keeps some Win32 paths happy without a real display.
Xvfb :99 -screen 0 1024x768x16 >/tmp/xvfb.log 2>&1 &
export DISPLAY=:99

cd "${INSTALL_ROOT}"
if [[ -n "${MODULES_ARG}" ]]; then
  echo "[entrypoint] starting BannerlordCoopServer.exe --data-dir ${DATA_DIR} ${MODULES_ARG}"
  exec wine "${EXE}" --data-dir "${DATA_DIR}" "${MODULES_ARG}"
else
  echo "[entrypoint] starting BannerlordCoopServer.exe --data-dir ${DATA_DIR} (no modules.arg load order)"
  exec wine "${EXE}" --data-dir "${DATA_DIR}"
fi
