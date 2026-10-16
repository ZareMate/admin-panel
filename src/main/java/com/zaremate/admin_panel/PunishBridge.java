package com.zaremate.admin_panel;

import com.google.gson.*;
import com.mojang.authlib.GameProfile;
import com.zaremate.punish.*;
import com.zaremate.punish.api.*;
import net.minecraft.server.MinecraftServer;
import java.util.*;

/** Loaded only when Punish is present. Never dispatches arbitrary console commands. */
final class PunishBridge {
    static JsonArray history(MinecraftServer server, UUID id) {
        JsonArray a = new JsonArray();
        PunishMod.service(server.getServerDirectory()).db().records().stream()
                .filter(r -> id.toString().equals(r.uuid)).sorted(Comparator.comparingLong((com.zaremate.punish.data.PunishmentRecord r) -> r.at).reversed())
                .forEach(r -> { JsonObject row = r.toJson(); row.remove("ip"); row.remove("seenAccounts"); a.add(row); });
        return a;
    }
    static JsonElement mutate(MinecraftServer server, UUID id, String name, Auth.User actor, String action, JsonObject b) {
        var service = PunishMod.service(server.getServerDirectory());
        ModerationRequest request = ModerationRequest.parse(actor, action, b, server.getPlayerList().getPlayer(id) != null,
                service.offenses().stream().map(o -> o.id()).collect(java.util.stream.Collectors.toSet()));
        String reason = request.reason();
        JsonObject result = new JsonObject();
        if (action.equals("revoke")) {
            if (!actor.isAdmin()) throw new PanelServer.Failure(403, "Administrator role required");
            long caseId = request.caseId();
            boolean exists = service.db().records().stream().anyMatch(r -> id.toString().equals(r.uuid) && r.caseId == caseId && r.offense != null && r.removedBy == null);
            if (!exists) throw new PanelServer.Failure(409, "Offense case is missing or already removed");
            var online = server.getPlayerList().getPlayer(id);
            var target = new PunishService.Target(name, id.toString(), null, new GameProfile(id, name), online);
            int count = service.removeOffense(server, target, caseId, new net.minecraft.commands.CommandSourceStack(server, net.minecraft.world.phys.Vec3.ZERO, net.minecraft.world.phys.Vec2.ZERO, server.overworld(), 4, actor.name(), net.minecraft.network.chat.Component.literal(actor.name()), server, null));
            result.addProperty("removed", count); result.addProperty("reason", reason); return result;
        }
        String type = request.type();
        boolean silent = request.silent();
        if (type.equals("OFFENSE")) {
            String offense = request.offense();
            var applied = PunishApi.addPunishment(server, id, name, offense, "Web review: " + reason, actor.name(), silent);
            result.addProperty("records", applied.size());
        } else {
            PunishmentType kind = PunishmentType.valueOf(type);
            var record = PunishApi.addPunishment(server, id, name, kind, false, null, request.durationMillis(), reason, actor.name(), silent);
            result.addProperty("id", record.id());
        }
        result.addProperty("status", "applied"); return result;
    }
}
