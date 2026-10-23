package com.zaremate.admin_panel;

import com.google.gson.*;
import com.zaremate.admin_gui.AdminGuiData;
import net.minecraft.server.MinecraftServer;
import net.minecraft.nbt.*;
import net.minecraft.stats.Stats;
import net.minecraft.world.level.storage.LevelResource;
import java.nio.file.*;
import net.neoforged.fml.ModList;
import java.util.*;
import java.util.concurrent.*;

final class MinecraftBackend implements Backend {
    private final MinecraftServer server;
    MinecraftBackend(MinecraftServer server) { this.server = server; }
    private <T> T onServer(Callable<T> work) throws Exception {
        FutureTask<T> task = new FutureTask<>(work);
        server.execute(task);
        try { return task.get(15, TimeUnit.SECONDS); }
        catch (TimeoutException e) { task.cancel(false); throw new PanelServer.Failure(503, "Game server timed out. Execution may have started; inspect the player and audit trail before retrying."); }
        catch (ExecutionException e) { if (e.getCause() instanceof Exception cause) throw cause; throw e; }
    }
    // Only inspect security records; avoid building full player profiles on each poll.
    private static boolean hasDetection(UUID id) {
        return detectedRecord("com.zaremate.tsa_anticheat.api.TsaAnticheatAPI", "getPlayer", id, true)
            || detectedRecord("com.zaremate.airport_security_system.AirportSecuritySystemAPI", "getPlayerOffense", id, false);
    }
    private static boolean detectedRecord(String api, String method, UUID id, boolean tsa) {
        try {
            Object optional = Class.forName(api).getMethod(method, UUID.class).invoke(null, id);
            if (!(optional instanceof Optional<?> result) || result.isEmpty()) return false;
            Object record = result.get();
            if (tsa) {
                Object detections = record.getClass().getMethod("detections").invoke(record);
                if (detections instanceof Collection<?> found && !found.isEmpty()) return true;
                Object count = record.getClass().getMethod("packetModified").invoke(record);
                return count instanceof Number number && number.longValue() > 0;
            }
            Object count = record.getClass().getMethod("detectedChecks").invoke(record);
            return count instanceof Number number && number.longValue() > 0;
        } catch (ReflectiveOperationException | LinkageError ignored) {
            // Optional integrations may not be installed.
            return false;
        }
    }
    public JsonObject players() throws Exception {
        return onServer(() -> {
            JsonObject r = JsonParser.parseString(AdminGuiData.buildPlayerList(server)).getAsJsonObject();
            for (JsonElement entry : r.getAsJsonArray("players")) {
                JsonObject player = entry.getAsJsonObject();
                player.addProperty("hasDetections", hasDetection(UUID.fromString(player.get("uuid").getAsString())));
            }
            r.addProperty("maxPlayers", server.getMaxPlayers());
            r.addProperty("version", server.getServerVersion());
            r.addProperty("punishAvailable", ModList.get().isLoaded("punish"));
            r.addProperty("updatedAt", System.currentTimeMillis());
            return r;
        });
    }
    public JsonObject player(UUID id, Auth.User viewer) throws Exception { return onServer(() -> {
        JsonObject result = detail(id, viewer); result.add("storage", InventoryData.read(server, id)); result.add("location", location(id));
        // Vanilla PLAY_TIME is stored in ticks and includes offline players.
        JsonObject playtime = new JsonObject();
        try {
            var online = server.getPlayerList().getPlayer(id);
            long ticks;
            if (online != null) {
                ticks = server.getPlayerList().getPlayerStats(online).getValue(Stats.CUSTOM.get(Stats.PLAY_TIME));
            } else {
                Path file = server.getWorldPath(LevelResource.ROOT).resolve("stats").resolve(id + ".json");
                JsonObject stats = JsonParser.parseString(Files.readString(file)).getAsJsonObject()
                        .getAsJsonObject("stats").getAsJsonObject("minecraft:custom");
                ticks = stats.get("minecraft:play_time").getAsLong();
            }
            playtime.addProperty("seconds", Math.max(0L, ticks / 20L));
            playtime.addProperty("available", true);
        } catch (Exception unavailable) {
            playtime.addProperty("available", false);
        }
        result.add("playtime", playtime);
        return Permissions.detail(result, viewer);
    }); }
    private JsonObject location(UUID id) {
        JsonObject out = new JsonObject();
        var online = server.getPlayerList().getPlayer(id);
        if (online != null) {
            out.addProperty("available", true);
            out.addProperty("source", "live");
            out.addProperty("dimension", online.level().dimension().location().toString());
            out.addProperty("x", online.getX());
            out.addProperty("y", online.getY());
            out.addProperty("z", online.getZ());
            out.addProperty("yaw", online.getYRot());
            return out;
        }
        Path file = server.getWorldPath(LevelResource.PLAYER_DATA_DIR).resolve(id + ".dat");
        if (Files.isRegularFile(file)) {
            try {
                CompoundTag tag = NbtIo.readCompressed(file, NbtAccounter.create(16 * 1024 * 1024));
                ListTag pos = tag.getList("Pos", Tag.TAG_DOUBLE);
                if (pos.size() == 3) {
                    out.addProperty("available", true);
                    out.addProperty("source", "saved");
                    out.addProperty("savedAt", Files.getLastModifiedTime(file).toMillis());
                    out.addProperty("dimension", tag.contains("Dimension", Tag.TAG_STRING) ? tag.getString("Dimension") : "Unknown");
                    out.addProperty("x", pos.getDouble(0));
                    out.addProperty("y", pos.getDouble(1));
                    out.addProperty("z", pos.getDouble(2));
                    return out;
                }
            } catch (Exception ignored) {
                // Saved position is optional; never fail the entire player profile.
            }
        }
        out.addProperty("available", false);
        return out;
    }
    private JsonObject detail(UUID id, Auth.User viewer) {
        JsonObject r = JsonParser.parseString(AdminGuiData.buildPlayerDetail(server, id, viewer.uuid())).getAsJsonObject();
        if (ModList.get().isLoaded("punish")) r.add("cases", PunishBridge.history(server, id));
        else r.add("cases", new JsonArray());
        return r;
    }
    public JsonElement mutate(UUID id, Auth.User actor, String action, JsonObject b) throws Exception {
        return onServer(() -> {
            Permissions.mutation(actor, action, b);
            JsonObject player = detail(id, actor);
            if (action.equals("punish") || action.equals("revoke") || action.equals("remove-punishment")) {
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
