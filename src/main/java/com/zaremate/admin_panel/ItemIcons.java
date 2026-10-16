package com.zaremate.admin_panel;

import com.google.gson.*;



import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Resolves ordinary generated/handheld item models; custom and 3-D renderers use a fallback. */
final class ItemIcons {
    interface Assets { byte[] read(String path) throws Exception; }
    private final Assets assets;
    private int warnings;
    private void warn(String message) {if(warnings++<5)java.util.logging.Logger.getLogger("admin_panel").warning(message);}
    private final Map<String, String> cache = new LinkedHashMap<>(256, .75f, true) {
        protected boolean removeEldestEntry(Map.Entry<String,String> entry) { return size() > 256; }
    };
    ItemIcons(Assets assets) { this.assets = assets; }
    static boolean valid(String id) {
        if (id == null || id.length() > 200 || !id.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")) return false;
        String namespace = id.substring(0,id.indexOf(':'));
        if(namespace.equals(".") || namespace.equals(".."))return false;
        String path = id.substring(id.indexOf(':')+1);
        return Arrays.stream(path.split("/", -1)).noneMatch(s -> s.isEmpty() || s.equals(".") || s.equals(".."));
    }
    static String path(String id, String folder, String extension) {
        if (!valid(id)) throw new IllegalArgumentException("Invalid resource ID");
        String[] parts = id.split(":",2); return "assets/" + parts[0] + "/" + folder + "/" + parts[1] + extension;
    }
    private static String resource(String id) { return id.contains(":") ? id : "minecraft:" + id; }
    synchronized String icon(String id) {
        if (!valid(id)) throw new IllegalArgumentException("Invalid item ID");
        if (cache.containsKey(id)) return cache.get(id);
        String result = "";
        try { result = resolve(id); } catch (Exception | LinkageError error) { warn("Icon lookup failed for " + id + ": " + error.getClass().getSimpleName()); }
        cache.put(id,result); return result;
    }
    JsonObject batch(JsonArray ids) {
        if (ids.size()>128) throw new IllegalArgumentException("At most 128 icons per request");
        JsonObject result = new JsonObject();
        for (JsonElement id : ids) {
            if (!id.isJsonPrimitive() || !id.getAsJsonPrimitive().isString() || !valid(id.getAsString())) throw new IllegalArgumentException("Invalid item ID");
        }
        for (JsonElement id : ids) result.addProperty(id.getAsString(),icon(id.getAsString()));
        return result;
    }
    private String resolve(String item) throws Exception {
        String[] parts=item.split(":",2);String model=parts[0]+":item/"+parts[1];
        Map<String,String> textures=new HashMap<>();Set<String> visited=new HashSet<>();boolean flat=false;JsonArray elements=null;JsonObject gui=null;
        for(int depth=0;depth<16;depth++) {
            if (!visited.add(model)) return "";
            if (Set.of("minecraft:item/generated","minecraft:item/handheld","minecraft:item/handheld_rod","minecraft:builtin/generated").contains(model)){flat=true;break;}
            if(Set.of("minecraft:block/cube_all","minecraft:block/cube_column","minecraft:block/cube_bottom_top","minecraft:block/cube","minecraft:block/orientable").contains(model)) {
                if(elements==null)elements=ModelPreview.cube(model);if(gui==null)gui=ModelPreview.blockGui();break;
            }
            if(model.equals("minecraft:block/block")){if(gui==null)gui=ModelPreview.blockGui();break;}
            if(model.equals("minecraft:builtin/entity"))return "";
            byte[] data=assets.read(path(model,"models",".json"));
            if(data==null || data.length>262144)return "";
            JsonObject json=JsonParser.parseString(new String(data,StandardCharsets.UTF_8)).getAsJsonObject();
            if(json.has("loader"))return "";
            if(json.has("textures"))for(var e:json.getAsJsonObject("textures").entrySet()) textures.putIfAbsent(e.getKey(),e.getValue().getAsString());
            if(gui==null && json.has("display") && json.getAsJsonObject("display").has("gui"))gui=json.getAsJsonObject("display").getAsJsonObject("gui");
            if(elements==null && json.has("elements"))elements=json.getAsJsonArray("elements");
            if(!json.has("parent"))break;
            model=resource(json.get("parent").getAsString());
        }
        if(elements!=null)return ModelPreview.render(elements,gui,textures,assets);
        if(!flat)return "";
        List<byte[]> layers=new ArrayList<>();
        for(int layer=0;layer<5;layer++) {
            String texture=textures.get("layer"+layer);if(texture==null)break;
            Set<String> refs=new HashSet<>();
            while(texture.startsWith("#")){if(!refs.add(texture))return "";texture=textures.get(texture.substring(1));if(texture==null)return "";}
            byte[] png=assets.read(path(resource(texture),"textures",".png"));
            if(!png(png))return "";
            layers.add(png);
        }
        if(layers.isEmpty())return "";
        try {return PngPreview.render(layers);}
        catch(Exception | LinkageError error) {
            warn("PNG normalization unavailable ("+error.getClass().getSimpleName()+"); serving original textures.");
            return "data:image/png;base64,"+Base64.getEncoder().encodeToString(layers.getFirst());
        }
    }
    static boolean png(byte[] bytes) {
        if(bytes==null || bytes.length<24 || bytes.length>2097152)return false;
        byte[] signature={(byte)137,80,78,71,13,10,26,10};
        for(int i=0;i<8;i++)if(bytes[i]!=signature[i])return false;
        int w=java.nio.ByteBuffer.wrap(bytes,16,4).getInt(),h=java.nio.ByteBuffer.wrap(bytes,20,4).getInt();
        return w>0&&h>0&&w<=2048&&h<=16384&&(long)w*h<=4194304;
    }
}
