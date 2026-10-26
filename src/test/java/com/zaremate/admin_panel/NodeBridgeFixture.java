package com.zaremate.admin_panel;

import com.google.gson.*;
import java.net.URI;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;

/** Test-only game backend for real Java WebSocket -> Node/Fastify interoperability. */
public final class NodeBridgeFixture {
    public static void main(String[] args) throws Exception {
        String large = System.getenv("TEST_LARGE_BRIDGE") == null ? null : "😀漢字" + "x".repeat(9*1024*1024);
        Backend backend = new Backend() {
            private int mutations;
            public JsonObject players() {
                JsonObject result = new JsonObject(); result.add("players", new JsonArray());
                result.addProperty("updatedAt", System.currentTimeMillis());
                if(large!=null)result.addProperty("large",large);
                result.addProperty("javaBridge", true); result.addProperty("mutations", mutations); return result;
            }
            public JsonObject player(UUID id, StaffActor user) {
                JsonObject result = new JsonObject(); result.addProperty("uuid", id.toString());
                result.addProperty("mutations", mutations); result.addProperty("capturedAt", System.currentTimeMillis());
                JsonObject notes = new JsonObject(); if(large!=null)notes.addProperty("text",large); notes.addProperty("viewer", user.uuid().toString()); notes.addProperty("rank", user.rank()); notes.addProperty("mutations", mutations); JsonArray list = new JsonArray(); list.add(notes); result.add("notes", list); return result;
            }
            public JsonElement mutate(UUID id, StaffActor user, String action, JsonObject body) {
                if (action.equals("punish") || action.equals("revoke") || action.equals("remove-punishment")) ModerationRequest.parse(user, action, body, true, java.util.Set.of("xray"));
                JsonObject result = new JsonObject(); result.addProperty("mutations", ++mutations);
                result.addProperty("action", action); return result;
            }
        };
        BridgeClient bridge = new BridgeClient(new BridgeConfig(URI.create(args[0]), System.getenv("TEST_BRIDGE_TOKEN")), backend);
        Runtime.getRuntime().addShutdownHook(new Thread(bridge::close)); bridge.start();
        new CountDownLatch(1).await();
    }
}
