# Palette for Codex

The same 34 palettes as Pi and Claude Code, your own library, favorites, and optional account sync with [palette.prjct.app](https://palette.prjct.app). Requires Node.js 22.19+ and Codex CLI for saving a CLI theme selection. No npm dependencies or model/API key are required.

## Use in Codex

Add the public GitHub marketplace and install the plugin:

```sh
codex plugin marketplace add prjct-app/codex-plugins
codex plugin add palette@prjct-codex
```

Start a new chat. Invoke the Palette skill with `$palette` (or select Palette in the composer). This repository is a Git-backed marketplace, separate from the universal plugin directory's submission and review process.

For local development, clone this repository and use `codex plugin marketplace add /absolute/path/to/your/clone` instead. A version can be pinned with `codex plugin marketplace add prjct-app/codex-plugins --ref v0.1.0`. Update it with `codex plugin marketplace upgrade prjct-codex` and start a new chat.

| In Codex | Does |
| --- | --- |
| `$palette` | Lists palettes, with favorites and the active selection; `/theme` provides native live syntax preview |
| `$palette nord` | Installs the theme and saves `tui.theme = "palette-nord"` for Codex CLI |
| `$palette next`, `prev`, `random` | Cycles favorites first, then own, editor, photo and original palettes; random avoids the active one |
| `$palette fav nord` | Toggles a favorite; omitting the id uses the active palette |
| `$palette import ~/Downloads/library.json` | Previews library replacement; after authorization, imports palettes and favorites |
| `$palette export` | Exports the same `pi-palette` library format the site, Pi and Claude understand |
| `$palette login` | Shows a code and approval link, then polls in the background until approval or expiry |
| `$palette sync` | Sends local palettes/favorites and pulls the account library; keeps the active palette when it still exists |
| `$palette logout` | Cancels pending login, revokes the token and removes it locally; keeps palettes |
| `$palette status` | Shows the active palette and connection status, without credentials |
| `$palette desktop nord` | Gives the base, accent, background and foreground to set in desktop Appearance |

In an already running CLI, open `/theme` and select `palette-nord` to update immediately. New sessions use the saved selection. A project-specific `tui.theme` can override the user-level choice.

## Compatibility with Pi

Login, library files, sync and favorites use the same service and data format. Each editor keeps separate local files and its own device token. The plugin never fetches anything during normal theme browsing.

Codex does not expose Pi's `setTheme()` or Claude's mod API. This plugin is a skill plus a local helper, so it does not install a Pi-style native `/palette` command or repaint every open window. Codex CLI custom `.tmTheme` files style syntax in code blocks and diffs; they do not recolor the entire terminal interface. Use the native `/theme` picker for live preview.

The desktop app has separate Appearance controls. The helper provides those colors as a recipe; it does not edit undocumented desktop state or claim it applied the theme. Library and sync actions work from local Codex desktop chats as well as CLI chats. Hosted cloud chats cannot change your local machine's themes.

Official references: [CLI themes](https://learn.chatgpt.com/docs/cli-customization), [plugin packaging](https://developers.openai.com/plugins/build/plugins), [configuration RPC](https://learn.chatgpt.com/docs/app-server), [desktop Appearance](https://learn.chatgpt.com/docs/reference/settings).

## Files and service

| File | Purpose |
| --- | --- |
| `~/.codex/palette/library.json` | Your palettes in `format: "pi-palette", version: 1` |
| `~/.codex/palette/state.json` | Active palette and favorites |
| `~/.codex/palette/auth.json` | Palette-scoped device token, readable only by you |
| `~/.codex/palette/pending.json` | Private polling secret while a login is pending |
| `~/.codex/palette/themes.json` | Theme files owned by this plugin |
| `~/.codex/themes/palette-*.tmTheme` | Native custom syntax themes |

An existing `CODEX_HOME` is respected. `PALETTE_SITE_URL` selects a different Palette origin. HTTPS is required, with HTTP allowed only for localhost during development. Tokens are bound to the origin that issued them and never printed, included in prompts, or sent through redirects. A failed remote logout still removes the local token and tells you to revoke the device on the site.

The existing `/api/pi/link`, `/api/pi/link/claim`, `/api/pi/library` and `/api/pi/token` routes are intentionally reused. The device label is `codex`. Login and polling are the only background network work; sync and logout run on request.

## Direct helper and development

The skill uses `node scripts/palette.mjs <action> [argument]`. Results are JSON. For example:

```sh
node scripts/palette.mjs list
node scripts/palette.mjs install
node scripts/palette.mjs apply nord
node scripts/palette.mjs login
node scripts/palette.mjs login-status
node scripts/palette.mjs sync
```

Whole-library imports require `--replace` after the replacement is authorized. A single Pi theme JSON is added and applied, preserving the other palettes. Desktop-only imports and sync use `--no-apply`: the library is updated without invoking Codex CLI or selecting a CLI theme. `list`, `status`, `fav` and `export` can also use `--no-apply` when Codex CLI is unavailable. `login --no-wait` disables the background worker for manual polling. No browser is opened automatically; the agent presents the approval link.

`assets/palettes.json` is copied from `pi/local-extensions/pi-palettes/palettes.json`. Generate the native files with `npm run build:themes`. Run `npm test`; development tests require Python 3 for independent plist parsing and an installed Codex CLI for the config integration. They use temporary data directories and a simulated Palette service. The config integration runs against a temporary `CODEX_HOME`, preserving the real user config. The plugin was verified with Codex CLI 0.159.0.
