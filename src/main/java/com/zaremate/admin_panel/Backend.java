package com.zaremate.admin_panel;
import com.google.gson.*;
import java.util.UUID;
interface Backend {
    default JsonObject icons(JsonArray ids) throws Exception { return new JsonObject(); }
    JsonObject players() throws Exception;
    JsonObject player(UUID id, Auth.User viewer) throws Exception;
    JsonElement mutate(UUID id, Auth.User actor, String action, JsonObject body) throws Exception;
}
