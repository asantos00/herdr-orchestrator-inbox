# Contributing

Thanks for improving Herdr Orchestrator Inbox.

## Development

1. Fork and clone the repository.
2. Create a focused branch.
3. Run `./scripts/test.sh`.
4. Include a screenshot when changing visible behavior.
5. Open a pull request describing the user-facing change and verification.

Keep the terminal as the primary workspace. Root orchestrators are the queue unit; descendants may contribute status and navigation context but remain nested.

Changes to triage semantics need regression coverage in `mods/orchestrator-inbox/inbox-state.test.mjs`. Navigation changes need coverage in `inbox-navigation.test.mjs`.
