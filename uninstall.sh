#!/usr/bin/env bash
set -euo pipefail

home=${HERDR_APP_HOME:-"$HOME/.config/herdr-app"}
stamp=$(date +%Y%m%d-%H%M%S)
backup="$home/backups/orchestrator-inbox-uninstall-$stamp"

command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }
mkdir -p "$backup/mods" "$backup/layouts"
[ ! -f "$home/keys.json" ] || cp "$home/keys.json" "$backup/keys.json"
[ ! -f "$home/layouts/orchestrator-inbox.json" ] || cp "$home/layouts/orchestrator-inbox.json" "$backup/layouts/orchestrator-inbox.json"
[ ! -d "$home/mods/orchestrator-inbox" ] || cp -R "$home/mods/orchestrator-inbox" "$backup/mods/orchestrator-inbox"
[ ! -d "$home/mods/orchestrator-workspace-chrome" ] || cp -R "$home/mods/orchestrator-workspace-chrome" "$backup/mods/orchestrator-workspace-chrome"

rm -rf "$home/layouts/orchestrator-inbox.json" "$home/mods/orchestrator-inbox" "$home/mods/orchestrator-workspace-chrome"

python3 - "$home/keys.json" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
if not path.exists():
    raise SystemExit(0)
data = json.loads(path.read_text())
wanted = {
    "cmd-shift-i": "orchestrator-workspace-chrome.toggle-inbox",
}
global_keys = data.get("global", {})
for key, action in wanted.items():
    if global_keys.get(key) == action:
        global_keys.pop(key)
if not global_keys:
    data.pop("global", None)
path.write_text(json.dumps(data, indent=2) + "\n")
PY

printf 'Removed Herdr Orchestrator Inbox.\nBackup: %s\n' "$backup"
