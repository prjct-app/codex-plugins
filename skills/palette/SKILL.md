---
name: palette
description: Manage Palette color themes and favorites in Codex, import or export a Pi-compatible palette library, and connect or sync with palette.prjct.app. Use for Palette theme changes and $palette commands, not generic color design work.
---

Use the bundled helper; it keeps credentials out of prompts and converts the same palette data Pi and Claude Code use. Resolve the plugin root as two directories above this SKILL.md's directory. Run `node "<plugin root>/scripts/palette.mjs" <action> [argument]` with properly quoted arguments. Node.js 22.19+ is required.

| Request | Helper action |
| --- | --- |
| `$palette`, show choices | `list`, then `install` if native theme files are needed |
| `$palette nord` or apply a named palette | `apply nord` |
| Next, previous or random | `next`, `prev`, `random` |
| Favorite a palette | `fav <id>`; omit id for the active palette |
| Import a downloaded library/theme | `import <path>` |
| Export the library | `export [path]` |
| Connect Palette | `login` |
| Check a login awaiting approval | `login-status` |
| Sync the account library | `sync` |
| Disconnect Palette | `logout` |
| Inspect local state | `status` |
| Desktop appearance colors | `desktop <id>` |

The helper outputs JSON. Report its result briefly in the user's language. Do not read `auth.json` or `pending.json` into context: tokens and polling secrets are used only by the helper. Login prints a public approval URL and code and polls in the background for up to the code's expiry. Give the user that link and code promptly. After approval, use `status` or `login-status` to verify the connection. Run `sync` when the user asks to bring/send their library; login itself does not sync.

An import of a whole library returns a replacement preview first. Use `--replace` when the user already authorized replacing the library, or after their approval of that preview. A single theme is merged into the library. Never silently replace a whole library in response to an ambiguous import request.

CLI themes affect syntax highlighting in code blocks and diffs. `apply` writes the theme files and saves `tui.theme` using Codex's own config API. In a running CLI session tell the user to open `/theme` and select `palette-<id>` for immediate preview/application; future CLI sessions use the saved selection. The plugin has no API to repaint every open session, and `$palette` is a skill invocation, not Pi's extension command.

For an explicit desktop appearance request, run `desktop <id>` and provide its base/accent/background/foreground values for Settings → Appearance. Do not run CLI `apply` as if it changed the desktop UI, write undocumented app preferences, or claim the recipe was applied. For desktop-only library import or sync, add `--no-apply` to update the library without selecting a CLI theme. `list`, `status`, `fav` and `export` also accept `--no-apply` to use the local Palette selection without needing Codex CLI. Library, favorites, login and sync work through the same helper in both local surfaces.

Data is stored under `${CODEX_HOME:-~/.codex}/palette`; CLI themes live under `${CODEX_HOME:-~/.codex}/themes`. `PALETTE_SITE_URL` changes the service origin for local development. Network requests occur only during login/polling, sync and logout. A saved login is scoped to the service origin. The helper never changes Codex's provider, model, permissions or authentication.
