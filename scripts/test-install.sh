#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/config"
cat >"$tmp/bin/herdr-app" <<'SH'
#!/usr/bin/env sh
[ "$1" = check ]
[ -d "$2" ]
SH
chmod +x "$tmp/bin/herdr-app"

PATH="$tmp/bin:$PATH" HERDR_APP_HOME="$tmp/config" "$root/install.sh" >/dev/null
[ -f "$tmp/config/layouts/orchestrator-inbox.json" ]
[ -f "$tmp/config/mods/orchestrator-inbox/main.js" ]
[ -f "$tmp/config/mods/orchestrator-workspace-chrome/main.js" ]
[ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["global"]["cmd-shift-i"])' "$tmp/config/keys.json")" = "orchestrator-workspace-chrome.toggle-inbox" ]

PATH="$tmp/bin:$PATH" HERDR_APP_HOME="$tmp/config" "$root/uninstall.sh" >/dev/null
[ ! -e "$tmp/config/layouts/orchestrator-inbox.json" ]
[ ! -e "$tmp/config/mods/orchestrator-inbox" ]
[ ! -e "$tmp/config/mods/orchestrator-workspace-chrome" ]

echo "install/uninstall smoke test passed"
