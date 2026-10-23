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

## Tests and Docker

`npm run typecheck`, `npm run build`, and `npm test` validate the Node app and React UI. Browser tests require Chromium and a matching ChromeDriver. `gradle build` additionally runs the actual Java bridge client against Fastify; `npm test` alone skips that test unless `JAVA_BRIDGE_CLASSPATH` is set. Tests use temporary data and fake game/Discord services, not your live server.

From the repository root, `docker build -f web-server/Dockerfile -t admin-panel-web .` builds the Node service. Mount a writable persistent directory at `/data`, supply environment variables, and publish port 3000. The container runs as the `node` user. The Docker image does not manage TLS certificates.
