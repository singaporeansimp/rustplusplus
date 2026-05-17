# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

rustplusplus is a Node.js Discord bot that integrates with the Rust+ Companion App API to provide server management, smart device control, event notifications, and in-game chat bridging for Rust game servers. It serves multiple Discord guilds from a single bot instance, each with independent Rust server connections.

## Commands

- **Start the bot**: `npm start` (runs `ts-node .`)
- **Type check**: `npm test` (runs `tsc --noEmit -p .` — type checking only, no test runner)
- **Docker**: `docker-compose up --build`

No unit test framework exists in this project. "Testing" means manual verification with a running Discord bot and Rust server.

## Code Style (from CONTRIBUTING.md)

- 4-space indentation
- Single quotes for strings (except to avoid escaping)
- No unused variables
- Always use `===` instead of `==` (but `obj == null` is allowed to check `null || undefined`)
- Files use CommonJS (`require`/`module.exports`), not ES modules

## Architecture

### Entry Point

`index.ts` → creates `DiscordBot` instance (extends `discord.js` Client), calls `client.build()` which logs in to Discord. Creates `logs/`, `instances/`, `credentials/`, `maps/` directories at startup.

### Core Classes (`src/structures/`)

- **DiscordBot.js** — Main client. Manages commands collection, RustPlus instances per guild, FCM listeners, internationalization (per-guild language), Battlemetrics instances. Key methods: `setupGuild()`, `getInstance()`, `intlGet()`.
- **RustPlus.js** — Extends `@liamcottle/rustplus.js`. Wraps the Rust+ WebSocket API with token-bucket rate limiting (24 tokens/player, 3/sec replenish). Handles smart device operations, map rendering, event processing, team chat bridging.
- **RustPlusLite.js** — Lightweight RustPlus connection for non-hoster guild members (FCM-only notifications).
- **Battlemetrics.js** — Player tracking via Battlemetrics API.
- **Map.js / MapMarkers.js** — In-game map rendering using `gm` (GraphicsMagick) and `jimp`.
- **Items.js / RustLabs.js / Cctv.js** — Static data: item info, RustLabs integration, CCTV camera codes.

### Event Flow

1. **Discord events** (`src/discordEvents/`): `ready`, `interactionCreate`, `messageCreate`, `guildCreate`, `voiceStateUpdate`, etc.
2. **interactionCreate** dispatches to handlers based on interaction type:
   - Buttons → `src/handlers/buttonHandler.js`
   - Select menus → `src/handlers/selectMenuHandler.js`
   - Slash commands → command file from `src/commands/`
   - Modals → `src/handlers/modalHandler.js`
3. **Rust+ events** (`src/rustplusEvents/`): `connected`, `connecting`, `disconnected`, `error`, `message`, `request`. These trigger game-state handlers in `src/handlers/`.

### Handlers (`src/handlers/`)

Domain-specific logic separated from event routing: `inGameChatHandler`, `inGameCommandHandler`, `teamChatHandler`, `teamHandler`, `smartSwitchHandler`, `smartSwitchGroupHandler`, `smartAlarmHandler`, `storageMonitorHandler`, `vendingMachineHandler`, `pollingHandler`, `timeHandler`, `battlemetricsHandler`, `informationHandler`, `permissionHandler`.

### Commands (`src/commands/`)

24 Discord slash commands. Each exports `{ name, description, execute(client, interaction) }`. Registered per-guild via `src/discordTools/RegisterSlashCommands.js`.

### Per-Guild State

Each guild's data is persisted in JSON files:
- `instances/{guildId}.json` — Server list, smart devices, channel IDs, settings
- `credentials/{guildId}.json` — FCM credentials, Steam ID to Discord user mappings

Read/written via `src/util/instanceUtils.js` helper functions. The `DiscordBot.getInstance(guildId)` method reads the instance file; writes go through `InstanceUtils.writeInstanceFile()`.

### Internationalization

`src/languages/` contains 12 JSON translation files (en, cs, de, es, fr, it, ko, pl, pt, ru, sv, tr). Uses `@formatjs/intl`. Per-guild language set via instance config. Access translations with `client.intlGet(guildId, 'messageKey', { variable })`.

### Configuration

`config/index.js` reads environment variables (prefixed `RPP_`):
- `RPP_DISCORD_TOKEN`, `RPP_DISCORD_CLIENT_ID`, `RPP_DISCORD_USERNAME`
- `RPP_LANGUAGE` (default: `en`), `RPP_POLLING_INTERVAL` (default: 10000ms)
- `RPP_RECONNECT_INTERVAL` (default: 15000ms)

### External Dependencies

- **rustplus.js** — Fork at `alexemanuelol/rustplus.js`, pinned to a specific commit. Provides WebSocket communication with Rust servers.
- **FCM** — `@liamcottle/push-receiver` for Firebase Cloud Messaging push notifications.
- **GraphicsMagick** (`gm`) + **jimp** — Map image rendering. Requires `gm` system dependency.

## Key Patterns

- The `client` singleton is exported from `index.ts` and imported across the codebase as `require('../../index.ts')` or `require('../index.ts')`.
- Instance files are the source of truth for guild state — read from disk frequently, written after mutations.
- RustPlus connections are managed per-guild with reconnection timers (`rustplusReconnectTimers`).
- FCM listeners are set up per-guild for the hoster, with `FcmListenerLite` for additional guild members.
