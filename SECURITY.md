# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for this repository. Do not include terminal output, credentials, or private repository details in a public issue.

## Trust model

Herdr mods are trusted native code. This package invokes local `hc` commands, reads terminal metadata and bounded output, and writes the `herdr.inbox` label. It does not make network requests or send terminal input.

Review the installed source and use the repository's pinned release tags in sensitive environments.
