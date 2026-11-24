#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
home=${HERDR_APP_HOME:-"$HOME/.config/herdr-app"}
stamp=$(date +%Y%m%d-%H%M%S)
backup="$home/backups/orchestrator-inbox-$stamp"

command -v herdr-app >/dev/null 2>&1 || { echo "herdr-app is required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }
mkdir -p "$home/mods" "$home/layouts"

python3 - "$home/keys.json" "$root/keys.json" <<'PY'
import json, sys
from pathlib import Path
current_path, wanted_path = map(Path, sys.argv[1:])
current = json.loads(current_path.read_text()) if current_path.exists() else {}
wanted = json.loads(wanted_path.read_text())
for section, bindings in wanted.items():
    existing = current.get(section, {})
    for key, action in bindings.items():
        if key in existing and existing[key] != action:
            raise SystemExit(f"shortcut conflict: {section}.{key} is {existing[key]!r}, package needs {action!r}")
PY

mkdir -p "$backup/mods" "$backup/layouts"
[ ! -f "$home/keys.json" ] || cp "$home/keys.json" "$backup/keys.json"
[ ! -f "$home/layouts/orchestrator-inbox.json" ] || cp "$home/layouts/orchestrator-inbox.json" "$backup/layouts/orchestrator-inbox.json"
[ ! -d "$home/mods/orchestrator-inbox" ] || cp -R "$home/mods/orchestrator-inbox" "$backup/mods/orchestrator-inbox"
[ ! -d "$home/mods/orchestrator-workspace-chrome" ] || cp -R "$home/mods/orchestrator-workspace-chrome" "$backup/mods/orchestrator-workspace-chrome"

rm -rf "$home/mods/orchestrator-inbox" "$home/mods/orchestrator-workspace-chrome"
cp -R "$root/mods/orchestrator-inbox" "$home/mods/orchestrator-inbox"
cp -R "$root/mods/orchestrator-workspace-chrome" "$home/mods/orchestrator-workspace-chrome"
cp "$root/layouts/orchestrator-inbox.json" "$home/layouts/orchestrator-inbox.json"

python3 - "$home/keys.json" "$root/keys.json" <<'PY'
import json, sys
from pathlib import Path
current_path, wanted_path = map(Path, sys.argv[1:])
current = json.loads(current_path.read_text()) if current_path.exists() else {}
wanted = json.loads(wanted_path.read_text())
for section, bindings in wanted.items():
    current.setdefault(section, {}).update(bindings)
current_path.write_text(json.dumps(current, indent=2) + "\n")
PY

herdr-app check "$home/mods/orchestrator-inbox"
herdr-app check "$home/mods/orchestrator-workspace-chrome"

printf '\nInstalled Herdr Orchestrator Inbox.\n'
printf 'Backup: %s\n' "$backup"
printf 'Activate: herdr-app do layout.switch '\''{"name":"orchestrator-inbox"}'\''\n'
