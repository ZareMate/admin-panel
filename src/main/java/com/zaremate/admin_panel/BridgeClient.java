package com.zaremate.admin_panel;

import com.google.gson.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.logging.Logger;

/** Outbound connection only. Requests are never replayed after reconnect. */
final class BridgeClient implements AutoCloseable {
    private final BridgeConfig config;
    private final Backend backend;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ScheduledExecutorService reconnect = Executors.newSingleThreadScheduledExecutor();
    private final ExecutorService worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(32), new ThreadPoolExecutor.AbortPolicy());
    private final Map<String, Watch> watches = new HashMap<>();
    private final java.util.concurrent.atomic.AtomicBoolean sampling = new java.util.concurrent.atomic.AtomicBoolean();
    private record Watch(String operation, UUID player, Auth.User actor, String previous) {}
    private volatile boolean closed;
    private volatile WebSocket socket;
    private volatile Listener listener;
    BridgeClient(BridgeConfig config, Backend backend) { this.config = config; this.backend = backend; }
    void start() {
        reconnect.execute(this::connect);
        reconnect.scheduleWithFixedDelay(() -> {
            if (closed || socket == null || !sampling.compareAndSet(false, true)) return;
            try { worker.execute(() -> { try { publish(); } finally { sampling.set(false); } }); }
            catch (RejectedExecutionException busy) { sampling.set(false); }
        }, 0, 1, TimeUnit.SECONDS);
    }
    private void connect() {
        if (closed) return;
        http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(10))
            .header("Authorization", "Bearer " + config.token()).buildAsync(config.url(), new Listener())
            .whenComplete((ws, error) -> { if (error != null) retry(); });
    }
    private void retry() {
        if (!closed) {
            Logger.getLogger("admin_panel").info("Panel bridge disconnected; retrying in 5 seconds");
            try { reconnect.schedule(this::connect, 5, TimeUnit.SECONDS); } catch (RejectedExecutionException ignored) {}
        }
    }
    private final class Listener implements WebSocket.Listener {
        private final StringBuilder text = new StringBuilder();
        private boolean ended;
        public void onOpen(WebSocket ws) {
            if (closed) { ws.abort(); return; }
            listener = this; socket = ws;
            worker.execute(watches::clear); ws.request(1);
            Logger.getLogger("admin_panel").info("Panel bridge connected");
        }
        public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            if (text.length() + data.length() > 65536) { ws.abort(); end(ws); return null; }
            text.append(data);
            if (last) {
                String request = text.toString(); text.setLength(0);
                try { worker.execute(() -> respond(ws, request)); }
                catch (RejectedExecutionException busy) { ws.abort(); end(ws); }
            }
            ws.request(1); return null;
        }
        public CompletionStage<?> onClose(WebSocket ws, int status, String reason) { end(ws); return null; }
        public void onError(WebSocket ws, Throwable error) { end(ws); }
        private synchronized void end(WebSocket ws) {
            if (ended) return; ended = true;
            if (socket == ws) socket = null;
            retry();
        }
    }
    private void respond(WebSocket ws, String text) {
        if (closed || socket != ws || ws.isOutputClosed()) return;
        JsonObject response = new JsonObject();
        try {
            JsonObject request = JsonParser.parseString(text).getAsJsonObject();
            response.addProperty("id", request.get("id").getAsString());
            if (request.get("version").getAsInt() != 1) throw new IllegalArgumentException("Unsupported bridge protocol");
            if (request.get("deadline").getAsLong() < System.currentTimeMillis()) throw new PanelServer.Failure(504, "Request expired before execution");
            String operation = request.get("operation").getAsString();
            JsonElement result;
            if (operation.equals("unwatch")) {
                watches.remove(request.get("watchId").getAsString()); result = new JsonObject();
            } else if (operation.equals("watch")) {
                String key = PanelServer.string(request, "watchId", 80);
                if (!watches.containsKey(key) && watches.size() >= 32) throw new PanelServer.Failure(503, "Live subscription capacity reached");
                boolean list = request.get("target").getAsString().equals("players");
                watches.put(key, new Watch(list ? "players" : "player", list ? null : UUID.fromString(request.get("player").getAsString()), list ? null : actor(request.getAsJsonObject("actor")), null));
                result = new JsonObject();
            } else if (operation.equals("players")) result = backend.players();
            else {
                UUID id = UUID.fromString(request.get("player").getAsString());
                Auth.User user = actor(request.getAsJsonObject("actor"));
                if (operation.equals("player")) result = backend.player(id, user);
                else if (operation.equals("mutate")) {
                    String action = request.get("action").getAsString();
                    JsonObject body = request.getAsJsonObject("body");
                    if (!Set.of("punish", "revoke", "note-add", "note-edit", "note-remove").contains(action)) throw new IllegalArgumentException("Unknown action");
                    if (!user.canModerate()) throw new PanelServer.Failure(403, "Moderator role required");
                    if ((action.equals("revoke") || action.equals("punish") && (!body.has("type")
                            || !Set.of("WARN", "KICK", "MUTE").contains(body.get("type").getAsString())))
                            && !user.isAdmin()) throw new PanelServer.Failure(403, "Administrator role required");
                    result = backend.mutate(id, user, action, body);
                } else throw new IllegalArgumentException("Unknown operation");
            }
            response.add("result", result);
        } catch (Exception error) {
            response.addProperty("status", error instanceof PanelServer.Failure f ? f.status : error instanceof IllegalArgumentException ? 400 : 500);
            response.addProperty("error", error.getMessage() == null ? "Game request failed" : error.getMessage());
        }
        String message = response.toString();
        if (message.length() > 8 * 1024 * 1024) {
            response.remove("result"); response.addProperty("status", 413); response.addProperty("error", "Game response exceeds bridge limit");
            message = response.toString();
        }
        try { ws.sendText(message, true).get(10, TimeUnit.SECONDS); }
        catch (Exception failure) { ws.abort(); Listener active = listener; if (active != null && socket == ws) active.end(ws); }
    }
    private static Auth.User actor(JsonObject actor) {
        String role = actor.get("role").getAsString();
        if (!Set.of("viewer", "moderator", "admin").contains(role)) throw new IllegalArgumentException("Invalid staff role");
        return new Auth.User(actor.get("name").getAsString(), role, UUID.fromString(actor.get("uuid").getAsString()), "", actor.get("rank").getAsString());
    }
    // Volatile capture timestamps alone must not generate another full snapshot.
    private static void normalize(JsonElement value) {
        if (value.isJsonObject()) {
            value.getAsJsonObject().remove("updatedAt"); value.getAsJsonObject().remove("capturedAt");
            value.getAsJsonObject().entrySet().forEach(e -> normalize(e.getValue()));
        } else if (value.isJsonArray()) value.getAsJsonArray().forEach(BridgeClient::normalize);
    }
    private void publish() {
        WebSocket ws = socket;
        if (ws == null || closed) return;
        for (var entry : watches.entrySet()) {
            if (ws != socket || closed) return;
            Watch watch = entry.getValue();
            JsonObject event = new JsonObject(); event.addProperty("event", "snapshot"); event.addProperty("watchId", entry.getKey());
            try {
                JsonObject data = watch.operation().equals("players") ? backend.players() : backend.player(watch.player(), watch.actor());
                JsonObject comparable = data.deepCopy(); normalize(comparable);
                String fingerprint = comparable.toString();
                if (fingerprint.equals(watch.previous())) continue;
                event.add("data", data);
                String message = event.toString();
                if (message.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 8 * 1024 * 1024) throw new IllegalArgumentException("Live snapshot exceeds bridge limit");
                ws.sendText(message, true).get(10, TimeUnit.SECONDS);
                entry.setValue(new Watch(watch.operation(), watch.player(), watch.actor(), fingerprint));
            } catch (Exception error) {
                event.remove("data"); event.addProperty("error", "Live snapshot unavailable; refresh to retry");
                try { ws.sendText(event.toString(), true).get(10, TimeUnit.SECONDS); }
                catch (Exception disconnected) { ws.abort(); Listener active = listener; if (active != null && socket == ws) active.end(ws); return; }
            }
        }
    }
    public void close() {
        closed = true; reconnect.shutdownNow();
        WebSocket ws = socket; socket = null; if (ws != null) ws.abort();
        worker.shutdownNow(); http.shutdownNow();
    }
}
