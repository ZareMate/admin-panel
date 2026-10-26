package com.zaremate.admin_panel;

import com.google.gson.JsonObject;

final class RequestFields {
    private RequestFields() {}
    static String string(JsonObject body, String key, int max) {
        if (!body.has(key) || !body.get(key).isJsonPrimitive() || !body.getAsJsonPrimitive(key).isString())
            throw new IllegalArgumentException(key + " is required");
        String value = body.get(key).getAsString();
        if (value.isBlank() || value.length() > max || value.chars().anyMatch(c -> c < 32 && c != 10))
            throw new IllegalArgumentException(key + " is invalid");
        return value;
    }
}
