#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/home"
cat >"$tmp/bin/herdr-app" <<'SH'
#!/usr/bin/env sh
[ "$1" = check ]
[ -d "$2" ]
SH
chmod +x "$tmp/bin/herdr-app"

PATH="$tmp/bin:$PATH" HERDR_APP_HOME="$tmp/home" "$root/install.sh" >/dev/null
[ -f "$tmp/home/layouts/orchestrator-inbox.json" ]
[ -f "$tmp/home/mods/orchestrator-inbox/main.js" ]
[ -f "$tmp/home/mods/orchestrator-workspace-chrome/main.js" ]
[ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["global"]["cmd-shift-i"])' "$tmp/home/keys.json")" = "orchestrator-workspace-chrome.toggle-inbox" ]

PATH="$tmp/bin:$PATH" HERDR_APP_HOME="$tmp/home" "$root/uninstall.sh" >/dev/null
[ ! -e "$tmp/home/layouts/orchestrator-inbox.json" ]
[ ! -e "$tmp/home/mods/orchestrator-inbox" ]
[ ! -e "$tmp/home/mods/orchestrator-workspace-chrome" ]

echo "install/uninstall smoke test passed"
