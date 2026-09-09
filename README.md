# StarHostAI Tools

Pair any machine or server to StarHostAI so the AI can:

- Read / write / create / list / delete files across your system
- Run terminal commands with full system access (protected system directories like `/etc` excluded)

One 8-character connection code, entered once. It names your device and issues
a **2-week auth token** saved locally — after that, reconnects are automatic.
No browser windows, no approval prompts, nothing to manage in the web UI.

## Quick Start

### 1. Get your 8-character connection code
In the StarHostAI Chat UI, click the **Connect** button in the top bar (or open
**Settings → Connections**) to copy your 8-character code (e.g. `a1b2c3d4`).

### 2. Connect your terminal
Run the command in your terminal:

```bash
npx github:starhost-app/starhostai-tools
```

It asks for the **8-character connection code**, then asks you to **name this
 device** (e.g. `my-work-pc`), exchanges the code for a **2-week auth token**
saved in `~/.config/starhostai/config.json` and connects.

On later runs, simply type:

```bash
npx github:starhost-app/starhostai-tools
```

It asks the **server** whether the saved token is still valid — if yes it
connects straight to your account, if it expired it asks for a fresh code.

Works on **Windows, macOS and Linux**. Only **one machine** can be connected per
account at a time — pairing a new device disconnects the previous one.

## Commands

| Command | What it does |
| --- | --- |
| `starhostai-tools` | Pair with an 8-character code, or reconnect with the saved 2-week token |
| `starhostai-tools [CODE]` | Pair using a specific 8-character code |
| `starhostai-tools status` | Show saved server, device name, token expiry & status |
| `starhostai-tools disconnect` | Clear saved auth token on this machine |
| `starhostai-tools help` | Show usage options |
| `starhostai-tools version` | Show version |

Options: `--name <device>` (default: prompted, then hostname), `--mode allow|deny|auto` (default: `allow`), `--server <url>`.

## Access Modes

- **allow** (default) — file operations run silently; destructive terminal
  commands or deletes ask for confirmation in the web chat (Allow / Allow-all).
- **auto** — everything runs silently.
- **deny** — operations are rejected.

## System access

Full filesystem and terminal access across the machine, starting from your home
directory. Protected system directories are off-limits:

- **Linux/macOS:** `/etc`, `/usr`, `/bin`, `/sbin`, `/lib`, `/boot`, `/dev`, `/proc`, `/sys`, `/run`, `/root`, `/opt`, `/var` …
- **Windows:** `C:\Windows`, `C:\Program Files`, `C:\ProgramData` …

Everything else — including user-created directories like `/projects` — works normally.

## Tools the AI gets

| Tool | What it does |
| --- | --- |
| `fs_read` | Read files / globs, multiple in one call |
| `fs_write` | Write / overwrite files, multiple in one call |
| `fs_create_dir` | Create whole directory trees in one call |
| `fs_list` | List a directory |
| `fs_delete` | Delete files / directories |
| `terminal_exec` | Run a terminal command (with allow-mode confirmation) |

## Publishing

The package is published to npm via the GitHub Actions workflow
(`.github/workflows/publish.yml`): push a `v*` tag and the workflow bumps the
version from the tag and publishes (needs an `NPM_TOKEN` secret in the repo).

Before publishing, set the production server URL in `lib/constants.js`
(`DEFAULT_SERVER_URL`), then:

```bash
git tag v0.2.0
git push origin v0.2.0
```