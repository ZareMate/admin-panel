package com.zaremate.admin_panel;

import com.google.gson.*;
import com.zaremate.admin_gui.AdminGuiData;
import net.minecraft.server.MinecraftServer;
import net.neoforged.fml.ModList;
import java.util.*;
import java.util.concurrent.*;

final class MinecraftBackend implements Backend {
    private final MinecraftServer server;
    private final ItemIcons icons = new ItemIcons(ModAssets::read);
    public JsonObject icons(JsonArray ids) { return icons.batch(ids); }
    MinecraftBackend(MinecraftServer server) { this.server = server; }
    private <T> T onServer(Callable<T> work) throws Exception {
        FutureTask<T> task = new FutureTask<>(work);
        server.execute(task);
        try { return task.get(15, TimeUnit.SECONDS); }
        catch (TimeoutException e) { task.cancel(false); throw new PanelServer.Failure(503, "Game server timed out. Execution may have started; inspect the player and audit trail before retrying."); }
        catch (ExecutionException e) { if (e.getCause() instanceof Exception cause) throw cause; throw e; }
    }
    public JsonObject players() throws Exception {
        return onServer(() -> {
            JsonObject r = JsonParser.parseString(AdminGuiData.buildPlayerList(server)).getAsJsonObject();
            r.addProperty("maxPlayers", server.getMaxPlayers());
            r.addProperty("version", server.getServerVersion());
            r.addProperty("punishAvailable", ModList.get().isLoaded("punish"));
            r.addProperty("updatedAt", System.currentTimeMillis());
            return r;
        });
    }
    public JsonObject player(UUID id, Auth.User viewer) throws Exception { return onServer(() -> {
        JsonObject result = detail(id, viewer); result.add("storage", InventoryData.read(server, id)); return result;
    }); }
    private JsonObject detail(UUID id, Auth.User viewer) {
        JsonObject r = JsonParser.parseString(AdminGuiData.buildPlayerDetail(server, id, viewer.uuid())).getAsJsonObject();
        if (ModList.get().isLoaded("punish")) r.add("cases", PunishBridge.history(server, id));
        else r.add("cases", new JsonArray());
        return r;
    }
    public JsonElement mutate(UUID id, Auth.User actor, String action, JsonObject b) throws Exception {
        return onServer(() -> {
            if (!actor.canModerate()) throw new PanelServer.Failure(403, "Moderator role required");
            JsonObject player = detail(id, actor);
            if (action.equals("punish") || action.equals("revoke")) {
                if (player.get("name").getAsString().equals(id.toString())) throw new IllegalArgumentException("Unknown player: choose a known server profile");
                if (!ModList.get().isLoaded("punish")) throw new PanelServer.Failure(409, "Punish mod is not installed");
                return PunishBridge.mutate(server, id, player.get("name").getAsString(), actor, action, b);
            }
            if (!player.get("notesAvailable").getAsBoolean()) throw new PanelServer.Failure(409, "Admin Notes mod is not installed");
            if (action.equals("note-add")) AdminGuiData.addNote(id, actor.uuid(), actor.name(), PanelServer.string(b, "text", 4000));
            else {
                UUID note = UUID.fromString(PanelServer.string(b, "noteId", 36));
                boolean owned = false;
                for (JsonElement e : player.getAsJsonArray("notes")) {
                    JsonObject n = e.getAsJsonObject();
                    if (n.get("id").getAsString().equals(note.toString()) && n.get("canEdit").getAsBoolean()) owned = true;
                }
                if (!owned) throw new PanelServer.Failure(403, "Only the author can change a non-system note");
                if (action.equals("note-edit")) AdminGuiData.editNote(id, note, PanelServer.string(b, "text", 4000));
                else if (action.equals("note-remove")) AdminGuiData.removeNote(id, note);
                else throw new IllegalArgumentException("Unknown action");
            }
            JsonObject result = new JsonObject(); result.addProperty("status", "saved"); return result;
        });
    }
}
