package com.zaremate.admin_panel;

import com.google.gson.*;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.*;

/** OAuth state, rank precedence, session revocation, and HTTP integration without live Discord credentials. */
public final class DiscordTest {
    static final String USER = "1000000000000000001";
    static final String ADMIN = DiscordSettings.DEFAULT_IDS.get("admin");
    static final String MOD = DiscordSettings.DEFAULT_IDS.get("mod");
    static final String HELPER = DiscordSettings.DEFAULT_IDS.get("helper");
    static int checks;
    static void check(boolean ok, String why) { checks++; if(!ok)throw new AssertionError(why); }
    static DiscordSettings settings(Properties overrides) {
        Properties p=new Properties();p.setProperty("discord.client-id","1000000000000000000");p.setProperty("discord.client-secret","test-secret");p.putAll(overrides);return DiscordSettings.load(p);
    }
    static final class Fake implements DiscordApi {
        Set<String> roles = Set.of(ADMIN);
        boolean unavailable, pending, missingScope, notMember;
        int exchanges, membershipCalls, identityCalls;
        public JsonObject exchange(String code,String redirect) {
            exchanges++;
            if(code.equals("bad"))throw new PanelServer.Failure(401,"Invalid test code");
            if(code.equals("viewer")) roles=Set.of(HELPER);
            if(code.equals("admin")) roles=Set.of(ADMIN);
            return JsonParser.parseString("{\"access_token\":\"test-token\",\"token_type\":\"Bearer\",\"scope\":\""+(missingScope?"identify":"identify guilds.members.read")+"\",\"expires_in\":3600}").getAsJsonObject();
        }
        public JsonObject identity(String token) {identityCalls++;return JsonParser.parseString("{\"id\":\""+USER+"\",\"username\":\"discord-staff\"}").getAsJsonObject();}
        public JsonObject membership(String token,String guild) {
            membershipCalls++;
            check(guild.equals("1506410587553398854"),"correct guild used");
            if(unavailable)throw new PanelServer.Failure(503,"Discord unavailable");
            if(notMember)throw new PanelServer.Failure(403,"Not a guild member");
            JsonObject member=new JsonObject();JsonArray a=new JsonArray();roles.forEach(a::add);member.add("roles",a);member.addProperty("pending",pending);member.add("user",identity(token));return member;
        }
    }
    interface Work {void run() throws Exception;}
    static void denied(int status,Work work){try{work.run();throw new AssertionError("Expected rejection "+status);}catch(PanelServer.Failure e){check(e.status==status,"expected "+status+", got "+e.status);}catch(Exception e){throw new AssertionError(e);}}
    static String state(DiscordAuth.Start start){return PanelServer.query(URI.create(start.location()).getRawQuery()).get("state");}
    public static void main(String[] args) throws Exception {
        DiscordSettings config=settings(new Properties());
        check(config.guildId().equals("1506410587553398854"),"default guild");
        List<String> names=Arrays.asList(DiscordSettings.ORDER.split(","));
        for(int first=0;first<names.size();first++)for(int second=first;second<names.size();second++) {
            Set<String> roles=new HashSet<>(List.of(DiscordSettings.DEFAULT_IDS.get(names.get(first)),DiscordSettings.DEFAULT_IDS.get(names.get(second))));
            check(config.rank(roles).equals(names.get(first)),"highest role wins");
            check(config.role(roles).equals(DiscordSettings.DEFAULT_ACCESS.get(names.get(first))),"access for highest rank");
        }
        denied(403,()->config.role(Set.of("1000000000000000009")));
        Properties overrides=new Properties();overrides.setProperty("discord.rank-order","helper,admin");overrides.setProperty("discord.rank.helper.access","moderator");
        var reordered=settings(overrides);check(reordered.rank(Set.of(HELPER,ADMIN)).equals("helper")&&reordered.role(Set.of(HELPER,ADMIN)).equals("moderator"),"custom order and access");
        overrides.setProperty("discord.rank.helper.access","deny");denied(403,()->settings(overrides).role(Set.of(HELPER,ADMIN)));
        check(config.uuid(USER).equals(config.uuid(USER)),"stable note author");
        UUID linked=UUID.randomUUID();overrides.setProperty("discord.minecraft."+USER,linked.toString());check(settings(overrides).uuid(USER).equals(linked),"configured Minecraft identity");
        check(!config.toString().contains("test-secret"),"secret redaction");
        AtomicLong clock=new AtomicLong(1000);
        Fake fake=new Fake();DiscordAuth oauth=new DiscordAuth(config,fake,"http://localhost:8080",clock::get);
        var start=oauth.start();check(start.location().contains("identify%20guilds.members.read"),"minimal scopes");
        denied(400,()->oauth.finish(state(start),"wrong-browser","admin",false));check(fake.exchanges==0,"state validation precedes exchange");
        var login=oauth.finish(state(start),start.browserToken(),"admin",false);check(login.user().role().equals("admin"),"OAuth login admin");
        denied(400,()->oauth.finish(state(start),start.browserToken(),"admin",false));
        var expiring=oauth.start();clock.addAndGet(300001);denied(400,()->oauth.finish(state(expiring),expiring.browserToken(),"admin",false));
        var cancelled=oauth.start();denied(401,()->oauth.finish(state(cancelled),cancelled.browserToken(),null,true));
        var scopes=oauth.start();fake.missingScope=true;denied(403,()->oauth.finish(state(scopes),scopes.browserToken(),"admin",false));fake.missingScope=false;
        fake.roles=Set.of(MOD);check(oauth.authorize(login.grant()).role().equals("moderator"),"rank downgrade seen");
        fake.roles=Set.of();denied(403,()->oauth.authorize(login.grant()));fake.roles=Set.of(ADMIN);
        fake.pending=true;denied(403,()->oauth.authorize(login.grant()));fake.pending=false;
        fake.unavailable=true;denied(503,()->oauth.authorize(login.grant()));fake.unavailable=false;
        fake.notMember=true;denied(403,()->oauth.authorize(login.grant()));fake.notMember=false;
        clock.addAndGet(3600000);denied(401,()->oauth.authorize(login.grant()));
        denied(400,()->PanelServer.query("state=a&state=b"));
        httpTests(config);
        System.out.println("PASS: " + checks + " Discord checks (rank ordering, OAuth state, replay/expiry, role changes, failure handling, HTTP callback, local-login bypass).");
    }
    static HttpClient client=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
    static String origin;
    static HttpResponse<String> call(String path,String cookie,String csrf,String body)throws Exception{
        var req=HttpRequest.newBuilder(URI.create(origin+path));
        if(cookie!=null)req.header("Cookie",cookie);
        if(csrf!=null)req.header("X-CSRF-Token",csrf);
        if(body!=null)req.header("Origin",origin).header("Content-Type","application/json").header("X-Request-ID",UUID.randomUUID().toString()).POST(HttpRequest.BodyPublishers.ofString(body));
        return client.send(req.build(),HttpResponse.BodyHandlers.ofString());
    }
    static void httpTests(DiscordSettings settings)throws Exception {
        Fake fake=new Fake();AtomicInteger mutations=new AtomicInteger();
        Backend backend=new Backend(){public JsonObject players(){return new JsonObject();}public JsonObject player(UUID id,Auth.User u){return new JsonObject();}public JsonElement mutate(UUID id,Auth.User u,String action,JsonObject b){mutations.incrementAndGet();return new JsonObject();}};
        int port;try(var socket=new java.net.ServerSocket(0)){port=socket.getLocalPort();}origin="http://localhost:"+port;
        Path temp=Files.createTempDirectory("panel-discord-test-");
        try(var panel=new PanelServer(new Config("127.0.0.1",port,origin,Map.of(),settings),backend,new Audit(temp.resolve("audit.jsonl")),fake)){
            panel.start();
            check(call("/api/auth/method",null,null,null).body().contains("discord"),"Discord method advertised");
            check(call("/api/login",null,null,"{\"username\":\"admin\",\"password\":\"anything\"}").statusCode()==403,"password bypass disabled");
            var start=call("/api/auth/discord/start",null,null,null);check(start.statusCode()==302,"OAuth redirect");
            String state=PanelServer.query(URI.create(start.headers().firstValue("Location").orElseThrow()).getRawQuery()).get("state");
            String cookie=start.headers().firstValue("Set-Cookie").orElseThrow();check(cookie.contains("HttpOnly; SameSite=Lax"),"callback cookie cross-site-compatible");cookie=cookie.split(";")[0];
            var missing=call("/api/auth/discord/callback?state="+state+"&code=admin",null,null,null);check(missing.headers().firstValue("Location").orElse("").contains("loginError"),"missing browser binding rejected");
            var callback=call("/api/auth/discord/callback?state="+state+"&code=admin",cookie,null,null);check(callback.headers().firstValue("Location").orElse("").equals("/"),"successful callback");
            String session=callback.headers().allValues("Set-Cookie").stream().filter(c->c.startsWith("panel_session=")).findFirst().orElseThrow().split(";")[0];
            JsonObject data=JsonParser.parseString(call("/api/session",session,null,null).body()).getAsJsonObject();check(data.get("rank").getAsString().equals("admin"),"rank returned to UI");String csrf=data.get("csrf").getAsString();
            int membershipCalls=fake.membershipCalls, identityCalls=fake.identityCalls, exchanges=fake.exchanges;
            check(membershipCalls>=1,"membership checked at login");
            fake.roles=Set.of(MOD);
            check(call("/api/players/00000000-0000-0000-0000-000000000001/punish",session,csrf,"{\"type\":\"BAN\"}").statusCode()==403,"downgraded admin cannot ban");
            check(mutations.get()==0,"unauthorized action blocked");
            fake.unavailable=true;
            check(call("/api/players",session,null,null).statusCode()==200,"recently validated read allowed");
            check(call("/api/session",session,null,null).statusCode()==200,"session lookup stays local");
            check(call("/api/audit",session,null,null).statusCode()==403,"audit uses refreshed role");
            check(call("/api/access/ranks",session,null,null).statusCode()==403,"ordinary admin and moderator cannot view Access Manager");
            check(call("/api/icons",session,csrf,"{\"ids\":[]}").statusCode()==503,"mutations fail closed on Discord outage");
            fake.roles=Set.of();
            check(call("/api/players",session,null,null).statusCode()==401,"failed revalidation revokes session");
            check(fake.membershipCalls>membershipCalls && fake.exchanges==exchanges,"mutations revalidate membership");
            check(call("/api/logout",session,csrf,"{}").statusCode()==401,"invalidated session cannot logout again");
            check(call("/api/players",session,null,null).statusCode()==401,"logout invalidates session");
            fake.unavailable=false;
            var nextStart=call("/api/auth/discord/start",null,null,null);
            String nextState=PanelServer.query(URI.create(nextStart.headers().firstValue("Location").orElseThrow()).getRawQuery()).get("state");
            String nextCookie=nextStart.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];
            var denied=call("/api/auth/discord/callback?state="+nextState+"&code=unchanged",nextCookie,null,null);
            check(denied.headers().firstValue("Location").orElse("").contains("loginError"),"new login rejects removed roles");
            check(fake.membershipCalls>membershipCalls,"new login rechecks membership");
            fake.roles=Set.of(DiscordSettings.DEFAULT_IDS.get("owner"));
            var ownerStart=call("/api/auth/discord/start",null,null,null);
            String ownerState=PanelServer.query(URI.create(ownerStart.headers().firstValue("Location").orElseThrow()).getRawQuery()).get("state");
            String ownerCookie=ownerStart.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];
            var ownerCallback=call("/api/auth/discord/callback?state="+ownerState+"&code=unchanged",ownerCookie,null,null);
            String ownerSession=ownerCallback.headers().allValues("Set-Cookie").stream().filter(c->c.startsWith("panel_session=")).findFirst().orElseThrow().split(";")[0];
            check(call("/api/access/ranks",ownerSession,null,null).statusCode()==200,"owner can access rank mapping");
            fake.roles=Set.of(DiscordSettings.DEFAULT_IDS.get("dev"));
            var devStart=call("/api/auth/discord/start",null,null,null);
            String devState=PanelServer.query(URI.create(devStart.headers().firstValue("Location").orElseThrow()).getRawQuery()).get("state");
            String devCookie=devStart.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];
            var devCallback=call("/api/auth/discord/callback?state="+devState+"&code=unchanged",devCookie,null,null);
            String devSession=devCallback.headers().allValues("Set-Cookie").stream().filter(c->c.startsWith("panel_session=")).findFirst().orElseThrow().split(";")[0];
            check(call("/api/access/ranks",devSession,null,null).statusCode()==200,"dev can access rank mapping");
            check(!Files.readString(temp.resolve("audit.jsonl")).contains("test-token"),"tokens excluded from audit");
        }
    }
}
