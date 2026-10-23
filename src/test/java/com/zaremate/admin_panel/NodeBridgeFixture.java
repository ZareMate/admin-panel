package com.zaremate.admin_panel;

import com.google.gson.*;
import java.net.URI;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;

/** Test-only game backend for real Java WebSocket -> Node/Fastify interoperability. */
public final class NodeBridgeFixture {
    public static void main(String[] args) throws Exception {
        Backend backend = new Backend() {
            private int mutations;
            public JsonObject players() {
                JsonObject result = new JsonObject(); result.add("players", new JsonArray());
                result.addProperty("javaBridge", true); result.addProperty("mutations", mutations); return result;
            }
            public JsonObject player(UUID id, Auth.User user) {
                JsonObject result = new JsonObject(); result.addProperty("uuid", id.toString());
                result.addProperty("viewer", user.uuid().toString()); result.addProperty("rank", user.rank()); return result;
            }
            public JsonElement mutate(UUID id, Auth.User user, String action, JsonObject body) {
                if (action.equals("punish") || action.equals("revoke")) ModerationRequest.parse(user, action, body, true, java.util.Set.of("xray"));
                JsonObject result = new JsonObject(); result.addProperty("mutations", ++mutations);
                result.addProperty("action", action); return result;
            }
        };
        BridgeClient bridge = new BridgeClient(new BridgeConfig(URI.create(args[0]), System.getenv("TEST_BRIDGE_TOKEN")), backend);
        Runtime.getRuntime().addShutdownHook(new Thread(bridge::close)); bridge.start();
        new CountDownLatch(1).await();
    }
}
