package com.zaremate.admin_panel;
import com.google.gson.*;
import net.minecraft.nbt.*;
final class ItemNbtViewTest {
 static int run(){
  CompoundTag root=new CompoundTag(),components=new CompoundTag();
  components.putString("minecraft:custom_name","<img src=x onerror=alert(1)>");
  components.putLong("precise",Long.MAX_VALUE);components.putIntArray("numbers",new int[]{1,-2,3});
  ListTag children=new ListTag();CompoundTag nested=new CompoundTag();nested.putString("id","minecraft:diamond");children.add(nested);
  components.put("minecraft:container",children);root.put("components",components);root.putString("id","minecraft:chest");
  JsonObject view=ItemNbtView.convert(root,new ItemNbtView.Budget());
  if(!view.get("type").getAsString().equals("compound"))throw new AssertionError("Typed NBT root");
  JsonObject values=view.getAsJsonObject("value").getAsJsonObject("components").getAsJsonObject("value");
  if(!values.getAsJsonObject("precise").get("value").getAsString().contains(Long.toString(Long.MAX_VALUE)))throw new AssertionError("Long precision must not be lost in JSON numbers");
  if(!values.getAsJsonObject("minecraft:custom_name").get("value").getAsString().equals("<img src=x onerror=alert(1)>"))throw new AssertionError("String content must be preserved as data");
  if(!values.getAsJsonObject("numbers").get("type").getAsString().equals("int_array")||values.getAsJsonObject("numbers").getAsJsonArray("value").size()!=3)throw new AssertionError("NBT arrays retain their type");
  if(!values.getAsJsonObject("minecraft:container").getAsJsonArray("value").get(0).getAsJsonObject().getAsJsonObject("value").getAsJsonObject("id").get("value").getAsString().equals("minecraft:diamond"))throw new AssertionError("Nested container items");
  ItemNbtView.Budget bounded=new ItemNbtView.Budget();bounded.remaining=1;
  if(!ItemNbtView.convert(root,bounded).get("truncated").getAsBoolean())throw new AssertionError("Bound large NBT snapshots explicitly");
  return 6;
 }
}
