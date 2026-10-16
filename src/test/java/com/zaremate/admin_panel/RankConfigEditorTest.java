package com.zaremate.admin_panel;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;

/** Rank writes must preserve login secrets and reject lockout configurations. */
public final class RankConfigEditorTest {
    public static void main(String[] args) throws Exception {
        Path file=Files.createTempFile("rank-editor-", ".properties");
        Properties initial=new Properties();
        initial.setProperty("auth.mode", "discord");
        initial.setProperty("discord.client-id", "1000000000000000000");
        initial.setProperty("discord.client-secret", "secret-for-test");
        initial.setProperty("discord.guild-id", "1506410587553398854");
        initial.setProperty("discord.rank-order", "dev,owner");
        initial.setProperty("discord.rank.dev.role-id", "1512986854532579388");
        initial.setProperty("discord.rank.dev.access", "admin");
        initial.setProperty("discord.rank.owner.role-id", "1512986702161907712");
        initial.setProperty("discord.rank.owner.access", "admin");
        initial.setProperty("port", "8123");
        try (var out=Files.newOutputStream(file)) { initial.store(out, "test"); }
        JsonArray ranks=JsonParser.parseString("""
            [{"name":"owner","discordRoleId":"1512986702161907712","access":"admin"},
             {"name":"mod","discordRoleId":"1512987123672682656","access":"moderator"}]
            """).getAsJsonArray();
        RankConfigEditor.save(file, ranks);
        Properties updated=new Properties();
        try(var in=Files.newInputStream(file)){updated.load(in);}
        if(!updated.getProperty("discord.rank-order").equals("owner,mod")
            || !updated.getProperty("port").equals("8123")
            || !updated.getProperty("discord.client-secret").equals("secret-for-test")
            || updated.containsKey("discord.rank.dev.access"))
            throw new AssertionError("Rank editing lost unrelated values or failed to remove a rank");
        JsonArray invalid=JsonParser.parseString("""
            [{"name":"mod","discordRoleId":"1512987123672682656","access":"moderator"}]
            """).getAsJsonArray();
        try { RankConfigEditor.save(file, invalid); throw new AssertionError("Owner/dev lockout accepted"); }
        catch(IllegalArgumentException expected) { /* expected */ }
        Files.deleteIfExists(file);
        System.out.println("PASS: persisted ranks, preserved settings and lockout protection");
    }
}
