package com.zaremate.admin_panel;

import com.google.gson.*;
import com.zaremate.admin_notes.AdminNotesAPI;
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
    private final KillFeedStore killFeed;
    private final ServerThread main;
    private final PanelData data;
    private final Path worldRoot;
    private final Path playerDirectory;
    private final MapPlayerPositions mapPositions=new MapPlayerPositions();
    MinecraftBackend(MinecraftServer server,KillFeedStore killFeed) {
        this.killFeed=killFeed;
        this.server = server;
        this.main = new ServerThread(server, server::isSameThread);
        this.worldRoot = server.getWorldPath(LevelResource.ROOT);
        this.playerDirectory = server.getWorldPath(LevelResource.PLAYER_DATA_DIR);
        this.data = new PanelData(main, server.getServerDirectory().resolve("usercache.json"),
                net.neoforged.fml.loading.FMLPaths.CONFIGDIR.get().resolve("tsa_anticheat"), playerDirectory);
    }
    private <T> T onServer(Callable<T> work) throws Exception { return main.call(work); }
    private void requireWorker() {
        if (server.isSameThread()) throw new IllegalStateException("Panel requests must run on the bridge worker");
        if (Thread.currentThread().isInterrupted()) throw new java.util.concurrent.CancellationException("Panel bridge stopped");
    }
    public JsonObject tsaNames(StaffActor actor, JsonArray hashes) throws Exception {
        requireWorker(); actor.require("tab.tsaConfig"); return TsaLists.names(hashes);
    }
    public JsonObject tsaUnlisted(StaffActor actor) throws Exception {
        requireWorker(); actor.require("tab.tsaConfig"); return TsaLists.unlisted();
    }
    public JsonObject tsaLists(StaffActor actor, JsonObject update) throws Exception {
        requireWorker(); actor.require("tab.tsaConfig");
        if (update != null) actor.require("tsa.lists.edit");
        return TsaLists.access(update);
    }
    public JsonObject tsaSettings(StaffActor actor, JsonObject update) throws Exception {
        requireWorker();
        actor.require("tab.tsaConfig");
        if (update != null) actor.require("tsa.configure");
        return TsaSettings.access(update);
    }
    public JsonObject killFeed(String query,int offset,int limit,UUID id,boolean inventory) throws Exception {
        requireWorker();
        try{return (id==null?killFeed.page(query,offset,limit):killFeed.detail(id,inventory)).get(15,TimeUnit.SECONDS);}
        catch(ExecutionException error){if(error.getCause() instanceof RuntimeException cause)throw cause;throw error;}
    }
    public JsonObject mapClaims(String dimension) throws Exception {
        requireWorker();
        return FtbMapClaims.json(onServer(() -> FtbMapClaims.capture(dimension)));
    }
    public JsonObject mapPlayers(boolean includeOffline) throws Exception {
        requireWorker();
        JsonObject snapshot=onServer(() -> {
            JsonArray captured=new JsonArray();
            for(var player:server.getPlayerList().getPlayers()) {
                JsonObject row=new JsonObject();
                row.addProperty("uuid",player.getUUID().toString());
                row.addProperty("name",player.getGameProfile().getName());
                row.addProperty("dimension",player.level().dimension().location().toString());
                row.addProperty("x",player.getX());row.addProperty("y",player.getY());row.addProperty("z",player.getZ());
                row.addProperty("online",true);captured.add(row);
            }
            JsonArray dimensions=new JsonArray();
            for(var level:server.getAllLevels())dimensions.add(level.dimension().location().toString());
            var overworld=server.overworld();var spawnPos=overworld.getSharedSpawnPos();
            JsonObject spawn=new JsonObject();spawn.addProperty("dimension",overworld.dimension().location().toString());
            spawn.addProperty("x",spawnPos.getX());spawn.addProperty("y",spawnPos.getY());spawn.addProperty("z",spawnPos.getZ());
            JsonObject capture=new JsonObject();capture.add("players",captured);capture.add("dimensions",dimensions);capture.add("spawn",spawn);return capture;
        });
        JsonArray players=snapshot.getAsJsonArray("players");
        long capturedAt=System.currentTimeMillis();
        if(includeOffline)players=mapPositions.withOffline(players,playerDirectory,server.getServerDirectory().resolve("usercache.json"));
        JsonObject result=new JsonObject();result.add("players",players);result.add("dimensions",snapshot.get("dimensions"));result.add("spawn",snapshot.get("spawn"));result.addProperty("updatedAt",capturedAt);return result;
    }
    public JsonObject statistics() throws Exception {
        requireWorker();
        return data.buildStatistics(server);
    }
    public JsonObject players() throws Exception {
        requireWorker();
        JsonObject result = data.buildPlayerList(server);
        result.addProperty("maxPlayers", onServer(server::getMaxPlayers));
        result.addProperty("version", onServer(server::getServerVersion));
        result.addProperty("punishAvailable", ModList.get().isLoaded("punish"));
        result.addProperty("updatedAt", System.currentTimeMillis());
        return result;
    }
    private record LivePlayer(JsonObject storage, JsonObject location, Long ticks) {}
    public JsonObject player(UUID id, StaffActor viewer) throws Exception {
        requireWorker();
        JsonObject result = detail(id, viewer);
        var nbt=new ItemNbtView.Capture();
        java.util.function.BiConsumer<JsonObject,net.minecraft.world.item.ItemStack> capture=
                viewer.has("tab.inventory")||viewer.has("tab.enderChest")||viewer.has("tab.curios")
                ?(view,stack)->nbt.item(view,stack,server.registryAccess()):null;
        LivePlayer live = onServer(() -> {
            var online = server.getPlayerList().getPlayer(id);
            if (online == null) return null;
            Long ticks = null;
            try { ticks = (long) server.getPlayerList().getPlayerStats(online).getValue(Stats.CUSTOM.get(Stats.PLAY_TIME)); }
            catch (RuntimeException ignored) {}
            return new LivePlayer(InventoryData.readLive(server, id,capture), location(id), ticks);
        });
        if (live != null) {
            result.add("storage", live.storage()); result.add("location", live.location());
            result.add("playtime", playtime(live.ticks()));
        } else {
            SavedPlayer saved = SavedPlayer.read(playerDirectory.resolve(id + ".dat"));
            result.add("storage", onServer(() -> InventoryData.readSaved(server, saved,capture)));
            result.add("location", savedLocation(saved));
            Long ticks = null;
            try (var reader = Files.newBufferedReader(worldRoot.resolve("stats").resolve(id + ".json"))) {
                ticks = JsonParser.parseReader(reader).getAsJsonObject().getAsJsonObject("stats")
                        .getAsJsonObject("minecraft:custom").get("minecraft:play_time").getAsLong();
            } catch (Exception ignored) {}
            result.add("playtime", playtime(ticks));
        }
        nbt.apply();return Permissions.detail(result, viewer);
    }
    private static JsonObject playtime(Long ticks) {
        JsonObject result = new JsonObject(); result.addProperty("available", ticks != null);
        if (ticks != null) result.addProperty("seconds", Math.max(0L, ticks / 20L));
        return result;
    }
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
        out.addProperty("available", false);
        return out;
    }
    private JsonObject savedLocation(SavedPlayer saved) {
        JsonObject out = new JsonObject();
        CompoundTag tag = saved.data();
        if (tag != null) {
            ListTag pos = tag.getList("Pos", Tag.TAG_DOUBLE);
            if (pos.size() == 3) {
                out.addProperty("available", true); out.addProperty("source", "saved");
                out.addProperty("savedAt", saved.savedAt());
                out.addProperty("dimension", tag.contains("Dimension", Tag.TAG_STRING) ? tag.getString("Dimension") : "Unknown");
                out.addProperty("x", pos.getDouble(0)); out.addProperty("y", pos.getDouble(1)); out.addProperty("z", pos.getDouble(2));
                return out;
            }
        }
        out.addProperty("available", false); return out;
    }
    private JsonObject detail(UUID id, StaffActor viewer) throws Exception {
        JsonObject r = JsonParser.parseString(data.buildPlayerDetail(server, id, viewer.uuid())).getAsJsonObject();
        if (ModList.get().isLoaded("punish")) {
            JsonArray snapshot = onServer(() -> PunishBridge.captureHistory(server, id));
            JsonArray cases = new JsonArray();
            java.util.stream.StreamSupport.stream(snapshot.spliterator(), false)
                    .sorted(Comparator.comparingLong((JsonElement row) -> row.getAsJsonObject().get("at").getAsLong()).reversed())
                    .forEach(cases::add);
            r.add("cases", cases);
        }
        else r.add("cases", new JsonArray());
        return r;
    }
    public JsonElement mutate(UUID id, StaffActor actor, String action, JsonObject b) throws Exception {
        requireWorker();
        Permissions.mutation(actor, action, b);
        return onServer(() -> {
            // Recheck ownership and target identity at execution time. Never load a full profile here.
            String name = server.getPlayerList().getPlayer(id) != null
                    ? server.getPlayerList().getPlayer(id).getGameProfile().getName()
                    : server.getProfileCache().get(id).map(com.mojang.authlib.GameProfile::getName).orElse(id.toString());
            if (action.equals("punish") || action.equals("revoke") || action.equals("remove-punishment")) {
                if (name.equals(id.toString())) throw new IllegalArgumentException("Unknown player: choose a known server profile");
                if (!ModList.get().isLoaded("punish")) throw new BridgeFailure(409, "Punish mod is not installed");
                return PunishBridge.mutate(server, id, name, actor, action, b);
            }
            if (!ModList.get().isLoaded("admin_notes")) throw new BridgeFailure(409, "Admin Notes mod is not installed");
            if (action.equals("note-add")) AdminNotesAPI.addNote(id, actor.uuid(), actor.name(), RequestFields.string(b, "text", 4000));
            else {
                UUID note = UUID.fromString(RequestFields.string(b, "noteId", 36));
                boolean owned = false;
                for (JsonElement e : data.noteSnapshot(id, actor.uuid())) {
                    JsonObject n = e.getAsJsonObject();
                    if (n.get("id").getAsString().equals(note.toString()) && n.get("canEdit").getAsBoolean()) owned = true;
                }
                if (!owned) throw new BridgeFailure(403, "Only the author can change a non-system note");
                if (action.equals("note-edit")) AdminNotesAPI.editNote(id, note, RequestFields.string(b, "text", 4000));
                else if (action.equals("note-remove")) AdminNotesAPI.removeNote(id, note);
                else throw new IllegalArgumentException("Unknown action");
            }
            JsonObject result = new JsonObject(); result.addProperty("status", "saved"); return result;
        });
    }
}
