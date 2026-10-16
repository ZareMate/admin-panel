package com.zaremate.admin_panel;
import java.util.*;
import java.nio.charset.StandardCharsets;

/** Runs without java.desktop, matching minimal/headless Minecraft server runtimes. */
public final class IconFallbackTest {
    public static void main(String[] args) {
        byte[] png=Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XkAAAAASUVORK5CYII=");
        String model="{\"parent\":\"minecraft:item/generated\",\"textures\":{\"layer0\":\"test:item/icon\"}}";
        ItemIcons icons=new ItemIcons(path -> path.endsWith(".json")?model.getBytes(StandardCharsets.UTF_8):png);
        String result=icons.icon("test:icon");
        if(!result.equals("data:image/png;base64,"+Base64.getEncoder().encodeToString(png)))throw new AssertionError("original PNG fallback without java.desktop");
        System.out.println("PASS: original PNG served without java.desktop.");
    }
}
