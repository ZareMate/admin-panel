package com.zaremate.admin_panel;
import java.util.*;
import java.util.concurrent.atomic.*;

public final class DiscordHttpTest {
    static int checks;
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    static void fails(String text,DiscordTest.Work work)throws Exception{try{work.run();throw new AssertionError("Expected failure");}catch(PanelServer.Failure e){check(e.getMessage().contains(text),e.getMessage());check(!e.getMessage().contains("sensitive-response"),"response redacted");}}
    public static void main(String[] args)throws Exception {
        var settings=DiscordTest.settings(new Properties());AtomicLong clock=new AtomicLong(1000);AtomicInteger calls=new AtomicInteger();
        AtomicReference<HttpDiscordApi.Reply> reply=new AtomicReference<>(new HttpDiscordApi.Reply(429,"{\"retry_after\":2.5}",""));
        var api=new HttpDiscordApi(settings,r->{calls.incrementAndGet();check(r.headers().firstValue("User-Agent").orElse("").startsWith("DiscordBot ("),"User-Agent");return reply.get();},clock::get);
        fails("HTTP 429",()->api.identity("token"));
        fails("wait 3 seconds",()->api.identity("token"));check(calls.get()==1,"no requests during cooldown");
        clock.addAndGet(2501);reply.set(new HttpDiscordApi.Reply(200,"{\"id\":\"123\"}",""));check(api.identity("token").get("id").getAsString().equals("123"),"recovery after cooldown");
        for(int status:List.of(400,401,403,404,500,502)){
            reply.set(new HttpDiscordApi.Reply(status,"{\"message\":\"sensitive-response\"}",""));
            fails("HTTP "+status,()->api.exchange("code","http://localhost:8080/api/auth/discord/callback"));
        }
        reply.set(new HttpDiscordApi.Reply(401,"{\"error\":\"invalid_client\",\"message\":\"sensitive-response\"}",""));fails("application credentials",()->api.exchange("code","http://localhost"));
        reply.set(new HttpDiscordApi.Reply(429,"{\"retry_after\":100}","4"));fails("Wait 4 seconds",()->api.membership("token",settings.guildId()));
        clock.addAndGet(4001);reply.set(new HttpDiscordApi.Reply(200,"not JSON sensitive-response",""));fails("identity lookup",()->api.identity("token"));
        System.out.println("PASS: "+checks+" Discord HTTP error/cooldown checks.");
    }
}
