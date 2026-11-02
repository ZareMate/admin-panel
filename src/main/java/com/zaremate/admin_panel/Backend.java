package com.zaremate.admin_panel;
import com.google.gson.*;
import java.util.UUID;
interface Backend {
    default JsonObject tsaNames(StaffActor actor, JsonArray hashes) throws Exception {
        throw new BridgeFailure(409, "TSA filename lookup is unavailable");
    }
    default JsonObject tsaUnlisted(StaffActor actor) throws Exception {
        throw new BridgeFailure(409, "TSA inventories are unavailable");
    }
    default JsonObject tsaLists(StaffActor actor, JsonObject update) throws Exception {
        throw new BridgeFailure(409, "TSA list API is unavailable");
    }
    default JsonObject tsaSettings(StaffActor actor, JsonObject update) throws Exception {
        throw new BridgeFailure(409, "TSA settings API is unavailable");
    }
    JsonObject players() throws Exception;
    JsonObject player(UUID id, StaffActor viewer) throws Exception;
    JsonElement mutate(UUID id, StaffActor actor, String action, JsonObject body) throws Exception;
}
