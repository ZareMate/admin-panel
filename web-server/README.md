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

For deployment without source, unpack `build/distributions/admin_panel-2.0.0-web.zip`, run `npm ci --omit=dev`, then `npm run setup` and `npm start`. React is already built in that archive. Keep `data/` on persistent storage. Run **one Node instance per Minecraft server**; bridge connections and browser sessions are process-local.

## Connect Minecraft

Install `admin_panel-2.0.0.jar` and its required Admin GUI dependency in Minecraft. Configure `config/admin-panel-bridge.properties`:

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

Normal `npm start` loads `.env` if present. Hosting-provided environment variables take precedence. The secret never goes into the React bundle. Use the existing `tools/create-user.py` from the repository to generate local account entries. Rank changes from the UI update the configuration atomically and take effect after restarting Node.

Bundled item exports are copied during the build. Optional additional exports go in `data/assets/icons/<namespace>__<item>.png`; copied mod jars go directly in `data/assets/` and are read only as asset archives. Restart Node after changing assets. Generated item textures, layered textures, and static cuboid models are previewed on the web host. Custom renderers, world tinting, and client-state-dependent items retain labeled fallbacks. Player list reads are coalesced and cached for two seconds; details stay viewer-specific for note ownership.

## Live state updates

Signed-in browsers connect to `/api/live` over WebSocket on the same host and port. Forward WebSocket upgrades for both `/bridge` (Minecraft) and `/api/live` (browsers); the nginx catch-all example above already does this. Install the updated mod and restart the Node service together, then reload browser tabs.

The mod samples only subscribed data approximately once per second and pushes snapshots only when content changes. Player joins/leaves and panel mutations also request an immediate sample. The player list is shared across viewers; the selected profile is keyed by player and staff identity/permissions, preserving note ownership. Location, inventory, playtime, security data, notes, and punishments update while that profile is open. Timestamp-only changes do not resend entire snapshots. Under server load, updates may take longer than one second.

Closing a tab or logging out removes its subscriptions; with no viewers, the mod does not continuously build live snapshots. Browser and Minecraft connections reconnect automatically and restore subscriptions. Expired sessions lose live access. Selected-player updates pause in the UI while a moderation dialog is open so forms are not disrupted. The Refresh button remains available, with a 30-second HTTP fallback when the live channel is unavailable. Commands are never replayed during reconnect.

The service bounds live connections to 128 total and four per staff session, with up to 32 distinct game subscriptions (one shared list plus up to 31 profiles with distinct staff identities). Slow browser clients are disconnected instead of accumulating unlimited queued snapshots.

## Tests and Docker

`npm run typecheck`, `npm run build`, and `npm test` validate the Node app and React UI. Browser tests require Chromium and a matching ChromeDriver. `gradle build` additionally runs the actual Java bridge client against Fastify; `npm test` alone skips that test unless `JAVA_BRIDGE_CLASSPATH` is set. Tests use temporary data and fake game/Discord services, not your live server.

From the repository root, `docker build -f web-server/Dockerfile -t admin-panel-web .` builds the Node service. Mount a writable persistent directory at `/data`, supply environment variables, and publish port 3000. The container runs as the `node` user. The Docker image does not manage TLS certificates.

## Permissions

Ranks use `discord.rank.<name>.permissions`, a comma-separated list. The highest matching Discord rank wins; grants are not combined across ranks. Rank names do not grant permissions. Use **Rank access** to select each permission, save, and restart Node. The editor preserves one rank with both `panel.access` and `access.manage`. Authorization is captured at login; restarting Node clears existing sessions.

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
