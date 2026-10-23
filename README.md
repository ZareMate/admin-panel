# Admin Panel

A server-side web companion to [ZareMate/admin-gui](https://github.com/ZareMate/admin-gui), for **Minecraft 1.21.1 / NeoForge 21.1.249 / Java 21**. The website runs in a separate Node.js service using Fastify and React. Minecraft opens an outbound authenticated WebSocket connection to it; no panel HTTP port is opened inside Minecraft. Clients only need a browser.

## Separate Node web app

The hosting app is **Fastify + TypeScript**, with a **React + TypeScript** frontend in [`web-server/`](web-server/README.md). Minecraft opens one outbound WebSocket connection to its `/bridge` route. The page, API, and WebSocket share one port; no web listener or certificate files run inside Minecraft.

`gradle build` produces:

- `build/libs/admin_panel-2.0.0.jar` for Minecraft.
- `build/distributions/admin_panel-2.0.0-web.zip` for Node hosting. Unpack it and run `npm ci --omit=dev`, `npm run setup`, then `npm start` after configuring it.

For source development: `cd web-server`, `npm ci`, `npm run build`, `npm run setup`, then `npm start`. Node.js 22.12+ is required. Configuration and persistent audit data live on the web host. Existing properties files, account hashes, Discord UUID mappings, and audit history can be copied across.

Minecraft's `config/admin-panel-bridge.properties`:

```properties
enabled=true
url=wss://YOUR_WEB_HOST/bridge
token=SAME_VALUE_AS_ADMIN_PANEL_BRIDGE_TOKEN_ON_THE_WEB_HOST
```

For a trusted private plaintext connection use `ws://HOST:PORT/bridge` with `allow-insecure-ws=true`. The web host handles HTTPS if available; this app does not require you to create certificates on the Minecraft hosting. See the [Node deployment guide](web-server/README.md) for hosting variables, plain WS, HTTPS proxying, and migration. A framework alone does not provide a trusted certificate for an HTTP-only hosting endpoint.

The earlier standalone Java web-service JAR has been replaced; use the Node archive above. No second WebSocket port is required.

## Features

- Search online and known offline players by name or UUID, with status filters and live pushed updates.
- Selected-player state updates approximately once per second while viewed; unchanged snapshots are suppressed and subscriptions recover after reconnect.
- Player profiles with Discord identity, FTB Teams, ClockIn, TSA Anticheat checks/detections, and Airport Security records.
- Punish history, direct warnings/kicks/mutes/bans, and configured offense escalation through the real Punish API.
- Remove configured offense cases through Punish’s existing removal path, preserving its related-punishment and ban-list handling.
- Add/edit/remove Admin Notes using its own persistence and author-ownership rules.
- Discord sign-in with configurable guild rank precedence, explicit tab and action permissions, login-time role checks, OAuth state protection, CSRF protection, and duplicate-request protection. Legacy local login remains an explicit compatibility option.
- Durable JSONL audit entries for successful logins, mutation requests, and their outcomes. Administrators can inspect/export the latest 500 events in the browser.

The existing mods remain authoritative. This mod does not copy their databases. Missing optional mods or missing player records are shown as unavailable; no demo data is presented as live data.

## Inventory and item icons

The player profile has read-only **Inventory**, **Ender Chest**, and **Curios** tabs, each controlled by its own permission.

- Online players: live hotbar, main inventory, armor, offhand, and Ender Chest snapshots.
- Offline players: inventory and Ender Chest from the world’s existing player `.dat` file, labeled with its save time. Missing or undecodable saves show an unavailable message. Player data is never modified.
- Curios: equipped and cosmetic groups via the installed Curios API (1.21.1 API shape, checked against 9.2.2). Offline Curios is explicitly unavailable.
- Item details: names, registry IDs, stack counts, durability, enchantments, and lore. Expand an occupied slot for details.

Icons are rendered on the web host using bundled PNGs and optional mod jars copied into its `data/assets/` directory (read as ZIP data, never loaded as mods). The resolver follows generated/handheld item model parents and texture references, composites up to five layers, and shows the first square frame of vertical animation strips. Results are resized to 64×64 PNGs and cached in memory. Icons are requested in authenticated batches, not separate requests per slot.

The Node host renders generated textures and static cuboid geometry, including model UVs and GUI transforms, using Sharp. This is a preview, not Minecraft's client renderer: custom renderers, world tinting, state-dependent overrides, and client resource-pack overrides retain labeled fallbacks. Item information remains available when an icon cannot be rendered. Java desktop/image-processing support is not required on Minecraft or the web host.

## Build

```sh
gradle build
```

The default build uses the sibling repositories’ built jars:

- `../admin-gui/build/libs/admin_gui-2.0.0.jar`
- `../punish/build/libs/punish-1.0.0.jar`

To build from another checkout:

```sh
gradle build -PadminGuiJar=/absolute/path/admin_gui-2.0.0.jar -PpunishJar=/absolute/path/punish-1.0.0.jar
```

Both jars are required at compile time and are **not bundled**. Output: `build/libs/admin_panel-2.0.0.jar`. The default build targets Admin GUI 2.0.0 and the Punish API including `PunishService.removeOffense`.

## Install and configure Discord login

1. Replace the old panel jar in the dedicated server’s `mods/` folder with `admin_panel-2.0.0.jar`. Keep Admin GUI and the desired integration mods installed; remove older panel jars.
2. Create/select an application in the [Discord Developer Portal](https://discord.com/developers/applications). Copy its OAuth2 **client ID** and **client secret** into the server configuration. A bot token is not needed.
3. Register the **exact** OAuth2 redirect URI `<origin>/api/auth/discord/callback`. For the current LAN origin this is `http://10.0.0.1:8080/api/auth/discord/callback`. If Discord does not accept your chosen HTTP redirect, use the HTTPS proxy setup below and register that HTTPS origin instead.
4. Merge the settings below into `config/admin-panel.properties`, set `enabled=true` on the web host and restart the Node service. The browser shows **Continue with Discord**.

```properties
enabled=true
bind=0.0.0.0
port=8080
origin=http://10.0.0.1:8080
allow-insecure-http=true
auth.mode=discord
discord.client-id=YOUR_APPLICATION_CLIENT_ID
discord.client-secret=YOUR_APPLICATION_CLIENT_SECRET
discord.guild-id=1506410587553398854
discord.rank-order=dev,owner,admin,mod,trial-mod,helper,trial-helper
```

The secret can instead come from `ADMIN_PANEL_DISCORD_CLIENT_SECRET`, which takes precedence over the config entry. Keep it server-side; it is never sent to the browser. In Docker, publish TCP 8080 from the container running the standalone web service.

The [web configuration template](web-server/admin-panel.example.properties) lists the rank role-ID fields and explicit permissions. Set `discord.rank.<rank>.role-id` and `discord.rank.<rank>.permissions`. The first matching rank in `discord.rank-order` wins; permissions from lower ranks are not combined. Empty permissions or a missing `panel.access` permission deny login. Restart Node after changing configuration.

For example, a trial moderator who can read profiles and notes and edit their own notes:

```properties
discord.rank.trial-mod.permissions=panel.access,tab.players,tab.overview,tab.notes,notes.edit
```

See the [permission reference](web-server/README.md#permissions) for every tab and action. Old `.access` entries are accepted for migration; an explicit `.permissions` entry always overrides them. Saving ranks in the web UI writes explicit permissions.

The server verifies guild membership and current role IDs only at login. Normal panel requests and moderation actions use the rank saved in the session and make no Discord API calls. Role changes or leaving the guild take effect on the next login; existing sessions retain their login-time access until logout, expiry, or server restart. Discord outages/rate limits block new logins but do not interrupt existing sessions. Login itself remains subject to Discord rate limits. Sessions expire after at most eight hours or when the OAuth access token expires, whichever comes first. Tokens remain in server memory and are discarded on logout/restart; logout ends the panel session but does not remove the application from the user’s Discord Authorized Apps.

The flow uses the authorization-code grant with `identify` and `guilds.members.read`, and a one-use, five-minute OAuth state tied to an HttpOnly browser cookie. See [Discord OAuth2 documentation](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx).

### Staff note identity

Audit/punishment authors include the Discord username and stable user ID. For note ownership, Discord accounts get stable, namespaced author UUIDs. Optionally map an account to its real Minecraft UUID to share ownership of existing in-game notes:

```properties
discord.minecraft.DISCORD_USER_ID=MINECRAFT_UUID
```

These are trusted administrator mappings, not values supplied by the user’s browser. Changing a mapping changes which existing notes that account owns. Discord login does not automatically use the Discord Link mod’s player database or inherit LuckPerms/operator privileges.

### Legacy local login

Existing configurations without `auth.mode` retain local login for migration. New generated configurations use Discord. Setting `auth.mode=discord` disables the password endpoint and ignores all `user.*` entries; there is no password fallback if Discord is unavailable.

To deliberately use the old mode, set `auth.mode=local`, generate `user.*` entries with `python3 tools/create-user.py`, and restart. Local passwords are salted PBKDF2 hashes; local sessions last eight hours.

### Remote access

Use an HTTPS reverse proxy with the backend bound to loopback. Set `origin` to the exact browser origin, without a path or trailing slash, and preserve that host in forwarded requests. Non-local HTTP origins are rejected by default; HTTPS enables Secure session cookies.

Example nginx location inside a TLS-configured virtual host:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $http_host;
    proxy_read_timeout 25s;
    client_max_body_size 16k;
}
```

Set `origin=https://admin.example.com` in the mod config. The backend checks the browser Origin on every POST and the configured Host on every request. It does not trust forwarded client-IP headers: login throttling is per connection IP, so users behind one proxy share the ten-attempt / five-minute limit. Apply additional rate limiting at your proxy if needed.

### Direct LAN HTTP / Crafty Docker

Version 1.0.1 adds an explicit HTTP opt-in for trusted-network access:

```properties
enabled=true
bind=0.0.0.0
port=8080
origin=http://10.0.0.1:8080
allow-insecure-http=true
# Keep your auth.mode=discord and discord.* settings here.
```

`origin` is the literal URL used in the browser, not a Markdown link. Inside Docker, bind to `0.0.0.0` rather than the host's LAN IP, and publish TCP port 8080 from the container running the standalone web service to the host. Host-network containers can instead bind an address available on that host. Restart the Node service after changing web configuration; restart Minecraft after replacing its bridge jar. Remove the older panel jar to avoid duplicate mod IDs.

HTTP sends passwords and session cookies without transport encryption; use this opt-in only on a trusted network. Host validation, exact-origin checks, CSRF protection, login requirements, and role restrictions remain enabled. Public access should use the HTTPS proxy setup above.

## Permissions

Ranks grant individual permissions for each tab and action. The **Rank access** editor displays checkboxes and requires `access.manage`; no rank name automatically grants privileges. At least one saved rank must retain `panel.access` and `access.manage`.

Permissions are enforced in HTTP endpoints, browser live streams, and Minecraft mutation handling. Hidden tabs also have their data removed from profile responses. Note editing/removal still requires ownership of a non-system note.

On the **Punishments** tab, `punish.remove` permits removing a direct warning, kick record, mute, or ban. Removal preserves history and records the remover; removing a kick record cannot undo the original kick. `punish.revoke` removes an entire configured offense case and its related punishments. An unrelated live ban for the same UUID/IP stays enforced. Removal reasons are recorded in the web audit log.

All mutation checks run server-side. Game/mod API access runs on the Minecraft server thread. Direct kick requires an online player. Durations are explicit, and zero means permanent. Configured offenses use the mod’s own escalation steps. Arbitrary console commands are not exposed.

## Operational details and limits

- Audit file: `logs/admin-panel-audit.jsonl`. Back it up alongside the underlying mods’ data. It contains moderation reasons and note text; restrict filesystem access. It is append-only from the panel, not cryptographically tamper-proof against server operators.
- Each mutation writes a durable `requested` record before invoking the mod, then its result. A timeout or exception may leave execution unconfirmed: inspect the player and audit before retrying. Request IDs prevent resubmission within the current server/session lifetime; they are not a cross-restart exactly-once guarantee.
- Offense case removal is supported. Lifting **direct** punishments still uses the Punish mod’s commands; the UI explicitly labels this distinction. IP-based punishment creation and arbitrary server commands are not exposed.
- History lists records belonging to the selected UUID, with IP values hidden. It is not a complete cross-account IP investigation view.
- Player discovery and integration availability follow Admin GUI’s APIs. An unavailable integration record can mean the optional mod is absent, incompatible, or has no data for that player.
- The HTTP server uses four workers and a bounded request queue. For public deployments, terminate TLS and enforce connection/body timeouts at a reverse proxy.
## Automated tests

`gradle build` runs all suites automatically; any suite failing fails the build:

- `gradle panelTest`: real HTTP requests covering authentication, authorization, CSRF, duplicate submissions, request limits, logout, and durable audit records, plus the production moderation validator’s role matrix, exact duration bounds, invalid types, offline kicks, configured offenses, and case IDs.
- `gradle iconTest`: model inheritance, texture references/cycles, animation frame cropping, missing/custom model fallback, traversal rejection, and bounded batches.
- `gradle discordTest`: OAuth state/cookie binding, replay and expiry, rank combinations and configurable order, revoked roles, membership failures, missing consent scopes, fail-closed outages, callback/session handling, and disabled password fallback. Uses a fake Discord API; no real credentials or network calls.
- `gradle browserTest`: tests both local and Discord login modes, then launches the production frontend and HTTP server with deterministic test-only player data in headless Chromium. Checks login/logout, search, status filters, player selection, note creation, punishment confirmation/history, audit rendering, XSS escaping, mobile overflow, viewer restrictions, and uncaught JavaScript errors.

Browser tests require Python 3, Chromium, and a matching `chromedriver` on PATH. No npm or Python packages are needed. The build fails clearly if the browser dependency is missing; tests are never silently skipped. Chromium uses its normal sandbox. Containers that cannot support that sandbox can explicitly opt in with `PANEL_TEST_NO_SANDBOX=1` for test runs only.

Browser failure screenshots, HTML, and driver logs are written to `build/reports/browser/`. The test HTTP server uses an ephemeral loopback port and temporary audit storage, and does not connect to a Minecraft server or modify real player data.

These tests automate application regression checks, including OAuth callback integration against a fake provider. They do not perform a live Discord authorization, launch Minecraft or assert that third-party mods actually enforce bans, persist notes, or load on a particular modpack.

### Discord connection diagnostics

Version 1.2.1 distinguishes token exchange, identity lookup, and guild membership failures, and logs their HTTP status without response bodies, OAuth codes, or tokens. Invalid application credentials have a specific message. HTTP 429 responses trigger a cooldown using Discord’s Retry-After header or retry_after body field; requests fail closed during that cooldown instead of repeatedly calling Discord. The API client sends an identifying User-Agent.

`gradle discordHttpTest` tests status classification, response redaction, retry delays, cooldown recovery, and malformed responses with an injected transport. Live Discord failures still require the reported status/stage to diagnose.

`gradle iconFallbackTest` verifies PNG delivery on a JVM without `java.desktop`. `gradle installedIconTest -PmodAssetsPath=/path/to/mods` optionally verifies Create, Create Addition, TFMG, Power Grid, and Create Better Motors assets against installed jars; those jars are not bundled.
