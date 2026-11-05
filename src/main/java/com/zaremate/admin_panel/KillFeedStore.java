package com.zaremate.admin_panel;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Single ordered worker owns history, JSON serialization and all disk I/O. */
final class KillFeedStore implements AutoCloseable {
    static final int MAX_ENTRIES=2000;
    private static final long MAX_BYTES=64L*1024*1024,MAX_RECORD_BYTES=8L*1024*1024;
    private final Path directory;
    private final ExecutorService worker=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(512),task->{
        Thread thread=new Thread(task,"admin-panel-kill-feed");thread.setDaemon(true);return thread;
    },new ThreadPoolExecutor.AbortPolicy());
    private record Entry(JsonObject data,Path file,long size) {}
    private final Map<String,Entry> entries=new LinkedHashMap<>();
    private boolean loaded;
    KillFeedStore(Path directory){this.directory=directory;}
    private <T> CompletableFuture<T> submit(Callable<T> work) {
        CompletableFuture<T> future=new CompletableFuture<>();
        try{worker.execute(()->{try{load();future.complete(work.call());}catch(Exception error){future.completeExceptionally(error);}});}
        catch(RejectedExecutionException error){future.completeExceptionally(error);}return future;
    }
    CompletableFuture<Void> append(JsonObject captured) {
        JsonObject copy=captured.deepCopy();
        return submit(()->{
            persist(copy);return null;
        });
    }
    CompletableFuture<Void> append(KillFeedCapture.Snapshot snapshot){return submit(()->{persist(snapshot.serialize());return null;});}
    private void persist(JsonObject copy) throws Exception {
        String id=UUID.fromString(copy.get("id").getAsString()).toString();
        if(entries.containsKey(id))return;
        byte[] bytes=copy.toString().getBytes(StandardCharsets.UTF_8);
        if(bytes.length>MAX_RECORD_BYTES)throw new java.io.IOException("Death snapshot exceeds 8 MiB");
        Files.createDirectories(directory);
        Path file=directory.resolve(copy.get("at").getAsLong()+"-"+id+".json"),temporary=directory.resolve(id+".tmp");
        try{Files.write(temporary,bytes);Files.move(temporary,file,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}
        finally{Files.deleteIfExists(temporary);}
        entries.put(id,new Entry(copy,file,bytes.length));prune();
    }

    CompletableFuture<JsonObject> page(String query,int offset,int limit) {
        return submit(()->{
            String search=query.toLowerCase(Locale.ROOT);
            List<Entry> matched=ordered().stream().filter(entry->{
                JsonObject summary=summary(entry.data());return summary.toString().toLowerCase(Locale.ROOT).contains(search);
            }).toList();
            JsonArray rows=new JsonArray();matched.stream().skip(offset).limit(limit).forEach(entry->rows.add(summary(entry.data())));
            JsonObject result=new JsonObject();result.add("entries",rows);result.addProperty("total",matched.size());
            result.addProperty("offset",offset);result.addProperty("limit",limit);return result;
        });
    }
    CompletableFuture<JsonObject> detail(UUID id,boolean inventory) {
        return submit(()->{
            Entry entry=entries.get(id.toString());if(entry==null)throw new BridgeFailure(404,"Kill-feed entry not found");
            JsonObject result=entry.data().deepCopy();if(!inventory)result.remove("inventory");return result;
        });
    }
    private static JsonObject summary(JsonObject data){
        JsonObject copy=new JsonObject();
        for(var entry:data.entrySet())if(!entry.getKey().equals("inventory")&&!entry.getKey().equals("weapon"))copy.add(entry.getKey(),entry.getValue().deepCopy());
        JsonObject weapon=new JsonObject(),source=data.getAsJsonObject("weapon");
        if(source!=null)for(String key:List.of("empty","id","name","customName","count"))if(source.has(key))weapon.add(key,source.get(key).deepCopy());
        copy.add("weapon",weapon);return copy;
    }
    private List<Entry> ordered(){return entries.values().stream().sorted(Comparator.<Entry>comparingLong(entry->entry.data().get("at").getAsLong()).reversed().thenComparing(entry->entry.data().get("id").getAsString())).toList();}
    private void load() throws Exception {
        if(loaded)return;Files.createDirectories(directory);
        try(var files=Files.list(directory)){
            for(Path file:files.filter(path->path.getFileName().toString().matches("[0-9]+-[0-9a-f-]{36}\\.json")).sorted(Comparator.reverseOrder()).toList()) {
                try {
                    long size=Files.size(file);if(size>MAX_RECORD_BYTES)continue;
                    JsonObject data=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
                    String id=UUID.fromString(data.get("id").getAsString()).toString();data.get("at").getAsLong();
                    entries.putIfAbsent(id,new Entry(data,file,size));
                }catch(java.io.IOException|RuntimeException error){org.slf4j.LoggerFactory.getLogger("admin_panel").warn("Could not read kill-feed record {}",file);}
            }
        }
        prune();loaded=true;
    }
    private void prune() throws Exception {
        long bytes=0;int count=0;
        for(Entry entry:ordered()){
            bytes+=entry.size();count++;
            if(count>MAX_ENTRIES||bytes>MAX_BYTES){Files.deleteIfExists(entry.file());entries.remove(entry.data().get("id").getAsString());}
        }
    }
    public void close(){worker.shutdown();}
}
