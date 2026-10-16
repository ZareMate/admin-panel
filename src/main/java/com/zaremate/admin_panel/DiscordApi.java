package com.zaremate.admin_panel;

import com.google.gson.JsonObject;

/** Injectable transport; production endpoints are fixed, tests supply an isolated fake Discord service. */
interface DiscordApi {
    JsonObject exchange(String code, String redirectUri) throws Exception;
    JsonObject identity(String token) throws Exception;
    JsonObject membership(String token, String guildId) throws Exception;
}
