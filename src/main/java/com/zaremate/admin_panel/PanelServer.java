package com.zaremate.admin_panel;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.logging.Logger;

final class PanelServer implements AutoCloseable {
    private static final Logger LOG = Logger.getLogger("admin_panel");
    private final Config config;
    private final Auth auth;
    private final DiscordAuth discord;
    private final Backend backend;
    private final Audit audit;
    private final HttpServer server;
    private final ExecutorService workers;
    private final SkinCache skinCache = new SkinCache();
    private final ExecutorService skinWorkers = new ThreadPoolExecutor(2, 2, 0,
            TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(16), new ThreadPoolExecutor.AbortPolicy());
    private final ConcurrentHashMap<String, Long> roleValidatedAt = new ConcurrentHashMap<>();
    private static final long ROLE_RECHECK_MS = 5 * 60_000L;
    // Session-scoped request IDs are retained for the session lifetime. Never silently replay a mutation.
    private final Map<String, Long> requests = new HashMap<>();
    PanelServer(Config config, Backend backend, Audit audit) throws Exception {
        this(config, backend, audit, config.discord() == null ? null : new HttpDiscordApi(config.discord()));
    }
    PanelServer(Config config, Backend backend, Audit audit, DiscordApi discordApi) throws Exception {
        this.discord = config.discord() == null ? null : new DiscordAuth(config.discord(), discordApi, config.origin());
        this.config = config; this.auth = new Auth(config.users()); this.backend = backend; this.audit = audit;
        server = HttpServer.create(new InetSocketAddress(config.bind(), config.port()), 32);
        workers = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(64), new ThreadPoolExecutor.AbortPolicy());
        server.setExecutor(workers);
        server.createContext("/", this::handle);
    }
    void start() { server.start(); }
    int port() { return server.getAddress().getPort(); }
    public void close() { server.stop(1); workers.shutdownNow(); skinWorkers.shutdownNow(); }
    private void handle(HttpExchange x) {
        try {
            x.getResponseHeaders().set("Cache-Control", "no-store");
            x.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
            x.getResponseHeaders().set("Referrer-Policy", "no-referrer");
            x.getResponseHeaders().set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
            String host = x.getRequestHeaders().getFirst("Host");
            if (!URI.create(config.origin()).getRawAuthority().equalsIgnoreCase(host)) throw new Failure(403, "Unrecognized host");
            route(x);
        } catch (Failure e) { error(x, e.status, e.getMessage()); }
        catch (IllegalArgumentException | JsonParseException e) { error(x, 400, "Invalid request: " + e.getMessage()); }
        catch (Exception e) { LOG.warning("Panel request failed: " + e); error(x, 500, "Request failed. Check the audit trail and server log before retrying."); }
        finally { x.close(); }
    }
    private void route(HttpExchange x) throws Exception {
        String path = x.getRequestURI().getPath(), method = x.getRequestMethod();
        boolean post = method.equals("POST");
        if (!method.equals("GET") && !post) throw new Failure(405, "Method not allowed");
        if (post) {
            if (!config.origin().equals(x.getRequestHeaders().getFirst("Origin"))) throw new Failure(403, "Origin rejected");
            String type = x.getRequestHeaders().getFirst("Content-Type");
            if (type == null || !type.split(";")[0].equalsIgnoreCase("application/json")) throw new Failure(415, "JSON required");
        }
        if (!path.startsWith("/api/")) {
            if (post) throw new Failure(405, "Method not allowed");
            String resource = switch (path) { case "/" -> "index.html"; case "/app.js" -> "app.js"; case "/style.css" -> "style.css"; default -> null; };
            if (resource == null) throw new Failure(404, "Not found");
            try (var in = getClass().getResourceAsStream("/web/" + resource)) {
                if (in == null) throw new Failure(404, "Not found");
                bytes(x, 200, resource.endsWith("css") ? "text/css" : resource.endsWith("js") ? "text/javascript" : "text/html", in.readAllBytes());
            }
            return;
        }
        if (path.equals("/api/auth/method") && !post) {
            JsonObject methodInfo = new JsonObject(); methodInfo.addProperty("mode", discord == null ? "local" : "discord");
            json(x, 200, methodInfo); return;
        }
        if (path.equals("/api/auth/discord/start") && !post && discord != null) {
            if (!auth.allowLogin(x.getRemoteAddress().getAddress().getHostAddress())) throw new Failure(429, "Too many login attempts. Try again in five minutes.");
            DiscordAuth.Start start = discord.start();
            oauthCookie(x, start.browserToken(), 300);
            redirect(x, start.location()); return;
        }
        if (path.equals("/api/auth/discord/callback") && !post && discord != null) {
            try {
                Map<String, String> query = query(x.getRequestURI().getRawQuery());
                DiscordAuth.Login login = discord.finish(query.getOrDefault("state", ""), namedCookie(x,"panel_oauth"), query.get("code"), query.containsKey("error"));
                audit.write(login.user().name(), "discord-login", "", "success", new JsonObject());
                auth.logout(cookieToken(x));
                cookie(x, auth.create(login.user(), login.grant()), 28800);
                oauthCookie(x, "", 0);
                redirect(x, "/");
            } catch (Exception failure) {
                oauthCookie(x, "", 0);
                String message = failure instanceof Failure ? failure.getMessage() : "Discord sign-in failed. Please try again.";
                redirect(x, "/?loginError=" + HttpDiscordApi.encode(message));
            }
            return;
        }
        if (path.equals("/api/login") && post) {
            if (discord != null) throw new Failure(403, "Password login is disabled. Sign in with Discord.");
            if (!auth.allowLogin(x.getRemoteAddress().getAddress().getHostAddress())) throw new Failure(429, "Too many login attempts. Try again in five minutes.");
            JsonObject b = body(x);
            Auth.User user = auth.authenticate(string(b, "username", 32), string(b, "password", 256));
            if (user == null) throw new Failure(401, "Invalid username or password");
            audit.write(user.name(), "login", "", "success", new JsonObject());
            cookie(x, auth.create(user), 28800);
            json(x, 200, new JsonObject()); return;
        }
        String token = cookieToken(x);
        Auth.Session session = auth.get(token);
        if (session == null) throw new Failure(401, "Please sign in");
        Auth.User user = session.user();
        if (discord != null && session.discord() != null) {
            long now = System.currentTimeMillis();
            Long last = roleValidatedAt.get(token);
            if (last == null || now - last >= ROLE_RECHECK_MS || post) {
                try {
                    // Authorization failures and API outages fail closed.
                    user = discord.authorize(session.discord());
                    auth.refresh(token, user);
                    roleValidatedAt.put(token, now);
                } catch (Exception invalid) {
                    roleValidatedAt.remove(token);
                    auth.logout(token);
                    throw invalid;
                }
            }
        }
        if (post && !session.csrf().equals(x.getRequestHeaders().getFirst("X-CSRF-Token"))) throw new Failure(403, "Invalid CSRF token");
        if (path.equals("/api/logout") && post) { auth.logout(token); cookie(x, "", 0); json(x, 200, new JsonObject()); return; }
        if (discord != null) {
            if (session.discord() == null) { auth.logout(token); throw new Failure(401, "Sign in with Discord"); }
            // Membership and rank were verified during OAuth login. Use the session snapshot.
        }
        if (path.equals("/api/session") && !post) {
            JsonObject r = new JsonObject(); r.addProperty("name", user.name()); r.addProperty("role", user.role()); r.addProperty("rank", user.rank()); r.addProperty("csrf", session.csrf());
            json(x, 200, r); return;
        }
        if (path.startsWith("/api/skin/") && !post) {
            String[] parts = path.split("/");
            if (parts.length != 5 || !Set.of("head", "body").contains(parts[3]) || !parts[4].matches("[A-Za-z0-9_]{3,16}"))
                throw new Failure(404, "Not found");
            Future<byte[]> task;
            try { task = skinWorkers.submit(() -> skinCache.load(parts[3], parts[4])); }
            catch (RejectedExecutionException busy) { throw new Failure(503, "Skin service busy"); }
            byte[] png;
            try { png = task.get(10, TimeUnit.SECONDS); }
            catch (TimeoutException slow) { task.cancel(true); throw new Failure(504, "Skin service timed out"); }
            catch (ExecutionException error) {
                if (error.getCause() instanceof Exception cause) throw cause;
                throw error;
            }
            x.getResponseHeaders().set("Cache-Control", "private, max-age=21600");
            bytes(x, 200, "image/png", png);
            return;
        }
        if (path.equals("/api/access/ranks") && !post) {
            if (!user.isAdmin()) throw new Failure(403, "Administrator role required");
            JsonObject result = new JsonObject();
            result.add("ranks", config.discord() == null ? new JsonArray() : config.discord().accessRanks());
            json(x, 200, result); return;
        }
        if (path.equals("/api/icons") && post) {
            JsonObject b=body(x);
            if (!b.has("ids") || !b.get("ids").isJsonArray() || b.getAsJsonArray("ids").size()>128) throw new Failure(400,"Expected at most 128 item IDs");
            for (JsonElement id : b.getAsJsonArray("ids")) if (!id.isJsonPrimitive() || !id.getAsJsonPrimitive().isString() || !ItemIcons.valid(id.getAsString())) throw new Failure(400,"Invalid item ID");
            json(x,200,backend.icons(b.getAsJsonArray("ids"))); return;
        }
        if (path.equals("/api/players") && !post) { json(x, 200, backend.players()); return; }
        if (path.equals("/api/audit") && !post) {
            if (!user.isAdmin()) throw new Failure(403, "Administrator role required");
            json(x, 200, audit.recent()); return;
        }
        String[] parts = path.split("/");
        if (parts.length >= 4 && parts[2].equals("players")) {
            UUID id = UUID.fromString(parts[3]);
            if (parts.length == 4 && !post) { json(x, 200, backend.player(id, user)); return; }
            if (parts.length == 5 && post && Set.of("punish", "note-add", "note-edit", "note-remove", "revoke").contains(parts[4])) {
                String action = parts[4];
                if (!user.canModerate()) throw new Failure(403, "Moderator role required");
                JsonObject b = body(x);
                if ((action.equals("revoke") || action.equals("punish") &&
                        (!b.has("type") || !Set.of("WARN", "KICK", "MUTE").contains(string(b, "type", 16)))) && !user.isAdmin())
                    throw new Failure(403, "Administrator role required for bans, configured offenses, and revocations");
                String requestId = x.getRequestHeaders().getFirst("X-Request-ID");
                if (requestId == null || !requestId.matches("[a-zA-Z0-9-]{16,80}")) throw new Failure(400, "Request ID required");
                synchronized (requests) {
                    requests.entrySet().removeIf(e -> e.getValue() <= System.currentTimeMillis());
                    if (requests.containsKey(token + requestId)) throw new Failure(409, "This request was already submitted. Refresh the player and audit trail; do not repeat it.");
                    if (requests.size() >= 10000) throw new Failure(503, "Mutation capacity reached; try after sessions expire");
                    requests.put(token + requestId, session.expires());
                }
                b.addProperty("requestId", requestId);
                audit.write(user.name(), action, id.toString(), "requested", b);
                try {
                    JsonElement result = backend.mutate(id, user, action, b);
                    audit.write(user.name(), action, id.toString(), "success", result);
                    json(x, 200, result);
                } catch (Exception e) {
                    JsonObject failure = new JsonObject(); failure.addProperty("requestId", requestId); failure.addProperty("error", e.getMessage());
                    audit.write(user.name(), action, id.toString(), "failed-or-unconfirmed", failure);
                    throw e;
                }
                return;
            }
        }
        throw new Failure(404, "Not found");
    }
    static String string(JsonObject b, String key, int max) {
        if (!b.has(key) || !b.get(key).isJsonPrimitive() || !b.getAsJsonPrimitive(key).isString()) throw new IllegalArgumentException(key + " is required");
        String value = b.get(key).getAsString();
        if (value.isBlank() || value.length() > max || value.chars().anyMatch(c -> c < 32 && c != 10)) throw new IllegalArgumentException(key + " is invalid");
        return value;
    }
    private JsonObject body(HttpExchange x) throws Exception {
        byte[] b = x.getRequestBody().readNBytes(16385);
        if (b.length > 16384) throw new Failure(413, "Request too large");
        JsonElement value = JsonParser.parseString(new String(b, StandardCharsets.UTF_8));
        if (!value.isJsonObject()) throw new Failure(400, "JSON object required");
        return value.getAsJsonObject();
    }
    private String cookieToken(HttpExchange x) { return namedCookie(x, "panel_session"); }
    private String namedCookie(HttpExchange x, String name) {
        String c = x.getRequestHeaders().getFirst("Cookie");
        if (c != null) for (String item : c.split(";")) if (item.trim().startsWith(name + "=")) return item.trim().substring(name.length() + 1);
        return "";
    }
    private void oauthCookie(HttpExchange x, String value, int age) {
        x.getResponseHeaders().add("Set-Cookie", "panel_oauth=" + value + "; Path=/api/auth/discord; HttpOnly; SameSite=Lax; Max-Age=" + age + (config.secure() ? "; Secure" : ""));
    }
    private void redirect(HttpExchange x, String location) throws Exception { x.getResponseHeaders().set("Location", location); x.sendResponseHeaders(302, -1); }
    static Map<String, String> query(String query) {
        Map<String,String> values = new HashMap<>();
        if (query != null) {
            if (query.length() > 8192) throw new Failure(400, "OAuth query too large");
            for (String item : query.split("&")) {
                String[] pair = item.split("=", 2);
                String key = URLDecoder.decode(pair[0], StandardCharsets.UTF_8);
                if (values.putIfAbsent(key, pair.length > 1 ? URLDecoder.decode(pair[1], StandardCharsets.UTF_8) : "") != null) throw new Failure(400, "Duplicate OAuth parameter");
            }
        }
        return values;
    }
    private void cookie(HttpExchange x, String value, int age) {
        x.getResponseHeaders().set("Set-Cookie", "panel_session=" + value + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + age + (config.secure() ? "; Secure" : ""));
    }
    private void json(HttpExchange x, int status, JsonElement value) throws Exception { bytes(x, status, "application/json", value.toString().getBytes(StandardCharsets.UTF_8)); }
    private void bytes(HttpExchange x, int status, String type, byte[] b) throws Exception {
        x.getResponseHeaders().set("Content-Type", type + "; charset=utf-8"); x.sendResponseHeaders(status, b.length); x.getResponseBody().write(b);
    }
    private void error(HttpExchange x, int status, String message) {
        try { JsonObject b = new JsonObject(); b.addProperty("error", message); json(x, status, b); } catch (Exception ignored) {}
    }
    static final class Failure extends RuntimeException {
        final int status;
        Failure(int status, String message) { super(message); this.status = status; }
    }
}
