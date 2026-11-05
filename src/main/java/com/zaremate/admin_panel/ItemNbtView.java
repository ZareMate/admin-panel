package com.zaremate.admin_panel;
import com.google.gson.*;
import net.minecraft.nbt.*;

/** Worker-side typed NBT view; numbers remain strings to preserve long precision. */
final class ItemNbtView {
 private record Item(JsonObject target,Tag data) {}
 static final class Capture {
  private final java.util.List<Item> items=new java.util.ArrayList<>();
  void item(JsonObject target,net.minecraft.world.item.ItemStack stack,net.minecraft.core.HolderLookup.Provider registry){
   if(stack.isEmpty())return;
   try{items.add(new Item(target,stack.save(registry)));}
   catch(RuntimeException error){target.addProperty("nbtError","Item NBT could not be encoded for this snapshot");}
  }
  void apply(){var budget=new Budget();for(var item:items)item.target().add("nbt",convert(item.data(),budget));}
 }
 static final class Budget {int remaining=50000;}
 static JsonObject convert(Tag tag,Budget budget){return convert(tag,budget,0);}
 private static JsonObject convert(Tag tag,Budget budget,int depth){
  JsonObject result=new JsonObject();
  String type=switch(tag.getId()){
   case Tag.TAG_COMPOUND->"compound";case Tag.TAG_LIST->"list";case Tag.TAG_BYTE_ARRAY->"byte_array";
   case Tag.TAG_INT_ARRAY->"int_array";case Tag.TAG_LONG_ARRAY->"long_array";case Tag.TAG_STRING->"string";
   case Tag.TAG_BYTE->"byte";case Tag.TAG_SHORT->"short";case Tag.TAG_INT->"int";case Tag.TAG_LONG->"long";
   case Tag.TAG_FLOAT->"float";case Tag.TAG_DOUBLE->"double";default->"end";
  };
  result.addProperty("type",type);
  if(depth>=64||budget.remaining--<=0){result.addProperty("truncated",true);result.addProperty("value","NBT snapshot limit reached");return result;}
  if(tag instanceof CompoundTag compound){
   JsonObject values=new JsonObject();
   for(String key:compound.getAllKeys().stream().sorted().toList()){
    if(budget.remaining<=0){result.addProperty("truncated",true);break;}
    values.add(key,convert(compound.get(key),budget,depth+1));
   }
   result.add("value",values);
  }else if(tag instanceof CollectionTag<?> collection){
   JsonArray values=new JsonArray();
   for(int i=0;i<collection.size();i++){
    if(budget.remaining<=0){result.addProperty("truncated",true);break;}
    values.add(convert(collection.get(i),budget,depth+1));
   }
   result.add("value",values);
  }else result.addProperty("value",tag.getAsString());
  return result;
 }
}
