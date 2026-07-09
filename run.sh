#!/usr/bin/env sh
set -e

# Home Assistant writes user options here. If the file exists, expose it to the
# app via env var so it can be loaded on startup. Absent in local dev.
if [ -f /data/options.json ]; then
    export RTSPVIEWER_OPTIONS_FILE=/data/options.json
    echo "[run] loaded HA options from /data/options.json"
else
    echo "[run] /data/options.json not present, using defaults / env"
fi

mkdir -p "${HLS_ROOT:-/tmp/rtspviewer}"

exec dotnet /app/RtspViewer.dll
