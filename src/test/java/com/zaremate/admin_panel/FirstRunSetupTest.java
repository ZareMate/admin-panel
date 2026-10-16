package com.zaremate.admin_panel;

import com.google.gson.*;
import java.util.*;

/** Checks first-run rank precedence, validation and duplicate rejection. */
public final class FirstRunSetupTest {
    private static JsonObject sample() {
        return JsonParser.parseString("""
            {"origin":"https://panel.example.org","bind":"127.0.0.1","port":8080,
             "clientId":"1000000000000000000","guildId":"1506410587553398854","clientSecret":"test-secret",
             "ranks":[
               {"name":"dev","roleId":"1512986854532579388","access":"admin"},
               {"name":"owner","roleId":"1512986702161907712","access":"admin"},
               {"name":"helper","roleId":"1512987186893557820","access":"viewer"}]}
            """).getAsJsonObject();
    }
    public static void main(String[] args) {
        Properties p=FirstRunSetup.configuration(sample());
        if(!p.getProperty("discord.rank-order").equals("dev,owner,helper"))
            throw new AssertionError("Rank order lost");
        DiscordSettings config=DiscordSettings.load(p);
        if(!config.rank(Set.of("1512986854532579388","1512986702161907712")).equals("dev"))
            throw new AssertionError("Rank priority lost");
        JsonObject duplicate=sample();
        duplicate.getAsJsonArray("ranks").get(1).getAsJsonObject().addProperty("roleId","1512986854532579388");
        try { FirstRunSetup.configuration(duplicate); throw new AssertionError("Duplicate role accepted"); }
        catch (IllegalArgumentException expected) { /* expected */ }
        JsonObject remote=sample();remote.addProperty("bind","0.0.0.0");
        try { FirstRunSetup.configuration(remote); throw new AssertionError("Public bind accepted"); }
        catch (IllegalArgumentException expected) { /* expected */ }
        JsonObject http=sample();http.addProperty("origin","http://panel.example.org");
        try { FirstRunSetup.configuration(http); throw new AssertionError("Remote HTTP accepted"); }
        catch (IllegalArgumentException expected) { /* expected */ }
        System.out.println("PASS: first-run config validation and rank ordering");
    }
}
