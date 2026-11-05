package com.zaremate.admin_panel;

import com.google.gson.*;
import net.minecraft.nbt.*;
import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.util.*;

final class MapPlayerPositionsTest {
 static int run() throws Exception {
  Path directory=Files.createTempDirectory("panel-map-offline-");
  try {
   UUID offline=UUID.randomUUID(),online=UUID.randomUUID(),bad=UUID.randomUUID();
   Path profiles=directory.resolve("usercache.json");
   Files.writeString(profiles,"[{\"uuid\":\""+offline+"\",\"name\":\"SavedExplorer\"}]");
   save(directory.resolve(offline+".dat"),32,"minecraft:the_nether");
   save(directory.resolve(online+".dat"),-100,"minecraft:overworld");
   Files.writeString(directory.resolve(bad+".dat"),"corrupt");
   JsonArray live=new JsonArray();JsonObject row=new JsonObject();row.addProperty("uuid",online.toString());row.addProperty("online",true);row.addProperty("x",99);live.add(row);
   MapPlayerPositions positions=new MapPlayerPositions();
   JsonArray result=positions.withOffline(live,directory,profiles);
   if(result.size()!=2||live.size()!=1)throw new AssertionError("Live players deduplicate saved data without mutating capture");
   JsonObject saved=result.get(1).getAsJsonObject();
   if(!saved.get("name").getAsString().equals("SavedExplorer")||saved.get("online").getAsBoolean()
       ||saved.get("x").getAsDouble()!=32||!saved.get("dimension").getAsString().equals("minecraft:the_nether")||!saved.has("savedAt"))
    throw new AssertionError("Offline markers need names, saved positions, dimensions and timestamps");
   if(result.get(0).getAsJsonObject().get("x").getAsInt()!=99)throw new AssertionError("Live position must win");
   save(directory.resolve(offline+".dat"),48,"minecraft:the_end");
   Files.setLastModifiedTime(directory.resolve(offline+".dat"),FileTime.fromMillis(System.currentTimeMillis()+10000));
   result=positions.withOffline(live,directory,profiles);
   if(result.get(1).getAsJsonObject().get("x").getAsDouble()!=48)throw new AssertionError("Changed player saves must invalidate cache");
   save(directory.resolve(offline+".dat"),Double.NaN,"minecraft:overworld");
   Files.setLastModifiedTime(directory.resolve(offline+".dat"),FileTime.fromMillis(System.currentTimeMillis()+20000));
   if(positions.withOffline(live,directory,profiles).size()!=1)throw new AssertionError("Invalid saved positions must not create markers");
   Files.delete(directory.resolve(online+".dat"));Files.delete(directory.resolve(offline+".dat"));
   if(positions.withOffline(live,directory,profiles).size()!=1)throw new AssertionError("Deleted saves disappear");
   return 6;
  } finally {try(var paths=Files.walk(directory)){for(Path path:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}}
 }
 private static void save(Path path,double x,String dimension) throws Exception {
  CompoundTag tag=new CompoundTag();ListTag position=new ListTag();
  position.add(DoubleTag.valueOf(x));position.add(DoubleTag.valueOf(64));position.add(DoubleTag.valueOf(-32));
  tag.put("Pos",position);tag.putString("Dimension",dimension);NbtIo.writeCompressed(tag,path);
 }
}
