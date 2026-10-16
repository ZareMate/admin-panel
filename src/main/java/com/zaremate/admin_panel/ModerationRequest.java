package com.zaremate.admin_panel;

import com.google.gson.*;
import java.util.*;

/** Validates moderation input before touching the game or its persistence layer. */
record ModerationRequest(String type, String reason, String offense, long durationMillis, boolean silent, long caseId) {
    static ModerationRequest parse(Auth.User actor, String action, JsonObject body, boolean online, Set<String> offenses) {
        if (!actor.canModerate()) throw new PanelServer.Failure(403, "Moderator role required");
        String reason = PanelServer.string(body, "reason", 1000).trim();
        if (action.equals("revoke")) {
            if (!actor.isAdmin()) throw new PanelServer.Failure(403, "Administrator role required");
            long id = integer(body, "caseId", 1, Long.MAX_VALUE);
            return new ModerationRequest("REVOKE", reason, "", 0, false, id);
        }
        if (!action.equals("punish")) throw new IllegalArgumentException("Unknown moderation action");
        String type = PanelServer.string(body, "type", 16);
        if (!Set.of("WARN", "KICK", "MUTE", "BAN", "OFFENSE").contains(type)) throw new IllegalArgumentException("Unknown punishment type");
        if (Set.of("BAN", "OFFENSE").contains(type) && !actor.isAdmin()) throw new PanelServer.Failure(403, "Administrator role required");
        boolean silent = false;
        if (body.has("silent")) {
            if (!body.get("silent").isJsonPrimitive() || !body.getAsJsonPrimitive("silent").isBoolean()) throw new IllegalArgumentException("silent must be a boolean");
            silent = body.get("silent").getAsBoolean();
        }
        if (type.equals("OFFENSE")) {
            String offense = PanelServer.string(body, "offense", 100);
            if (!offenses.contains(offense)) throw new IllegalArgumentException("Unknown configured offense");
            if (Arrays.asList(reason.split("\\s+")).contains("-s")) throw new IllegalArgumentException("Use the Silent checkbox instead of -s in the reason");
            return new ModerationRequest(type, reason, offense, 0, silent, 0);
        }
        if (type.equals("KICK") && !online) throw new PanelServer.Failure(409, "Player must be online to kick");
        long minutes = integer(body, "durationMinutes", 0, 5_256_000);
        return new ModerationRequest(type, reason, "", Set.of("WARN", "KICK").contains(type) ? 0 : minutes * 60_000L, silent, 0);
    }
    private static long integer(JsonObject body, String key, long min, long max) {
        try {
            JsonElement value = body.get(key);
            if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) throw new ArithmeticException();
            long number = value.getAsBigDecimal().longValueExact();
            if (number < min || number > max) throw new ArithmeticException();
            return number;
        } catch (ArithmeticException | NumberFormatException e) { throw new IllegalArgumentException(key + " must be an integer from " + min + " to " + max); }
    }
}
