package com.zaremate.admin_panel;

import com.google.gson.*;
import net.minecraft.nbt.*;
import java.nio.file.*;
import java.util.*;

/** Worker-owned saved-position cache. No live Minecraft objects are accessed here. */
final class MapPlayerPositions {
    private record Cached(long modified,long size,JsonObject position) {}
    private final Map<UUID,Cached> cache=new HashMap<>();
    JsonArray withOffline(JsonArray live,Path directory,Path profiles) throws Exception {
        JsonArray result=live.deepCopy();
        Set<UUID> online=new HashSet<>(),found=new HashSet<>();
        for(JsonElement row:live)online.add(UUID.fromString(row.getAsJsonObject().get("uuid").getAsString()));
        Map<UUID,String> names=new HashMap<>();
        try(var reader=Files.newBufferedReader(profiles)) {
            for(JsonElement value:JsonParser.parseReader(reader).getAsJsonArray())try {
                JsonObject row=value.getAsJsonObject();names.put(UUID.fromString(row.get("uuid").getAsString()),row.get("name").getAsString());
            }catch(RuntimeException ignored){}
        }catch(java.io.IOException|RuntimeException ignored){}
        if(!Files.isDirectory(directory)){cache.clear();return result;}
        try(var paths=Files.list(directory)) {
            for(Path path:paths.sorted().toList()) {
                if(Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException("Map capture stopped");
                String filename=path.getFileName().toString();if(!filename.endsWith(".dat"))continue;
                UUID id;try{id=UUID.fromString(filename.substring(0,filename.length()-4));}catch(IllegalArgumentException ignored){continue;}
                found.add(id);if(online.contains(id))continue;
                try {
                    long modified=Files.getLastModifiedTime(path).toMillis(),size=Files.size(path);
                    Cached cached=cache.get(id);
                    if(cached==null||cached.modified()!=modified||cached.size()!=size) {
                        cached=new Cached(modified,size,position(SavedPlayer.read(path)));cache.put(id,cached);
                    }
                    if(cached.position()==null)continue;
                    JsonObject row=cached.position().deepCopy();row.addProperty("uuid",id.toString());
                    row.addProperty("name",names.getOrDefault(id,id.toString()));row.addProperty("online",false);result.add(row);
                }catch(java.io.IOException ignored) {cache.remove(id);}
            }
        }
        cache.keySet().retainAll(found);
        return result;
    }
    private static JsonObject position(SavedPlayer saved) {
        CompoundTag tag=saved.data();if(tag==null||!tag.contains("Dimension",Tag.TAG_STRING))return null;
        ListTag pos=tag.getList("Pos",Tag.TAG_DOUBLE);if(pos.size()!=3)return null;
        for(int i=0;i<3;i++)if(!Double.isFinite(pos.getDouble(i)))return null;
        String dimension=tag.getString("Dimension");if(dimension.isBlank())return null;
        JsonObject row=new JsonObject();row.addProperty("dimension",dimension);
        row.addProperty("x",pos.getDouble(0));row.addProperty("y",pos.getDouble(1));row.addProperty("z",pos.getDouble(2));
        row.addProperty("savedAt",saved.savedAt());return row;
    }
}
