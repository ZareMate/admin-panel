# Admin Panel web app

A separate **Node.js + Fastify + TypeScript** server and **React + TypeScript** UI. Minecraft only opens an outbound WebSocket connection. There is no Java web-server process, Minecraft installation, or certificate file required by this app.

The website, HTTP API, and `/bridge` WebSocket share **one port**. Authentication, Discord OAuth, audit persistence, skins, and icon rendering run here. Minecraft performs game-state reads and changes through the existing mod APIs.

## Run from source

Requires Node.js 22.12+ (Node 24 LTS recommended) and npm. From `web-server/`:

```sh
npm ci
npm run build
npm run setup
```

Setup creates `.env` with a random bridge secret and a disabled `data/config/admin-panel.properties` template. It never overwrites existing files. Edit the configuration, fill in your Discord settings and role IDs (or local `user.*` accounts), and set `enabled=true`. Set the public URL in `.env`, then:

```sh
npm start
```

You can instead copy your existing `config/admin-panel.properties` to `data/config/admin-panel.properties` and `logs/admin-panel-audit.jsonl` to `data/logs/admin-panel-audit.jsonl`. Existing local password hashes, Discord rank order, and Minecraft UUID mappings remain compatible. Discord-derived author UUIDs are unchanged, preserving note ownership. Sessions require a fresh login. Discord roles are checked at login and retained in the session; normal page refreshes do not query Discord.

For deployment without source, unpack `build/distributions/admin_panel-2.2.0-web.zip`, run `npm ci --omit=dev`, then `npm run setup` and `npm start`. React is already built in that archive. Keep `data/` on persistent storage. Run **one Node instance per Minecraft server**; bridge connections and browser sessions are process-local.

## Connect Minecraft

Install `admin_panel-2.2.0.jar` in Minecraft. Install Admin Notes 2.0.0 or newer to enable player notes. Configure `config/admin-panel-bridge.properties`:

```properties
enabled=true
url=wss://panel.example.com/bridge
token=COPY_THE_ADMIN_PANEL_BRIDGE_TOKEN_VALUE_FROM_THE_WEB_APP
```

Restart Minecraft. It connects outward and reconnects after disconnects; no inbound panel port or certificate is needed on Minecraft. Every command retains the staff identity and game-side role checks. Interrupted commands report an uncertain outcome and are never automatically replayed.

For a trusted private connection to a host exposing only an IP and port:

```properties
enabled=true
url=ws://YOUR_WEB_HOST:3000/bridge
token=YOUR_SHARED_SECRET
allow-insecure-ws=true
```

`ws://` is plaintext. Use `wss://` when crossing an untrusted network. `ws://localhost:3000/bridge` needs no insecure override. The `/bridge` endpoint is for the Minecraft client, not browsers.

## Your hosting and SSL

The app listens on ordinary HTTP using `HOST` and `PORT`; the public URL is configured separately with `PUBLIC_ORIGIN`. If your hosting provides HTTPS, set that URL and use the corresponding `wss://` URL in Minecraft. The host must forward WebSocket upgrades to **the same port as the website** and preserve `Authorization` and `Host` headers. No certificate creation or installation inside this app is required.

If the host exposes only plain HTTP, a framework cannot make that endpoint HTTPS on its own. Either use its HTTP endpoint on a trusted private network, or put a TLS-capable endpoint/tunnel in front of it. For private HTTP browser access, set `PUBLIC_ORIGIN=http://HOST:PORT` and `allow-insecure-http=true` in the properties file. Secure cookies are enabled automatically when the public origin is HTTPS, even if the hosting proxy talks HTTP to Node. Do not disable TLS verification in Minecraft.

If a proxy changes the Host header, configure `TRUSTED_PROXIES` with **only that proxy's actual IP addresses/CIDRs** so forwarded host/client-IP headers can be used. Otherwise keep it unset and preserve the original Host. Register exactly `<PUBLIC_ORIGIN>/api/auth/discord/callback` in Discord. There is no separate WebSocket port such as 8081.

For example, an existing nginx HTTPS virtual host can forward everything with:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Authorization $http_authorization;
    proxy_read_timeout 90s;
}
```

This example assumes HTTPS is already configured by your host; it does not issue certificates.

## Configuration and operations

- `PUBLIC_ORIGIN`: exact public origin, no trailing slash; overrides `origin` in the properties file.
- `HOST`, `PORT`: assigned interface and port; override `bind` and `port`.
- `ADMIN_PANEL_BRIDGE_TOKEN`: random 43–128 character URL-safe secret shared only with Minecraft. `npm run setup` generates one.
- `DATA_DIR`: persistent data root, default `./data`.
- `PANEL_CONFIG`: optional path to an existing properties file.
- `ADMIN_PANEL_DISCORD_CLIENT_SECRET`: optional override for the Discord secret.
- `TRUSTED_PROXIES`: optional comma-separated proxy IPs/CIDRs.

Normal `npm start` loads `.env` if present. Hosting-provided environment variables take precedence. The secret never goes into the React bundle. Use the existing `tools/create-user.py` from the repository to generate local account entries. Rank changes from the UI update the configuration atomically and apply immediately to signed-in Discord users.

Bundled item exports live in `assets/icons/` and are copied to generated `public/icons/` during the web build. Optional additional exports go in `data/assets/icons/<namespace>__<item>.png`; copied mod jars go directly in `data/assets/` and are read only as asset archives. Restart Node after changing assets. Generated item textures, layered textures, and static cuboid models are previewed on the web host. Custom renderers, world tinting, and client-state-dependent items retain labeled fallbacks. Player list reads are coalesced and cached for two seconds; details stay viewer-specific for note ownership.

## Live state updates

Signed-in browsers connect to `/api/live` over WebSocket on the same host and port. Forward WebSocket upgrades for both `/bridge` (Minecraft) and `/api/live` (browsers); the nginx catch-all example above already does this. Install the updated mod and restart the Node service together, then reload browser tabs.

The web service sends Minecraft only permissions that the game bridge enforces; web-only grants such as suggestion actions stay in the web session. This prevents a newer web-only grant from breaking older installed panel mods.

The mod samples only subscribed data approximately once per second and pushes snapshots only when content changes. Player joins/leaves and panel mutations also request an immediate sample. The player list is shared across viewers; the selected profile is keyed by player and staff identity/permissions, preserving note ownership. Location, inventory, playtime, security data, notes, and punishments update while that profile is open. Timestamp-only changes do not resend entire snapshots. Under server load, updates may take longer than one second.

Closing a tab or logging out removes its subscriptions; with no viewers, the mod does not continuously build live snapshots. Browser and Minecraft connections reconnect automatically and restore subscriptions. Expired sessions lose live access. Selected-player updates pause in the UI while a moderation dialog is open so forms are not disrupted. The Refresh button remains available, with a 30-second HTTP fallback when the live channel is unavailable. Commands are never replayed during reconnect.

The service bounds live connections to 128 total and four per staff session, with up to 32 distinct game subscriptions (one shared list plus up to 31 profiles with distinct staff identities). Slow browser clients are disconnected instead of accumulating unlimited queued snapshots.

## Tests and Docker

`npm run typecheck` (including unused-code checks), `npm run build`, and `npm test` validate the Node app and React UI. Browser tests require Chromium and a matching ChromeDriver. `gradle build` additionally runs Java contract tests through `bridgeTest`, checks the mod artifact with `verifyModJar`, and runs the actual Java bridge client against Fastify; `npm test` alone skips that test unless `JAVA_BRIDGE_CLASSPATH` is set. Tests use temporary data and fake game/Discord services, not your live server.

From the repository root, `docker build -f web-server/Dockerfile -t admin-panel-web .` builds the Node service. Mount a writable persistent directory at `/data`, supply environment variables, and publish port 3000. The container runs as the `node` user. The Docker image does not manage TLS certificates.

## Permissions

Ranks use `discord.rank.<name>.permissions`, a comma-separated list. The highest matching Discord rank wins; grants are not combined across ranks. Rank names do not grant permissions. Use **Rank access** to find permissions by feature group or search, save, and apply changes immediately. The editor preserves one rank with both `panel.access` and `access.manage`. Verified Discord role IDs are retained at login; saving rank policies re-evaluates existing sessions against those roles, revokes removed grants, and disconnects old live subscriptions before reconnecting. Removing panel access signs the user out. Discord membership and role changes themselves are checked at the next login.

| Permission | Allows |
| --- | --- |
| `panel.access` | Sign in (required) |
| `tab.players` | Player directory and selecting profiles |
| `tab.overview` | Overview, location, playtime, linked Discord, teams and ClockIn |
| `tab.cases` | Punishment history and configured offenses |
| `tab.notes` | Staff notes |
| `tab.security` | Security records and detection badges |
| `tab.inventory` | Inventory |
| `tab.enderChest` | Ender Chest |
| `tab.curios` | Curios |
| `tab.audit` | Read and export audit history, including action details |
| `access.manage` | View and edit Discord rank permissions |
| `notes.add`, `notes.edit`, `notes.remove` | Individual note actions (also require player and notes tabs) |
| `punish.warn`, `punish.kick`, `punish.mute`, `punish.ban`, `punish.offense` | Individual punishment actions (also require player and punishment tabs) |
| `punish.remove` | Remove direct punishment records |
| `punish.revoke` | Remove an entire configured offense case |

Profile tabs also require `tab.players`. Empty permissions deny login. Notes remain editable/removable only by their author and cannot be system notes. Removal requires a reason and confirmation, preserves punishment history, and records the remover. Direct removals lift the selected record only; unrelated live bans remain enforced. Offense records must be removed through **Remove case** to keep escalation counts consistent. Removing a kick record does not reverse the kick. Reasons are retained in the web audit trail.

Old `.access=admin|moderator|viewer|deny` settings still load with equivalent explicit grants; old admin access gains direct punishment removal, while rank management remains limited to old owner/dev mappings. An explicit `.permissions` entry, including an empty one, takes precedence. Saving ranks replaces legacy access keys with permissions. Local accounts can use `permissions.<username>=...` to override legacy grants; their existing `user.<username>=rank,UUID,SALT:HASH` format is retained and a custom rank name requires explicit permissions. Neither the browser nor the Minecraft bridge derives grants from those rank names.

Install the rebuilt mod and web app together: bridge actors now carry explicit permissions, and the mod rejects requests without them.

## Batched data transport

Large initial reads and real-time snapshots are batched on **both** WebSocket hops: Minecraft → Node and Node → browser. Each chunk carries a transfer ID, sequence number, and total count. Chunks contain at most 8,192 UTF-16 characters, preserve emoji/surrogate pairs, and remain below the 64 KiB WebSocket message limit including JSON escaping. Small messages travel directly.

Node and the browser expose a snapshot only after every chunk is received in order. Missing, duplicate, malformed, or timed-out transfers are discarded; reconnect starts fresh without replaying commands. Writes wait for the preceding frame to drain. Browser connections also have a bounded outgoing queue and authorization is checked between frames.

There is a **32 MiB total UTF-8 limit per assembled message** and a 30-second transfer deadline. These bounds prevent unbounded buffering; exceeding them produces an error or disconnect instead of an encoding exception. Existing command deadlines still apply. Mutation requests remain small and retain their existing validation limits. HTTP refresh responses use normal HTTP JSON after bridge reassembly; they are not Minecraft string-codec packets.

Deploy the updated mod and Node service together and reload browser tabs to load the matching batch receiver.

## Discord tickets

The optional [Discord bot](../discord-bot/README.md#ticket-categories-and-panel-sync) sends channel metadata to `/tickets-sync` using its own `TICKET_SYNC_TOKEN` (set the same secret in both services). Minecraft is not involved. The endpoint is disabled until this secret is configured; it does not use staff cookies or the Minecraft bridge token.

Grant `tab.tickets` in **Rank access**, plus each allowed category permission:

- `tickets.lost-items-or-airship`
- `tickets.other-support`
- `tickets.cant-connect-to-the-server`
- `tickets.buy-a-shop-plot-at-spawn`
- `tickets.stealing-or-grieffing`
- `tickets.player-report`
- `tickets.report`

Both grants are required. The API filters category labels and records before returning them; direct requests to forbidden categories return 403. Existing explicit ranks receive no new permissions automatically. Rank edits saved through the panel apply immediately.

The Tickets inbox displays channel names, forum tags, and links to Discord, with 50 tickets per page and automatic refresh every 15 seconds. Discord still enforces channel access when opening those links. Ticket conversations support reading and replying; closing tickets is not implemented. See the bot README for source category IDs and name-pattern overrides. No received snapshot means a waiting notice; stale snapshots are visibly marked. Restarting the web service clears its in-memory snapshot until the next bot sync.

### Ticket conversations

Select a ticket in the inbox to read its conversation, text embeds and inline image/video/audio attachments. History loads in pages of 25; “Load earlier messages” retrieves older pages. The open conversation refreshes every 10 seconds. Text is rendered without raw HTML. Other attachment links open separately; uploads are not implemented.

The existing ticket tab and category grants allow reading. Grant the additional **`tickets.reply`** permission to allow responding within those permitted categories. The API enforces both grants, CSRF protection and request deduplication. Staff replies are attributed, mention pings are disabled, and the audit log records requested/successful/unconfirmed sends. If a connection fails during a send, inspect the refreshed conversation before retrying; the draft remains in the editor and the request is not replayed automatically.

Restart both services after updating. Enable the bot's **Message Content Intent** and the Discord permissions described in the bot README. Both `/tickets-sync` and `/tickets-commands` must accept WebSocket upgrades. A disconnected bot shows an error in the conversation while the existing ticket directory remains available.

Ticket media displays inline: images/GIFs open full size when clicked, and video/audio attachments have native playback controls. Spoiler attachments require a click to reveal. Previews load only from Discord CDN/media hosts; other files remain links. Signed attachment URLs are refreshed when message history refreshes. Unsupported browser codecs or unavailable files fall back to a link. Media is loaded directly from Discord, not streamed through Minecraft or the panel server; there is no autoplay. External service players (such as YouTube/Spotify iframes) and uploading attachments are not implemented.

Ticket authors use their server nickname and server-profile avatar when available, falling back to their Discord display name and global/default avatar. Hover over the author name to see the account username. Missing or failed avatar images display initials. Webhook authors retain their own profile identity.

Ticket text supports Discord-style bold, italics, underline, strikethrough, spoilers, inline/fenced code, headings, quotes, lists, subtext and HTTP(S) links. User/role mentions appear as highlighted badges with resolved names. Names are rendered literally, code blocks do not format mentions, and raw HTML is never executed. This renderer does not implement Discord interactive components or custom emoji/sticker rendering.

## Developer to-do and Discord suggestions

**To-do** is a persistent developer board for fixes and features. Tasks have a title, details, assignee, priority and status (To do / In progress / Done). Search filters the board. Data lives in `DATA_DIR/todos.json`; include it in backups and mount `DATA_DIR` persistently in containers. Saves are atomic, with version checks to reject stale concurrent edits. Run one web process against this data directory. The board supports up to 2,000 tasks.

Grant `tab.todo` plus the required `todo.create`, `todo.edit`, and/or `todo.delete` permissions to your developer ranks in Rank access. There is no hardcoded `dev` rank name. Read-only users need just `tab.todo`. Refresh tasks to see other staff's changes; a conflict requires refreshing and reopening the task before saving.

**Suggestions** displays active and archived threads from the forum set by `SUGGESTIONS_FORUM_ID` in `discord-bot/.env`. Use the forum channel ID, not a category ID. The existing `TICKET_SYNC_URL` / `TICKET_SYNC_TOKEN` WebSocket connection carries suggestions as well. Each page has at most 24 threads plus forum metadata; conversations use the existing bounded message transport.

Grant `tab.suggestions` to read suggestions and `suggestions.tags` to apply/remove the forum's existing tags (up to five per thread). This edits applied tags, not the forum's tag definitions. Tags are checked against the configured forum and current thread tags before saving. Archived/locked threads are readable but cannot be retagged here; reopen them in Discord first. The bot needs View Channel, Read Message History and Manage Threads for tag edits. Tag operations are audited. Grant `suggestions.reply` alongside `tab.suggestions` to respond from the panel. Replies use the same server-nickname/rank signature, disabled mention pings, CSRF checks, duplicate-send protection and audit logging as ticket replies. Archived or locked threads must be reopened in Discord first.

**Admin controls.** Three more permissions, granted in Rank access (legacy `admin` accounts get them automatically): `suggestions.status` changes a suggestion's status, `suggestions.create` posts a new suggestion, and `suggestions.delete` deletes a suggestion's thread. Statuses are fixed: Denied, Done, Under consideration, Maybe next season, Waiting for update, Testing, Poll. Posting and status edits go through the Discord webhook configured as `SUGGESTIONS_WEBHOOK_URL` in the bot's `.env` (a webhook of the suggestions forum channel). A status is stored as a final `**Status:** …` line of the suggestion's first message, which the bot edits through that webhook, so the Discord post always shows the current status. The webhook can only edit messages it posted: suggestions created from the panel work, but threads started by community members cannot get a status and the panel reports that. Status changes use a version check (a conflict asks you to refresh). Deleting removes the whole Discord thread and needs Manage Threads for the bot. All three actions are written to the audit log.

“Create task” links a suggestion to the To-do board and requires both `tab.todo` and `todo.create`. Duplicate imports of the same suggestion are rejected. All new permissions appear in Rank access; existing explicit grants are unchanged. Restart both services after deploying, and save rank permissions in Rank access to apply them immediately.

Tasks can be dragged between status columns by users with `todo.edit`. A status dropdown on each card provides the same action for keyboard/touch users. Moves save immediately with the existing version check; failed moves keep the original position. Dragging is disabled while saving or editing a task.

Suggestions use compact rows with name search on the current page and multi-select tag filters (all selected tags must match). Active and archived suggestions are filtered and sorted by latest message time, newest first, before pagination. Archived listings are cached for 30 seconds; scans exceeding 10,000 entries or the time budget return an error instead of a partially sorted list. Filters persist when switching Active/Archived; Clear filters resets them.

Suggestion pages are cached in the current signed-in view for 30 seconds (up to 30 page/filter combinations). Returning to a fresh cached page is instant. While uncached or expired results load, the previous list and filter controls stay visible with an updating status; stale rows and pagination cannot be activated. Refresh suggestions and successful tag edits invalidate the cache. Leaving the view or signing out discards it.


## Minecraft in-game login

Admin GUI 2.4.0 can sign a linked player in without opening Discord OAuth in MCEF.
Install the updated Admin GUI jar on both clients and Minecraft server, and deploy
this updated web server/client bundle and Discord bot together. Discord Link on
Minecraft must expose `DiscordLinkAPI.getPlayerLink(UUID)`.

Set the website URL in the Minecraft server's `config/admin_gui-common.toml`:

```toml
panelUrl = "https://your-panel.example/"
```

There is no default URL: an empty setting opens no website. Clients use the URL
sent by the server, not a local URL setting. Then create the server-only
`config/admin-gui-server.properties`:

```properties
enabled=true
bridge-token=REPLACE_WITH_ADMIN_PANEL_BRIDGE_TOKEN
```

Use the same secret as the web service's `ADMIN_PANEL_BRIDGE_TOKEN`. This file is
server-only; never put the secret in client config. Auto-login derives its origin
from the server's `panelUrl`, which must use the panel's public origin. The old
`panel-origin` property is ignored and can be removed. Remote auto-login origins
require HTTPS; HTTP is accepted only for loopback development.

Keep `auth.mode=discord`. The panel asks the connected Discord bot for a fresh
member lookup in `discord.guild-id` and applies the existing `discord.rank-order`
and per-rank permissions. The bot's `DISCORD_AUTH_GUILD_ID` must match, and its existing
`TICKET_SYNC_URL` / `TICKET_SYNC_TOKEN` connection must be configured for command
requests. Bot credentials remain exclusively in the bot. A mismatch, pending
membership, unavailable bot, conflicting explicit Minecraft mapping, or lack of
`panel.access` denies auto-login.

Tickets contain 512 bits of randomness, expire in 60 seconds, replace earlier
pending tickets for that Minecraft UUID, and can be consumed only once. The panel
stores only their hashes plus the UUID/Discord identity. The frontend removes the
ticket from the URL fragment before exchanging it over a same-origin JSON POST,
then receives the standard HttpOnly session cookie and CSRF token. Role permissions
are snapshotted at login, as with normal OAuth. Ticket values are never put in URL
queries, audit records, or application logs.

Unlinked players, missing/disabled configuration, failed ticket issuance, and
unauthenticated/offline-mode Minecraft servers use the normal login page. An
issued but expired/denied ticket displays the normal sign-in UI with an error.
A failed handoff clears any previous browser session to avoid silently retaining
a different identity. The Minecraft server derives both identities itself and
rechecks the player connection, permission, and link before sending the ticket;
clients cannot supply the UUID, Discord ID, or permissions.


Minecraft login diagnostics include a non-secret `loginId` shared with the
Minecraft server and the other service. Follow that ID to see ticket issuance,
bot guild/member lookup, rank authorization and session creation. Failures carry
specific reason codes such as `login-member-missing`, `login-guild-inaccessible`,
`login-guild-mismatch`, `login-membership-pending` or `login-rank-denied`.
Bot logs include the failed stage and elapsed time; web logs include UUID, Discord
ID and auth guild, and rank-denial logs show configured versus member role IDs.
Tickets, session/CSRF cookies, bot/bridge secrets and raw upstream error bodies
are never logged. Deploy and restart the rebuilt bot and web service together
to receive the specific error messages rather than the old generic 502.


## Player map and FTB Chunks terrain

The **Player map** tab displays online player positions, refreshed every five seconds. Choose a dimension, drag or use arrow keys to pan, scroll or use the zoom buttons, and click a player to follow them across dimensions. The map opens at the server’s world spawn. **Center map** stops following, returns to the Overworld, and centers that same world spawn. Regular position refreshes preserve your chosen view.

Grant `tab.map` to view player positions and terrain. Grant `map.upload` in addition to upload FTB Chunks regions, and `map.remove` to remove them. These grants are independent of player profile access and rank names. Legacy admin accounts receive all three; existing explicit permission lists need the grants added in Rank access or the properties file. Sign in again after changing grants.

Expand **FTB Chunks terrain**, select the matching dimension, and upload one or more client cache region ZIPs named `XXXXX-XXXXX.zip` (for example `0EA60-0EA60.zip` is region 0,0). Upload individual region archives or a full cache export ZIP containing `dimensions.txt`, optional `block_map.txt` / `biome_map.txt`, and dimension folders such as `minecraft_overworld/`. Only the selected dimension is imported. Each region covers 512 by 512 blocks. Archives must include `chunks.dat`, `data.png`, `blocks.png`, `grass.png`, `foliage.png`, and `water.png`. The terrain codec, palette and shading come from the local stasis-control project's FTB Chunks map. Cache exports use their `block_map.txt` index mapping, which is persisted per imported region for later individual updates. Individual regions without an exported mapping use the Stasis palette; unknown block indices render transparently.

Imports merge chunks using their recorded timestamps: newer chunks replace older chunks, while chunks absent from an upload are preserved. Equal timestamps keep existing data. Each uploaded ZIP is limited to 20 MiB, cache exports are limited to 2,048 entries and 64 MiB expanded data, nested region entries remain strictly bounded, and `chunks.dat` versions 0–3 are supported. Images must be 512 by 512, and each dimension supports up to 512 imported regions. Decoding, merging and rendering run in a bounded worker, one import at a time. Original caches and rendered tiles persist under `DATA_DIR/map/`; keep that directory when redeploying. Viewing requires no upload permission, and importing/removing terrain is recorded in the audit log.

Deploy the updated Minecraft mod and web archive together for live positions. Terrain is stored by the web service and remains visible while Minecraft is disconnected; player markers clear when position requests fail. The Java bridge captures positions on the Minecraft server thread and performs no terrain processing there.

The map's **Show offline players** toggle is off by default. Enable it to include players with readable last-saved positions, shown with gray markers, an Offline label, and the save timestamp. Offline NBT files are read and cached on the bridge worker; online positions take precedence, and missing or invalid saves are omitted. Turning the toggle off stops requesting offline data.

**Show claims** overlays live FTB Chunks claims for the selected dimension, using FTB Teams names and colors. Hover a chunk to see its owner; expand **Claim teams** to find and center a team's claims. Dashed borders indicate force-loading is enabled, not necessarily currently active. Claim data refreshes every 30 seconds and requires only `tab.map`; terrain uploads are not needed. The integration is optional and shows an availability message when FTB Chunks/Teams are absent or incompatible. Live claim data is captured on the server thread through the [FTB Chunks public API](https://github.com/FTBTeam/FTB-Chunks/blob/1.21.1/main/common/src/main/java/dev/ftb/mods/ftbchunks/api/ClaimedChunkManager.java), then grouped and serialized on the bridge worker. Snapshots are capped at 100,000 chunks per dimension with an explicit truncation notice.

The dimension selector lists loaded server dimensions, including worlds with no players. Labels omit namespaces and use readable words (`minecraft:the_nether` → `The Nether`); requests and terrain storage retain the full dimension ID.

Player markers use skin heads with green online outlines and gray dashed offline outlines. A gold outer border identifies the followed player. A pixel-face fallback appears when a skin is unavailable; head requests use the existing server skin proxy and are limited to two concurrent requests per map.

Head images use a server-side provider fallback and deduplicate simultaneous requests for the same player. The map keeps its download queue while panning or following players and retries failed loads with bounded exponential backoff, so transient skin-service failures recover without reloading the map.

All player avatars, map heads and full-body views share the `Skins` service and skin URL utility. Successful head/body images are cached for seven days in memory and on disk under `DATA_DIR/cache/skins/mineskin-v1/`, so restarts reuse valid cached files. The cache is case-insensitive per image type and UUID (with username support for older callers), capped at 512 files, and written atomically. Expired or invalid cached files are fetched again; reads do not extend their lifetime. Keep this directory on persistent storage when redeploying. HTTP cache headers and the map's bitmap cache use the same seven-day limit. Failed head and skin fetches persist retry state in `DATA_DIR/cache/skins/mineskin-v1/retries.json`, retrying on later access after 30 seconds, 1 minute, 2 minutes, and so on up to 1 hour. A successful fetch resets its delay. Open profile heads and full-body images automatically request another attempt with increasing delays; map heads retain their existing retry queue. Keep `DATA_DIR/cache/` across deployments to retain names, images and retry state.


## Kill feed

The **Kill feed** tab records new player deaths after installing the updated mod and enabling the bridge. It shows killer/victim identities, Minecraft death message and damage type, direct projectile/entity where applicable, weapon item ID and custom name, enchantments and durability, time and location. Environmental deaths are included. If Minecraft attributes a later environmental death to recent combat, the feed marks that attribution and does not invent a weapon when the damage source provides none.

Expand a death to inspect the victim's inventory, armor, offhand and Curios as captured before drops, plus experience and the keepInventory setting. These are historical snapshots, not the player's current inventory. Ender Chest contents are not carried items and are not included. Grant `tab.killFeed` to view the feed and weapon details; add `killFeed.inventory` for the victim's carried-item snapshot. Existing explicit ranks need the new grants added and a new login. Neither grant requires player profile access.

Events cancelled before the death event finishes are discarded. Live item/entity state is captured on the Minecraft server thread; JSON serialization, retention, disk writes and reads run on a separate bounded worker. History survives restarts in the world's `admin-panel-kill-feed/` directory, retaining at most 2,000 deaths and 64 MiB. Individual snapshots are limited to 8 MiB; queue/storage failures are reported in the Minecraft log. Feed pages are searchable and update every five seconds. Updating the Minecraft mod and web service together is required. Live death-hook/mod compatibility still needs a dedicated-server check.


### Bot-backed to-do assignments and personal counters

Task assignees are selected from the connected Discord bot's staff directory, showing nickname and rank. A member is eligible when their highest configured panel rank has `panel.access` and `tab.todo`. The directory uses the bot auth guild, which must match the panel's `discord.guild-id`. Assignments save stable Discord IDs; legacy text assignments are preserved until reassigned through the dropdown. New arbitrary text assignments are rejected.

The To-do navigation badge shows the signed-in Discord user's assigned **To do + In progress** total. The board shows the two counts separately. Completed, unassigned and other users' tasks do not count. Counts update after your edits and refresh every 30 seconds for changes made by other staff. Local accounts without a linked Discord identity show zero personal assignments. This does not revalidate session ranks or change login-time authorization snapshots.

Deploy the updated web service and Discord bot, then sign in again. The bot application needs Server Members Intent enabled in the Discord developer portal for member listing. Keep `DATA_DIR/todos.json` when updating.

Bridge actors receive permissions scoped to the requested feature. New kill-feed permissions are sent only for kill-feed operations, TSA grants only for TSA operations, and player grants for profile/moderation operations. This prevents an older installed mod from rejecting unrelated TSA/player requests over newer permission names. The kill feed itself still requires the updated Minecraft mod.


### Item NBT inspection

Expand a non-empty item in the normal inventory, Ender Chest, Curios or kill-feed snapshot, then expand **NBT data** to inspect its saved item components. Compounds, lists and typed arrays expand independently; numeric values remain strings so 64-bit values retain their exact precision. Item encoding uses the Minecraft registry on the server thread, while typed-tree conversion and serialization run on workers. Views are bounded to 50,000 NBT nodes per snapshot and depth 64, with explicit truncation notices. Existing storage and kill-feed inventory permissions apply.

Normal online inventories show the current snapshot and offline inventories use the saved item data. Kill-feed NBT is frozen at death. Older death records have no NBT and show a clear unavailable message; they are not filled from a player's current inventory. Deploy the updated mod and web archive together.

Player directory filters combine name/UUID search, online status, staff rank and detection status. Detection status uses the same `hasDetections` flag as red player names and requires `tab.security`. Staff ranks match linked Minecraft accounts by Discord ID to their highest configured panel rank with `panel.access`, independently of to-do access. The bot directory refreshes every two minutes and requires the bot's member-list access. Update the bridge mod to supply linked IDs; older bridge versions leave ranks unknown. The staff directory endpoint requires `tab.players` and returns ranks without exposing linked Discord IDs. If the bot is unavailable, all-player browsing remains usable and the rank filter reports the failure.

Unknown player UUIDs in player lists, details and offline map entries use a web-server-side Mojang session profile lookup. HTTP responses and live WebSocket list/detail snapshots share the same resolver, so names load without selecting a player. Local usernames take priority. Head and skin requests use UUIDs directly, independently of username lookups. HTTP and initial live snapshots return immediately with local/cached names or UUIDs; live updates publish resolved names afterwards. Lookups have a three-second timeout and run in groups of 20 with at most two concurrent requests (Mojang’s UUID endpoint accepts one UUID per request). Names are cached for seven days in `DATA_DIR/cache/mojang-names.json`; local names override and replace cached names immediately. Failures retain the last known name or UUID and persist their retry state. Retries happen on the next request after increasing delays of 30 seconds, 1 minute, 2 minutes, and so on, capped at 1 hour; success resets the delay. Provider failures and rate limits also pause queued Mojang requests. Both caches are bounded to 10,000 entries. Offline-mode UUIDs may have no Mojang profile. This requires only a web-server update; the Minecraft mod is unchanged.

Heads and full-body renders both use mineskin.eu (`/helm/<name>/32.png` and `/armor/body/<name>/256.png`). The `mineskin-v1` cache directory and image URL version bypass previously cached images from mixed providers.

Player directory/profile images, map heads and kill-feed player heads use UUIDs as mineskin.eu identities and cache keys, so name changes and Mojang lookup delays do not affect image loading.

To migrate existing username-based PNG filenames to UUIDs using the saved username cache, run from the repository root:

```sh
python3 tools/rename-skin-cache.py --dry-run
python3 tools/rename-skin-cache.py
```

Use `--names /path/to/mojang-names.json --skins /path/to/cache/skins` for another deployment. The script includes subdirectories, preserves image timestamps, and skips existing UUID targets, unknown names and names associated with multiple UUIDs. Files stay in their current provider directories. Stop the web server during migration so its in-memory cache cannot recreate the old filenames.
