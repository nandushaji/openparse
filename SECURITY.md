# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues by emailing the maintainer directly or by using
[GitHub's private vulnerability reporting](https://github.com/nandushaji/openparse/security/advisories/new).

You should receive a response within **48 hours**. If you do not, follow up to
ensure the original message was received.

Please include as much of the following as possible to help us understand and
reproduce the issue:

- Type of vulnerability (e.g. prompt injection, path traversal, RCE)
- Full paths of affected source files
- Location of the vulnerable code (tag/branch/commit or direct URL)
- Steps to reproduce
- Proof-of-concept or exploit code (if possible)
- Impact and potential attack scenarios

Once a fix is ready we will:
1. Prepare a patched release
2. Credit you in the changelog (unless you prefer to remain anonymous)
3. Publish a GitHub Security Advisory

## Scope

`@openparse/core` processes local files and forwards content to a **user-supplied**
LLM API. The library does **not** store, transmit, or log API keys beyond what
is needed for each request. However, please report any issues where:

- User-controlled input could reach the filesystem unexpectedly
- LLM API keys could be leaked in logs or error messages
- Malformed PDFs could cause denial-of-service or memory exhaustion
