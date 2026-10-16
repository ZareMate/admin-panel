package com.zaremate.admin_panel;

import com.google.gson.*;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Real HTTP integration checks with an isolated backend; no game server or test framework required. */
public final class PanelTest {
    private static int checks;
    private static void check(boolean ok, String message) { checks++; if (!ok) throw new AssertionError(message); }
    private static final HttpClient CLIENT = HttpClient.newHttpClient();
    private static String origin;
    private static HttpResponse<String> call(String method, String path, String body, String cookie, String csrf, String requestId, String source) throws Exception {
        var b = HttpRequest.newBuilder(URI.create(origin + path));
        if (cookie != null) b.header("Cookie", cookie);
        if (csrf != null) b.header("X-CSRF-Token", csrf);
        if (requestId != null) b.header("X-Request-ID", requestId);
        if (source != null) b.header("Origin", source);
        if (body != null) b.header("Content-Type", "application/json");
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return CLIENT.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }
    private static String login(String user) throws Exception {
        var r = call("POST", "/api/login", "{\"username\":\""+user+"\",\"password\":\"correct-password-123\"}", null,null,null,origin);
        check(r.statusCode()==200, "login " + user + ": " + r.body());
        check(r.headers().firstValue("Set-Cookie").orElse("").contains("HttpOnly; SameSite=Strict"), "cookie protections");
        return r.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];
    }
    private static String csrf(String cookie) throws Exception {
        var r = call("GET","/api/session",null,cookie,null,null,null);
        return JsonParser.parseString(r.body()).getAsJsonObject().get("csrf").getAsString();
    }
    public static void main(String[] args) throws Exception {
        checks += ModerationTest.run();
        String hash = "00112233445566778899aabbccddeeff:" + Auth.hash("correct-password-123".toCharArray(), HexFormat.of().parseHex("00112233445566778899aabbccddeeff"));
        check(Auth.verify("correct-password-123",hash), "valid password");
        check(!Auth.verify("wrong",hash), "wrong password");
        check(!Auth.verify("wrong","broken"), "malformed hash");
        Map<String,Auth.User> users=new HashMap<>();
        for(String role:List.of("viewer","moderator","admin")) users.put(role,new Auth.User(role,role,UUID.randomUUID(),hash));
        Auth auth=new Auth(users);
        for(int i=0;i<10;i++)check(auth.allowLogin("test"),"initial login attempts");
        check(!auth.allowLogin("test"),"login rate limit");
        Path dir=Files.createTempDirectory("admin-panel-test-");
        Path configFile=dir.resolve("config.properties");
        try {
            Config.load(configFile);
            throw new AssertionError("Missing config should require first-run setup");
        } catch (IllegalStateException expected) {
            check(expected.getMessage().contains("first-run setup"), "missing config requires first-run setup");
            check(!Files.exists(configFile), "missing config must not be silently created");
        }
        Files.writeString(configFile, "enabled=false\n");
        check(Config.load(configFile)==null, "explicitly disabled configuration stays disabled");
        String account = "user.admin=admin,00000000-0000-0000-0000-000000000001," + hash + "\n";
        String lanConfig = "enabled=true\nbind=0.0.0.0\norigin=http://10.0.0.1:8080\n" + account;
        Files.writeString(configFile,lanConfig);
        try{Config.load(configFile);throw new AssertionError("remote plain HTTP accepted");}catch(IllegalArgumentException expected){check(expected.getMessage().contains("Non-local origins"), "HTTP rejected for the right reason");}
        Files.writeString(configFile,lanConfig + "allow-insecure-http=false\n");
        try{Config.load(configFile);throw new AssertionError("explicit false accepted HTTP");}catch(IllegalArgumentException expected){checks++;}
        Files.writeString(configFile,lanConfig + "allow-insecure-http=true\n");
        Config lan = Config.load(configFile);
        check(lan.origin().equals("http://10.0.0.1:8080") && lan.bind().equals("0.0.0.0") && !lan.secure(), "LAN HTTP opt-in with container bind");
        check(lan.users().containsKey("admin"), "LAN config still loads staff accounts");
        Files.writeString(configFile,"enabled=true\norigin=http://10.0.0.1:8080\nallow-insecure-http=true\n");
        try{Config.load(configFile);throw new AssertionError("missing staff accepted");}catch(IllegalArgumentException expected){check(expected.getMessage().contains("staff account"), "HTTP opt-in still requires staff");}
        Files.writeString(configFile,lanConfig.replace("http://10.0.0.1:8080", "https://admin.example.com"));
        check(Config.load(configFile).secure(), "HTTPS retains Secure cookies");
        int port;try(var socket=new java.net.ServerSocket(0)){port=socket.getLocalPort();}
        origin="http://localhost:"+port;
        AtomicInteger mutations=new AtomicInteger();
        Backend fake=new Backend(){
            public JsonObject players(){JsonObject r=new JsonObject();r.add("players",new JsonArray());return r;}
            public JsonObject player(UUID id,Auth.User user){JsonObject r=new JsonObject();r.addProperty("uuid",id.toString());return r;}
            public JsonElement mutate(UUID id,Auth.User user,String action,JsonObject b){mutations.incrementAndGet();JsonObject r=new JsonObject();r.addProperty("status","applied");return r;}
        };
        Path auditFile=dir.resolve("audit.jsonl");
        try(var panel=new PanelServer(new Config("127.0.0.1",port,origin,users),fake,new Audit(auditFile))){
            panel.start();
            var index=call("GET","/",null,null,null,null,null);
            check(index.statusCode()==200 && index.body().contains("Admin Panel"),"static frontend");
            check(index.headers().firstValue("Content-Security-Policy").orElse("").contains("frame-ancestors 'none'"),"CSP");
            check(call("GET","/api/players",null,null,null,null,null).statusCode()==401,"anonymous denied");
            check(call("GET","/../config/admin-panel.properties",null,null,null,null,null).statusCode()==404,"path traversal denied");
            check(call("POST","/api/login","{}",null,null,null,"https://evil.example").statusCode()==403,"cross-origin login denied");
            check(call("POST","/api/login","{\"username\":\"admin\",\"password\":\"bad\"}",null,null,null,origin).statusCode()==401,"bad login denied");
            String viewer=login("viewer"), vcsrf=csrf(viewer);
            String target="/api/players/00000000-0000-0000-0000-000000000001/punish";
            String warning="{\"type\":\"WARN\",\"reason\":\"test\"}";
            check(call("GET","/api/players",null,viewer,null,null,null).statusCode()==200,"viewer can read");
            check(call("GET","/api/audit",null,viewer,null,null,null).statusCode()==403,"viewer cannot read audit");
            check(call("POST",target,warning,viewer,vcsrf,UUID.randomUUID().toString(),origin).statusCode()==403,"viewer mutation denied");
            check(call("POST","/api/icons","{\"ids\":[\"minecraft:diamond\"]}",null,null,null,origin).statusCode()==401,"anonymous icons denied");
            check(call("POST","/api/icons","{\"ids\":[\"minecraft:diamond\"]}",viewer,null,null,origin).statusCode()==403,"icons require CSRF");
            check(call("POST","/api/icons","{\"ids\":[\"minecraft:diamond\"]}",viewer,vcsrf,null,origin).statusCode()==200,"viewer icons permitted");
            check(call("POST","/api/icons","{\"ids\":[\"test:../../secret\"]}",viewer,vcsrf,null,origin).statusCode()==400,"icon traversal rejected");
            String moderator=login("moderator"),mcsrf=csrf(moderator);
            check(call("POST",target,warning,moderator,null,UUID.randomUUID().toString(),origin).statusCode()==403,"missing CSRF denied");
            check(call("POST",target,warning,moderator,mcsrf,UUID.randomUUID().toString(),"https://evil.example").statusCode()==403,"cross-origin mutation denied");
            check(call("POST",target,"{\"type\":\"BAN\"}",moderator,mcsrf,UUID.randomUUID().toString(),origin).statusCode()==403,"moderator ban denied");
            check(call("POST",target,"{\"type\":\"OFFENSE\"}",moderator,mcsrf,UUID.randomUUID().toString(),origin).statusCode()==403,"moderator configured offense denied");
            String request=UUID.randomUUID().toString();
            check(call("POST",target,warning,moderator,mcsrf,request,origin).statusCode()==200,"moderator warning accepted");
            check(call("POST",target,warning,moderator,mcsrf,request,origin).statusCode()==409,"duplicate rejected");
            check(mutations.get()==1,"duplicate did not execute");
            check(call("POST",target,"x".repeat(16385),moderator,mcsrf,UUID.randomUUID().toString(),origin).statusCode()==413,"body size limit");
            check(call("POST",target,"[]",moderator,mcsrf,UUID.randomUUID().toString(),origin).statusCode()==400,"non-object body rejected");
            String admin=login("admin"),acsrf=csrf(admin);
            check(call("POST",target,"{\"type\":\"BAN\"}",admin,acsrf,UUID.randomUUID().toString(),origin).statusCode()==200,"admin ban permitted");
            check(call("GET","/api/audit",null,admin,null,null,null).body().contains("requested"),"audit records intent");
            check(call("POST","/api/logout","{}",admin,acsrf,null,origin).statusCode()==200,"logout");
            check(call("GET","/api/players",null,admin,null,null,null).statusCode()==401,"logged-out cookie rejected");
        }
        check(new Audit(auditFile).recent().size()>=7,"audit survives restart");
        System.out.println("PASS: " + checks + " checks (authentication, authorization, CSRF, deduplication, audit, static serving).");
    }
}
