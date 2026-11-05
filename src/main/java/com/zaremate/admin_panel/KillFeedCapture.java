package com.zaremate.admin_panel;

import com.google.gson.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.GameRules;
import java.util.UUID;

/** Called at uncancelled player death, before inventory drops, on the server thread. */
final class KillFeedCapture {
 static final class Snapshot {
  final JsonObject data=new JsonObject();final ItemNbtView.Capture nbt=new ItemNbtView.Capture();
  void item(JsonObject target,ItemStack stack,net.minecraft.core.HolderLookup.Provider registry){nbt.item(target,stack,registry);}
  JsonObject serialize(){nbt.apply();return data;}
 }
 static Snapshot capture(ServerPlayer victim,DamageSource source) {
  Snapshot snapshot=new Snapshot();JsonObject record=snapshot.data;record.addProperty("id",UUID.randomUUID().toString());record.addProperty("at",System.currentTimeMillis());
  record.add("victim",identity(victim));
  Entity killer=source.getEntity();boolean direct=killer!=null;if(killer==null)killer=victim.getKillCredit();
  record.add("killer",killer==null?JsonNull.INSTANCE:identity(killer));
  record.addProperty("attribution",direct?"damage-source":killer==null?"environment":"combat-credit");
  Entity projectile=source.getDirectEntity();if(projectile!=null&&projectile!=killer)record.add("directEntity",identity(projectile));
  record.addProperty("cause",source.typeHolder().unwrapKey().map(key->key.location().toString()).orElse(source.getMsgId()));
  record.addProperty("message",victim.getCombatTracker().getDeathMessage().getString());
  ItemStack sourceWeapon=source.getWeaponItem(),weapon=sourceWeapon==null?ItemStack.EMPTY:sourceWeapon.copy();
  JsonObject weaponView=InventoryData.item(weapon);snapshot.item(weaponView,weapon,victim.registryAccess());record.add("weapon",weaponView);
  record.addProperty("dimension",victim.level().dimension().location().toString());
  record.addProperty("x",victim.getX());record.addProperty("y",victim.getY());record.addProperty("z",victim.getZ());
  record.addProperty("keepInventory",victim.level().getGameRules().getBoolean(GameRules.RULE_KEEPINVENTORY));
  record.addProperty("experienceLevel",victim.experienceLevel);record.addProperty("totalExperience",victim.totalExperience);
  record.add("inventory",InventoryData.readDeath(victim,(view,stack)->snapshot.item(view,stack,victim.registryAccess())));return snapshot;
 }
 private static JsonObject identity(Entity entity){
  JsonObject result=new JsonObject();result.addProperty("uuid",entity.getUUID().toString());
  result.addProperty("name",entity instanceof ServerPlayer player?player.getGameProfile().getName():entity.getName().getString());
  result.addProperty("type",BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString());
  result.addProperty("player",entity instanceof ServerPlayer);return result;
 }
}
