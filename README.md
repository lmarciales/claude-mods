# claude-mods

Mods for [Claude Code](https://docs.anthropic.com/en/docs/claude-code): looks, panels and small features, each one a plugin you can install on its own. This repository is a plugin marketplace, so every mod in `plugins/` installs with one line.

## Mods

| Mod | What it does |
| --- | --- |
| [`crimson-gate`](plugins/crimson-gate) | A static gothic red backdrop for the desktop app, and a session HUD above the prompt |

## crimson-gate

A deep red and black scene behind the chat: a huge toothed ring, a diagonal band of red light, line-art spires with amber windows, violet orbs and a gold gear. It is drawn once and never animates, so it costs nothing while it sits there. The app's colors follow the scene.

Above the prompt, a HUD shows the session at a glance:

- **Header:** what Claude is doing now (the tool running, a reply timer, tools used, subagents), or how long the session has run; on the right, the git branch, lines added and removed, uncommitted files and unpushed commits.
- **Context:** how full the context window is, split into conversation, tools and system, and memory files, with the room left before auto-compact.
- **Cost:** the session's cost, the last reply's, and the average per reply.
- **Last reply:** output speed, tokens in and out, and how long it took.
- **Cache:** how much of the last reply's input came from the cache.
- **Session:** messages, duration, tools used and running subagents.
- A warning appears only when your 5-hour or weekly plan limit passes 70%.

Commands:

- `/hud` shows which HUD is active; `/hud classic` switches to a simpler HUD with plan limits and a clock; `/hud session` switches back.
- `/world off` turns the backdrop off; `/world crimson` brings it back.

The backdrop and the graphic HUD draw in the Claude desktop app (Code tab) and the mobile app. A terminal shows the HUD as one line of text.

### Privacy and performance

- No network, no telemetry, no files read or written, no environment variables read. The mod has no dependencies: nothing to install beyond Claude Code.
- Its only outside program is `git`, to show the branch and changes: two calls (`status` and `diff --shortstat`), which only read: no optional locks, no fsmonitor or untracked-cache helpers, no lazy fetch in a partial clone, no external diff or textconv programs, no prompts, submodules ignored, and a 2-second cap. Like any `git status` you run in that folder, git still follows the repository's own setup, such as a Git LFS filter the repository defines. They run when a session starts (after it is up), when the working folder changes, a moment after a tool that can change files, after each reply, and every 30 seconds, so a branch switched in another terminal shows up while idle. Reads never overlap.
- It stores two choices: the backdrop on or off, and which HUD.
- The backdrop is drawn once and never animates. The HUD is a static image, redrawn from live figures whenever one it shows changes: context, cost and plan limits as the app reports them, git as above, and the clock about once a minute while idle (every few seconds while Claude replies). An unchanged reading redraws nothing. Nothing the mod does runs before a tool call or a reply in a way that delays it.

### Install

At the prompt of a terminal session:

```
/plugin install crimson-gate --marketplace lmarciales/claude-mods
```

From a shell:

```
claude plugin install crimson-gate --marketplace lmarciales/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `lmarciales/claude-mods`, then Add plugin.

## Layout

```
.claude-plugin/marketplace.json   lists every mod
plugins/<mod>/                    one folder per mod: manifest, hooks, types, tests
```

Each mod has tests: `claude plugin test plugins/<mod>`.

`plugins/crimson-gate/hooks/make-colors.js` is the palette helper from Claude Code's plugin-authoring skill.

## License

MIT
