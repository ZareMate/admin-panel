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
        for (String type : List.of("WARN", "KICK", "MUTE", "BAN", "OFFENSE")) {
            var scoped = new Auth.User("staff", "viewer", UUID.randomUUID(), "", "custom", Set.of("tab.players", "tab.cases", "punish." + type.toLowerCase(Locale.ROOT)));
            ModerationRequest.parse(scoped, "punish", body(type), true, Set.of("xray")); checks++;
            for(String other:List.of("WARN","KICK","MUTE","BAN","OFFENSE"))if(!other.equals(type)){
                rejected(()->ModerationRequest.parse(scoped,"punish",body(other),true,Set.of("xray")),"ungranted type");checks++;
            }
        }
        var remover = new Auth.User("staff", "viewer", UUID.randomUUID(), "", "custom", Set.of("tab.players", "tab.cases", "punish.remove"));
        JsonObject removal=body("WARN");removal.addProperty("recordId",42);
        if(ModerationRequest.parse(remover,"remove-punishment",removal,false,Set.of()).caseId()!=42)throw new AssertionError("record ID");checks++;
        rejected(()->ModerationRequest.parse(remover,"revoke",revoke,true,Set.of()),"removal does not grant offense revocation");checks++;
        for(String value:List.of("0","-1","1.5","9007199254740992","null","true","\"42\"")){
            removal.add("recordId",JsonParser.parseString(value));rejected(()->ModerationRequest.parse(remover,"remove-punishment",removal,false,Set.of()),"invalid record ID");checks++;
        }
        var noGrants=new Auth.User("owner","admin",UUID.randomUUID(),"","owner",Set.of());
        rejected(()->ModerationRequest.parse(noGrants,"punish",body("WARN"),true,Set.of()),"rank name cannot grant access");checks++;
        rejected(()->Permissions.parse(null),"missing permissions");checks++;
        rejected(()->Permissions.parse(JsonParser.parseString("[\"*\"]").getAsJsonArray()),"wildcard permissions");checks++;
        JsonObject raw=JsonParser.parseString("{\"uuid\":\"player\",\"name\":\"name\",\"notes\":[],\"cases\":[],\"tsa\":{},\"secret\":true,\"storage\":{\"inventory\":{},\"enderChest\":{},\"curios\":{},\"source\":\"live\"}}").getAsJsonObject();
        var inventory=new Auth.User("staff","admin",UUID.randomUUID(),"","owner",Set.of("tab.players","tab.inventory"));
        JsonObject filtered=Permissions.detail(raw,inventory);
        if(!filtered.keySet().equals(Set.of("uuid","name","storage"))||!filtered.getAsJsonObject("storage").keySet().equals(Set.of("inventory","source")))throw new AssertionError("tab data redaction");checks++;
        return checks;
    }
    private static JsonObject body(String type) { return JsonParser.parseString("{\"type\":\""+type+"\",\"reason\":\"Reviewed evidence\",\"durationMinutes\":60,\"offense\":\"xray\",\"silent\":false}").getAsJsonObject(); }
    private static void rejected(Runnable action,String label) { try {action.run();} catch(IllegalArgumentException | PanelServer.Failure expected){return;}throw new AssertionError("Accepted " + label); }
}
