package com.zaremate.admin_panel;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermission;
import java.util.*;
import java.util.concurrent.*;

/** One-time localhost-only bootstrap, never exposed through the main panel. */
final class FirstRunSetup implements AutoCloseable {
    private final HttpServer server;
    private final ExecutorService workers = Executors.newFixedThreadPool(2);
    private final Path target;
    private final String token = Auth.token();
    private volatile boolean complete;

    FirstRunSetup(Path target) throws Exception {
        this.target = target;
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 8);
        server.setExecutor(workers);
        server.createContext("/", this::handle);
    }
    int port() { return server.getAddress().getPort(); }
    String token() { return token; }
    void start() { server.start(); }
    @Override public void close() { server.stop(0); workers.shutdownNow(); }

    private synchronized void handle(HttpExchange x) {
        try {
            x.getResponseHeaders().set("Cache-Control", "no-store");
            x.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
            x.getResponseHeaders().set("Referrer-Policy", "no-referrer");
            x.getResponseHeaders().set("Content-Security-Policy",
                    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
            if (!x.getRemoteAddress().getAddress().isLoopbackAddress()) throw new SetupFailure(403, "Local access only");
            String expected = "localhost:" + port();
            String host = x.getRequestHeaders().getFirst("Host");
            if (!expected.equals(host) && !("127.0.0.1:" + port()).equals(host) &&
                    !("[::1]:" + port()).equals(host)) throw new SetupFailure(403, "Invalid host");
            String path = x.getRequestURI().getPath();
            if (x.getRequestMethod().equals("GET")) {
                String name = switch (path) {
                    case "/" -> "setup.html";
                    case "/setup.js" -> "setup.js";
                    default -> null;
                };
                if (name == null) throw new SetupFailure(404, "Not found");
                try (var in = getClass().getResourceAsStream("/web/" + name)) {
                    if (in == null) throw new SetupFailure(500, "Missing setup page");
                    bytes(x, 200, name.endsWith(".js") ? "text/javascript" : "text/html", in.readAllBytes());
                }
            } else if (x.getRequestMethod().equals("POST") && path.equals("/api/setup")) {
                if (complete || Files.exists(target)) throw new SetupFailure(409, "Configuration already exists");
                if (!("http://localhost:" + port()).equals(x.getRequestHeaders().getFirst("Origin")) &&
                    !("http://127.0.0.1:" + port()).equals(x.getRequestHeaders().getFirst("Origin")))
                    throw new SetupFailure(403, "Invalid origin");
                if (!"application/json".equals(Optional.ofNullable(x.getRequestHeaders().getFirst("Content-Type"))
                        .orElse("").split(";")[0])) throw new SetupFailure(415, "JSON required");
                byte[] body = x.getRequestBody().readNBytes(16385);
                if (body.length > 16384) throw new SetupFailure(413, "Request too large");
                JsonObject json = JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject();
                if (!token.equals(text(json, "token", 256))) throw new SetupFailure(403, "Invalid setup token");
                Properties props = configuration(json);
                Files.createDirectories(target.getParent());
                Path temporary = Files.createTempFile(target.getParent(), ".admin-panel-", ".tmp");
                try {
                    try { Files.setPosixFilePermissions(temporary, EnumSet.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)); }
                    catch (UnsupportedOperationException ignored) {}
                    try (var out = Files.newOutputStream(temporary)) { props.store(out, "Created by Admin Panel first-run setup"); }
                    Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE);
                } finally { Files.deleteIfExists(temporary); }
                complete = true;
                bytes(x, 200, "application/json", "{\"success\":true,\"restartRequired\":true}".getBytes(StandardCharsets.UTF_8));
            } else throw new SetupFailure(404, "Not found");
        } catch (SetupFailure e) { failure(x, e.status, e.getMessage()); }
        catch (Exception e) { failure(x, 400, "Invalid configuration: " + e.getMessage()); }
        finally { x.close(); }
    }
    private static String text(JsonObject object, String field, int max) {
        if (!object.has(field) || !object.get(field).isJsonPrimitive() || !object.getAsJsonPrimitive(field).isString())
            throw new IllegalArgumentException("Invalid " + field);
        String value = object.get(field).getAsString().trim();
        if (value.isEmpty() || value.length() > max || value.chars().anyMatch(ch -> ch < 32))
            throw new IllegalArgumentException("Invalid " + field);
        return value;
    }
    static Properties configuration(JsonObject json) {
        Properties p = new Properties();
        p.setProperty("enabled", "true");
        p.setProperty("auth.mode", "discord");
        p.setProperty("bind", text(json, "bind", 64));
        p.setProperty("origin", text(json, "origin", 256));
        p.setProperty("port", String.valueOf(json.get("port").getAsInt()));
        p.setProperty("discord.client-id", text(json, "clientId", 20));
        p.setProperty("discord.guild-id", text(json, "guildId", 20));
        p.setProperty("discord.client-secret", text(json, "clientSecret", 256));
        JsonArray ranks = json.getAsJsonArray("ranks");
        if (ranks == null || ranks.isEmpty() || ranks.size() > 30) throw new IllegalArgumentException("Provide 1–30 ranks");
        List<String> order = new ArrayList<>();
        for (JsonElement entry : ranks) {
            JsonObject rank = entry.getAsJsonObject();
            String name = text(rank, "name", 32), id = text(rank, "roleId", 20), access = text(rank, "access", 16);
            if (!name.matches("[a-z][a-z0-9-]{0,31}") || order.contains(name))
                throw new IllegalArgumentException("Invalid or duplicate rank: " + name);
            if (!Set.of("admin", "moderator", "viewer", "deny").contains(access))
                throw new IllegalArgumentException("Invalid access for " + name);
            order.add(name);
            p.setProperty("discord.rank." + name + ".role-id", id);
            p.setProperty("discord.rank." + name + ".access", access);
        }
        p.setProperty("discord.rank-order", String.join(",", order));
        // Validate the generated config using the same production rules.
        String bind = p.getProperty("bind");
        if (!Set.of("127.0.0.1", "::1", "localhost").contains(bind))
            throw new IllegalArgumentException("Keep the panel bound to localhost behind your reverse proxy");
        int port = Integer.parseInt(p.getProperty("port"));
        if (port < 1 || port > 65535) throw new IllegalArgumentException("Invalid port");
        URI origin = URI.create(p.getProperty("origin"));
        if (!Set.of("http", "https").contains(origin.getScheme()) || origin.getHost() == null ||
            origin.getRawUserInfo() != null || origin.getQuery() != null || origin.getFragment() != null ||
            !origin.getPath().isEmpty()) throw new IllegalArgumentException("Invalid origin");
        if (!origin.getScheme().equals("https") && !Set.of("localhost", "127.0.0.1", "::1").contains(origin.getHost()))
            throw new IllegalArgumentException("Use HTTPS for a public origin");
        DiscordSettings.load(p);
        return p;
    }
    private void bytes(HttpExchange x, int status, String type, byte[] b) throws Exception {
        x.getResponseHeaders().set("Content-Type", type + "; charset=utf-8");
        x.sendResponseHeaders(status, b.length);
        x.getResponseBody().write(b);
    }
    private void failure(HttpExchange x, int status, String reason) {
        try {
            JsonObject result = new JsonObject(); result.addProperty("error", reason);
            bytes(x, status, "application/json", result.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {}
    }
    private static final class SetupFailure extends RuntimeException {
        final int status;
        SetupFailure(int status, String reason) { super(reason); this.status = status; }
    }
}
