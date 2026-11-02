package com.zaremate.tsa_anticheat.api;
import java.util.*;
import java.util.concurrent.*;
public final class TsaAnticheatAPI {
 private static final Map<TsaSetting,Object> values=new LinkedHashMap<>();
 static {values.put(TsaSetting.WEBHOOK_URL,"https://discord.example/private-secret");values.put(TsaSetting.WEBHOOK_ENABLED,true);values.put(TsaSetting.LOGIN_CHECK_DELAY_SECONDS,5);values.put(TsaSetting.FILENAME_DETECTION_KEYWORDS,List.of("xray"));}
 public static CompletableFuture<Map<TsaSetting,Object>> getSettingsAsync(){return CompletableFuture.completedFuture(Map.copyOf(values));}
 public static CompletableFuture<Boolean> setSettingAsync(TsaSetting setting,Object value){setting.validate(value);values.put(setting,value);return CompletableFuture.completedFuture(true);}
 private static final Map<HashList,Set<String>> hashes=new EnumMap<>(HashList.class);
 private static final Set<String> names=new TreeSet<>();
 public static CompletableFuture<Set<String>> getHashesAsync(HashList list){return CompletableFuture.completedFuture(Set.copyOf(hashes.computeIfAbsent(list,k->new TreeSet<>())));}
 public static CompletableFuture<Boolean> addHashAsync(HashList list,String hash){return editHash(list,hash,true);}
 public static CompletableFuture<Boolean> removeHashAsync(HashList list,String hash){return editHash(list,hash,false);}
 private static CompletableFuture<Boolean> editHash(HashList list,String hash,boolean add){hash=hash.toLowerCase();if(!hash.matches("[a-f0-9]{64}"))return CompletableFuture.failedFuture(new IllegalArgumentException("bad hash"));var set=hashes.computeIfAbsent(list,k->new TreeSet<>());return CompletableFuture.completedFuture(add?set.add(hash):set.remove(hash));}
 public static CompletableFuture<Set<String>> getAllowedFilenamesAsync(){return CompletableFuture.completedFuture(Set.copyOf(names));}
 public static CompletableFuture<Boolean> addAllowedFilenameAsync(String name){return CompletableFuture.completedFuture(names.add(name));}
 public static CompletableFuture<Boolean> removeAllowedFilenameAsync(String name){return CompletableFuture.completedFuture(names.remove(name));}
 public record LookupEntry(String hash,String type,String filename) {}
 public static CompletableFuture<java.util.List<LookupEntry>> lookupHashAsync(String hash){return CompletableFuture.completedFuture(java.util.List.of(new LookupEntry(hash.toLowerCase(),"MOD","observed.jar")));}
 public record InventoryEntry(String hash,String name,String type) {}
 public record InventorySnapshot(java.util.UUID playerUuid, java.time.Instant scannedAt, java.util.List<InventoryEntry> files, int failures) {}
 public static Map<java.util.UUID,InventorySnapshot> getInventories(){return Map.of(java.util.UUID.fromString("00000000-0000-0000-0000-000000000001"),new InventorySnapshot(java.util.UUID.fromString("00000000-0000-0000-0000-000000000001"),java.time.Instant.now(),java.util.List.of(new InventoryEntry("c".repeat(64),"unlisted.jar","MOD")),0));}
}
