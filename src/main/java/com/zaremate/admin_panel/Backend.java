package com.zaremate.admin_panel;
import com.google.gson.*;
import java.util.UUID;
interface Backend {
    JsonObject players() throws Exception;
    JsonObject player(UUID id, StaffActor viewer) throws Exception;
    JsonElement mutate(UUID id, StaffActor actor, String action, JsonObject body) throws Exception;
}
