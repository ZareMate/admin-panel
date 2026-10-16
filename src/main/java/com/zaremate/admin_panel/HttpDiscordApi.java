package com.zaremate.admin_panel;

import com.google.gson.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

final class HttpDiscordApi implements DiscordApi {
    private final DiscordSettings settings;
    record Reply(int status, String body, String retryAfter) {}
    interface Transport { Reply send(HttpRequest request) throws Exception; }
    private final Transport transport;
    private final java.util.function.LongSupplier clock;
    private final java.util.concurrent.atomic.AtomicLong retryAt = new java.util.concurrent.atomic.AtomicLong();
    private static final java.util.logging.Logger LOG = java.util.logging.Logger.getLogger("admin_panel");
    HttpDiscordApi(DiscordSettings settings) {
        this.settings=settings; this.clock=System::currentTimeMillis;
        HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
        this.transport=request->{
            var response=client.send(request,HttpResponse.BodyHandlers.ofString());
            return new Reply(response.statusCode(),response.body(),response.headers().firstValue("Retry-After").orElse(""));
        };
    }
    HttpDiscordApi(DiscordSettings settings, Transport transport, java.util.function.LongSupplier clock) { this.settings=settings;this.transport=transport;this.clock=clock; }
    static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    public JsonObject exchange(String code, String redirectUri) throws Exception {
        String form = "grant_type=authorization_code&client_id=" + encode(settings.clientId())
                + "&client_secret=" + encode(settings.clientSecret()) + "&code=" + encode(code) + "&redirect_uri=" + encode(redirectUri);
        return send(HttpRequest.newBuilder(URI.create("https://discord.com/api/oauth2/token"))
                .header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(form)), "token exchange");
    }
    public JsonObject identity(String token) throws Exception { return get("/users/@me", token, "identity lookup"); }
    public JsonObject membership(String token, String guildId) throws Exception { return get("/users/@me/guilds/" + guildId + "/member", token, "guild membership lookup"); }
    private JsonObject get(String path, String token, String stage) throws Exception {
        return send(HttpRequest.newBuilder(URI.create("https://discord.com/api/v10" + path)).header("Authorization", "Bearer " + token).GET(), stage);
    }
    private JsonObject send(HttpRequest.Builder request, String stage) throws Exception {
        long remaining=retryAt.get()-clock.getAsLong();
        if(remaining>0)throw new PanelServer.Failure(503,"Discord rate limit: wait " + ((remaining+999)/1000) + " seconds before trying again.");
        try {
            var response=transport.send(request.timeout(Duration.ofSeconds(8)).header("Accept","application/json")
                    .header("User-Agent","DiscordBot (https://github.com/ZareMate/admin-gui, 1.2.3)").build());
            int status=response.status();
            if(status!=200) {
                // Never log response bodies, request URLs, codes, credentials, or tokens.
                LOG.warning("Discord " + stage + " failed: HTTP " + status);
                JsonObject error=null;
                try {error=JsonParser.parseString(response.body()).getAsJsonObject();}catch(RuntimeException ignored){}
                if(status==429) {
                    double seconds=60;
                    try {
                        seconds=Double.parseDouble(response.retryAfter());
                    }catch(RuntimeException ignored){
                        try {if(error!=null && error.has("retry_after"))seconds=error.get("retry_after").getAsDouble();}catch(RuntimeException ignoredBody){}
                    }
                    if(!Double.isFinite(seconds)||seconds<=0)seconds=60;
                    long millis=(long)Math.ceil(Math.min(seconds,86400)*1000);
                    retryAt.accumulateAndGet(clock.getAsLong()+millis,Math::max);
                    throw new PanelServer.Failure(503,"Discord rate-limited " + stage + " (HTTP 429). Wait " + ((millis+999)/1000) + " seconds before trying again.");
                }
                String oauthError="";
                try {if(error!=null && error.has("error"))oauthError=error.get("error").getAsString();}catch(RuntimeException ignored){}
                if(stage.equals("token exchange") && oauthError.equals("invalid_client"))throw new PanelServer.Failure(401,"Discord rejected the application credentials. Check the client ID and current client secret, then restart Minecraft.");
                if(stage.equals("token exchange") && status==400)throw new PanelServer.Failure(401,"Discord rejected the login code or callback URL (HTTP 400). Start sign-in again; verify the registered OAuth2 redirect matches the panel origin.");
                if(status==401)throw new PanelServer.Failure(401,"Discord rejected " + stage + " (HTTP 401). Sign in again; if this persists during token exchange, check the application credentials.");
                if(status==403)throw new PanelServer.Failure(403,"Discord denied " + stage + " (HTTP 403). Check application access, consent, and server network restrictions.");
                if(status==404)throw new PanelServer.Failure(403,"Discord could not find " + stage + " (HTTP 404). Check the configured guild ID and your guild membership.");
                throw new PanelServer.Failure(503,"Discord " + stage + " returned HTTP " + status + ". Try again later; the server log records the failed stage.");
            }
            return JsonParser.parseString(response.body()).getAsJsonObject();
        } catch (PanelServer.Failure e) { throw e; }
        catch (InterruptedException e) {Thread.currentThread().interrupt();throw new PanelServer.Failure(503,"Discord request interrupted. Try again shortly.");}
        catch (Exception e) {
            LOG.warning("Discord " + stage + " failed: " + e.getClass().getSimpleName());
            throw new PanelServer.Failure(503,"Could not complete Discord " + stage + ". Check the server's outbound HTTPS connection and server log.");
        }
    }
}
