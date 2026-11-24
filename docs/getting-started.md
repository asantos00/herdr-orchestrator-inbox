# Getting started

## Install Herdr

Install a current Herdr desktop release and confirm both programs are available:

```bash
herdr-app --version
hc --version
```

## Install the layout

```bash
git clone https://github.com/asantos00/herdr-orchestrator-inbox.git
cd herdr-orchestrator-inbox
./install.sh
herdr-app do layout.switch '{"name":"orchestrator-inbox"}'
```

The installer reports the exact backup directory it creates. Herdr hot-reloads the files without restarting terminals or agents.

## Use the Inbox

Launch managed workers from the root orchestrator with `hc run --bg`. Herdr records the recursive parent tree, and the Inbox keeps that root as the single queue item.

Use:

- `⌘⇧I` to toggle Inbox and Agents,
- `⌘⇧J/K` to cycle actionable roots,
- the clock to snooze for five minutes,
- acknowledge to defer unchanged work for one hour, and
- the check control to mark a finished result reviewed.

Opening a row never changes triage state.

## Verify

```bash
npm test
```

On a machine with Herdr installed, this also runs `herdr-app check` for both bundled mods.

## Remove

Switch to another layout, then run:

```bash
./uninstall.sh
```

The uninstaller creates a backup and removes only package-owned files and the package-owned shortcut.
