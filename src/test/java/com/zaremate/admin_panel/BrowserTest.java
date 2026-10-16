package com.zaremate.admin_panel;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;

/** Serves the production web assets and HTTP layer with deterministic, test-only player data. */
public final class BrowserTest {
    public static void main(String[] args) throws Exception { runMode(false); runMode(true); }
    private static void runMode(boolean discordMode) throws Exception {
        Path dir = Files.createTempDirectory("panel-browser-");
        String hash = "00112233445566778899aabbccddeeff:" + Auth.hash("browser-test-password".toCharArray(), HexFormat.of().parseHex("00112233445566778899aabbccddeeff"));
        var users = Map.of("admin", new Auth.User("admin","admin",UUID.randomUUID(),hash), "viewer",new Auth.User("viewer","viewer",UUID.randomUUID(),hash));
        String id = "00000000-0000-0000-0000-000000000001";
        JsonObject player = JsonParser.parseString("""
            {"uuid":"00000000-0000-0000-0000-000000000001","name":"TestPlayer","online":true,
            "notesAvailable":true,"notes":[],"cases":[],"punish":{"available":true,"offenses":[{"id":"xray","name":"X-Ray","group":"Cheating","steps":["warn","ban"]}]},
            "tsa":{"available":true,"packetChecks":42,"detections":["<img src=x onerror=window.xss=true>"]},"ass":{},"teams":{},"discord":{},"clockin":{}}
            """).getAsJsonObject();
        JsonObject storage=JsonParser.parseString("""
            {"source":"live","capturedAt":1700000000000,
             "inventory":{"available":true,"groups":[{"name":"Hotbar","slots":[
               {"slot":0,"label":"Hotbar 1","empty":false,"id":"test:gem","name":"<img src=x onerror=window.xss=true>","count":12,"selected":true,"damage":5,"maxDamage":100,"enchantments":["Unbreaking 3"],"lore":["A gem"]},
               {"slot":1,"label":"Hotbar 2","empty":true},
               {"slot":2,"label":"Hotbar 3","empty":false,"id":"test:missing","name":"Custom item","count":1}]}]},
             "enderChest":{"available":true,"groups":[{"name":"Ender Chest","slots":[{"empty":false,"id":"test:gem","name":"Gem","label":"Slot 0","count":64}]}]},
             "curios":{"available":true,"groups":[{"name":"ring · Equipped","slots":[{"empty":false,"id":"test:gem","name":"Ring","label":"ring 1","count":1}]},{"name":"ring · Cosmetic","slots":[]}]}}
            """).getAsJsonObject();
        player.add("storage",storage);
        ItemIcons icons=new ItemIcons(ItemIconsTest.assets()::get);
        Backend backend = new Backend() {
            public JsonObject icons(JsonArray ids) {return icons.batch(ids);}
            public JsonObject players() {return JsonParser.parseString("{\"players\":[{\"uuid\":\""+id+"\",\"name\":\"TestPlayer\",\"online\":true},{\"uuid\":\"00000000-0000-0000-0000-000000000002\",\"name\":\"OfflinePlayer\",\"online\":false}],\"serverPlayers\":1,\"maxPlayers\":20,\"punishAvailable\":true}").getAsJsonObject();}
            public synchronized JsonObject player(UUID uuid,Auth.User user) { return player.deepCopy(); }
            public synchronized JsonElement mutate(UUID uuid,Auth.User user,String action,JsonObject body) {
                if(action.equals("note-add")) {
                    JsonObject note=new JsonObject();note.addProperty("id",UUID.randomUUID().toString());note.addProperty("text",body.get("text").getAsString());note.addProperty("author",user.name());note.addProperty("canEdit",true);note.addProperty("createdAt",System.currentTimeMillis());player.getAsJsonArray("notes").add(note);
                } else if(action.equals("punish")) {
                    ModerationRequest request=ModerationRequest.parse(user,action,body,true,Set.of("xray"));
                    JsonObject record=new JsonObject();record.addProperty("id",1);record.addProperty("type",request.type().toLowerCase());record.addProperty("reason",request.reason());record.addProperty("active",true);record.addProperty("at",System.currentTimeMillis());record.addProperty("by",user.name());player.getAsJsonArray("cases").add(record);
                }
                JsonObject result=new JsonObject();result.addProperty("status","saved");return result;
            }
        };
        int port;try(var socket=new java.net.ServerSocket(0)){port=socket.getLocalPort();}
        String origin="http://localhost:"+port;
        try(var panel=new PanelServer(new Config("127.0.0.1",port,origin,users, discordMode ? DiscordTest.settings(new Properties()) : null),backend,new Audit(dir.resolve("audit.jsonl")),discordMode ? new DiscordTest.Fake() : null)) {
            panel.start();
            Process browser=new ProcessBuilder("python3","tools/browser-test.py",origin,discordMode ? "discord" : "local").inheritIO().start();
            if(!browser.waitFor(90,java.util.concurrent.TimeUnit.SECONDS)){browser.destroyForcibly();throw new AssertionError("Browser tests timed out");}
            if(browser.exitValue()!=0)throw new AssertionError("Browser tests failed");
        }
    }
}
