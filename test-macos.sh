#!/usr/bin/env bash
set -euo pipefail

# Launch a reproducible comparison in a profile dedicated to this test build.
# Usage: bash test-macos.sh on "/path/to/Code - OSS.app"
mode="${1:-on}"
case "$mode" in on|off) ;; *) echo 'Choose on or off.' >&2; exit 1 ;; esac
app="${2:-$(cd "$(dirname "$0")" && pwd)/Code - OSS.app}"
if [[ ! -x "$app/Contents/MacOS/Code - OSS" ]]; then
  echo 'Pass the extracted Code - OSS.app path as the second argument.' >&2
  exit 1
fi
profile="$HOME/Library/Application Support/Code OSS Editor GPU Test"
extensions="$HOME/.vscode-oss-editor-gpu-test/extensions"
mkdir -p "$profile/User" "$extensions"
cat > "$profile/User/settings.json" <<JSON
{
  "editor.experimentalGpuAcceleration": "$mode",
  "editor.fontFamily": "JetBrains Mono, Menlo, monospace",
  "editor.fontSize": 14,
  "editor.minimap.enabled": false,
  "workbench.colorTheme": "Quiet Light",
  "workbench.fontAliasing": "antialiased",
  "telemetry.telemetryLevel": "off"
}
JSON
fixture="$profile/editor-gpu-60000.txt"
ELECTRON_RUN_AS_NODE=1 "$app/Contents/MacOS/Code - OSS" -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],Array.from({length:60000},(_,i)=>`const line${i+1} = "GPU renderer large-file test";`).join("\n"));' "$fixture"
"$app/Contents/Resources/app/bin/code" --user-data-dir "$profile" --extensions-dir "$extensions" --shared-data-dir "$profile/shared-data" --disable-extensions --skip-welcome --skip-release-notes --new-window "$fixture"
