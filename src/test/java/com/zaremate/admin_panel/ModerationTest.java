package com.zaremate.admin_panel;

import com.google.gson.*;
import java.util.*;

final class ModerationTest {
    static int run() {
        int checks = 0;
        for (String role : List.of("viewer", "moderator", "admin")) {
            var user = new Auth.User(role, role, UUID.randomUUID(), "");
            for (String type : List.of("WARN", "KICK", "MUTE", "BAN", "OFFENSE")) {
                JsonObject b = body(type);
                boolean allowed = !role.equals("viewer") && (role.equals("admin") || !Set.of("BAN", "OFFENSE").contains(type));
                try { ModerationRequest.parse(user, "punish", b, true, Set.of("xray")); if (!allowed) throw new AssertionError(role + " accepted " + type); }
                catch (PanelServer.Failure e) { if (allowed || e.status != 403) throw new AssertionError(role + " rejected " + type, e); }
                checks++;
            }
        }
        var admin = new Auth.User("admin", "admin", UUID.randomUUID(), "");
        for (String json : List.of("-1", "5256001", "1.5", "1e100", "null", "true", "\"60\"", "{}", "[]")) {
            JsonObject b = body("BAN"); b.add("durationMinutes", JsonParser.parseString(json));
            rejected(() -> ModerationRequest.parse(admin,"punish",b,true,Set.of()), "duration " + json); checks++;
        }
        for (long minutes : List.of(0L, 1L, 5_256_000L)) {
            JsonObject b = body("BAN"); b.addProperty("durationMinutes", minutes);
            if (ModerationRequest.parse(admin,"punish",b,true,Set.of()).durationMillis()!=minutes*60000L) throw new AssertionError("duration conversion"); checks++;
        }
        for (String reason : List.of("", "   ", "x".repeat(1001), "bad\u0000reason")) {
            JsonObject b=body("MUTE");b.addProperty("reason",reason);
            rejected(()->ModerationRequest.parse(admin,"punish",b,true,Set.of()),"invalid reason");checks++;
        }
        JsonObject offense=body("OFFENSE");offense.addProperty("reason","evidence -s hidden");
        rejected(()->ModerationRequest.parse(admin,"punish",offense,true,Set.of("xray")),"silent flag injection");checks++;
        rejected(()->ModerationRequest.parse(admin,"punish",body("OFFENSE"),true,Set.of()),"unknown offense");checks++;
        rejected(()->ModerationRequest.parse(admin,"punish",body("KICK"),false,Set.of()),"offline kick");checks++;
        JsonObject silent=body("WARN");silent.addProperty("silent","true");
        rejected(()->ModerationRequest.parse(admin,"punish",silent,true,Set.of()),"string boolean");checks++;
        JsonObject revoke=body("BAN");revoke.addProperty("caseId",0);
        rejected(()->ModerationRequest.parse(admin,"revoke",revoke,true,Set.of()),"zero case id");checks++;
        revoke.addProperty("caseId",42);
        if(ModerationRequest.parse(admin,"revoke",revoke,true,Set.of()).caseId()!=42)throw new AssertionError("case ID");checks++;
        return checks;
    }
    private static JsonObject body(String type) { return JsonParser.parseString("{\"type\":\""+type+"\",\"reason\":\"Reviewed evidence\",\"durationMinutes\":60,\"offense\":\"xray\",\"silent\":false}").getAsJsonObject(); }
    private static void rejected(Runnable action,String label) { try {action.run();} catch(IllegalArgumentException | PanelServer.Failure expected){return;}throw new AssertionError("Accepted " + label); }
}
