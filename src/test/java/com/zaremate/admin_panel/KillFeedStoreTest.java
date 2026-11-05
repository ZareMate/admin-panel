package com.zaremate.admin_panel;
import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

final class KillFeedStoreTest {
 static int run() throws Exception {
  Path directory=Files.createTempDirectory("panel-kill-feed-");int checks=0;
  try {
   UUID id=UUID.randomUUID();KillFeedStore store=new KillFeedStore(directory);
   JsonObject record=record(id,100,"Killer","Victim");
   CompletableFuture<Void> append=store.append(record);record.getAsJsonObject("inventory").addProperty("changed",true);append.get(5,TimeUnit.SECONDS);
   JsonObject list=store.page("custom blade",0,25).get(5,TimeUnit.SECONDS);
   if(list.get("total").getAsInt()!=1||list.getAsJsonArray("entries").get(0).getAsJsonObject().has("inventory"))throw new AssertionError("Summaries search custom weapon names without exposing inventory");checks++;
   JsonObject detail=store.detail(id,true).get(5,TimeUnit.SECONDS);
   if(detail.getAsJsonObject("inventory").has("changed")||!detail.getAsJsonObject("weapon").get("name").getAsString().equals("Custom Blade"))throw new AssertionError("Immutable death snapshot must preserve custom weapon names");checks++;
   detail.addProperty("mutated",true);
   if(store.detail(id,false).get(5,TimeUnit.SECONDS).has("inventory")||store.detail(id,true).get(5,TimeUnit.SECONDS).has("mutated"))throw new AssertionError("Permission redaction and returned values must not mutate history");checks++;
   store.append(record(id,100,"Killer","Victim")).get(5,TimeUnit.SECONDS);
   if(store.page("",0,25).get(5,TimeUnit.SECONDS).get("total").getAsInt()!=1)throw new AssertionError("Duplicate event ID");checks++;
   store.append(record(UUID.randomUUID(),200,"Zombie","Second victim")).get(5,TimeUnit.SECONDS);
   JsonObject page=store.page("",0,1).get(5,TimeUnit.SECONDS);
   if(page.getAsJsonArray("entries").get(0).getAsJsonObject().get("at").getAsLong()!=200||store.page("",1,1).get(5,TimeUnit.SECONDS).getAsJsonArray("entries").size()!=1)throw new AssertionError("Newest-first pagination");checks++;
   store.close();Files.writeString(directory.resolve("300-"+UUID.randomUUID()+".json"),"broken");
   KillFeedStore restarted=new KillFeedStore(directory);
   if(restarted.page("Victim",0,25).get(5,TimeUnit.SECONDS).get("total").getAsInt()!=2||!restarted.detail(id,true).get(5,TimeUnit.SECONDS).has("inventory"))throw new AssertionError("History must survive restart and skip corrupt records");checks++;
   try{restarted.detail(UUID.randomUUID(),true).get(5,TimeUnit.SECONDS);throw new AssertionError("Unknown ID accepted");}
   catch(ExecutionException expected){if(!(expected.getCause() instanceof BridgeFailure failure)||failure.status!=404)throw expected;checks++;}
   restarted.close();
   for(int i=0;i<KillFeedStore.MAX_ENTRIES+1;i++){
    JsonObject value=record(UUID.randomUUID(),1000+i,"Mob","Victim");Files.writeString(directory.resolve(value.get("at").getAsLong()+"-"+value.get("id").getAsString()+".json"),value.toString());
   }
   KillFeedStore bounded=new KillFeedStore(directory);
   if(bounded.page("",0,1).get(10,TimeUnit.SECONDS).get("total").getAsInt()!=KillFeedStore.MAX_ENTRIES)throw new AssertionError("Bound history retention");checks++;
   bounded.close();return checks;
  }finally{try(var paths=Files.walk(directory)){for(Path path:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}}
 }
 static JsonObject record(UUID id,long at,String killer,String victim){
  JsonObject value=new JsonObject();value.addProperty("id",id.toString());value.addProperty("at",at);
  JsonObject k=new JsonObject();k.addProperty("name",killer);value.add("killer",k);
  JsonObject v=new JsonObject();v.addProperty("name",victim);value.add("victim",v);
  JsonObject weapon=new JsonObject();weapon.addProperty("name","Custom Blade");weapon.addProperty("customName","Custom Blade");weapon.addProperty("id","minecraft:diamond_sword");value.add("weapon",weapon);
  JsonObject inventory=new JsonObject();inventory.addProperty("capturedItem","Victim's armor at death");value.add("inventory",inventory);return value;
 }
}
