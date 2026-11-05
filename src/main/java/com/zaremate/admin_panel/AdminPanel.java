package com.zaremate.admin_panel;

import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import org.slf4j.LoggerFactory;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

@Mod("admin_panel")
public final class AdminPanel {
    private BridgeClient bridge;
    private KillFeedStore killFeed;
    public AdminPanel() {
        NeoForge.EVENT_BUS.addListener(this::start);
        NeoForge.EVENT_BUS.addListener(this::stop);
        NeoForge.EVENT_BUS.addListener(this::joined);
        NeoForge.EVENT_BUS.addListener(this::left);
        NeoForge.EVENT_BUS.addListener(net.neoforged.bus.api.EventPriority.HIGHEST,false,this::died);
    }
    private void start(ServerStartedEvent event) {
        try {
            var path = event.getServer().getServerDirectory().resolve("config/admin-panel-bridge.properties");
            BridgeConfig config = BridgeConfig.load(path);
            if (config == null) {
                LoggerFactory.getLogger("admin_panel").info("Panel bridge disabled or not configured at {}. No HTTP listener is started in Minecraft.", path);
                return;
            }
            LoggerFactory.getLogger("admin_panel").info("Starting panel bridge to {}", config.url());
            killFeed=new KillFeedStore(event.getServer().getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT).resolve("admin-panel-kill-feed"));
            bridge = new BridgeClient(config, new MinecraftBackend(event.getServer(),killFeed));
            bridge.start();
        } catch (Exception e) { LoggerFactory.getLogger("admin_panel").error("Panel bridge could not start", e); }
    }
    private void died(net.neoforged.neoforge.event.entity.living.LivingDeathEvent event) {
        if(killFeed==null||!(event.getEntity() instanceof net.minecraft.server.level.ServerPlayer victim))return;
        try {
            // Freeze items early; wait until event dispatch finishes before checking cancellation.
            var snapshot=KillFeedCapture.capture(victim,event.getSource());var store=killFeed;
            victim.getServer().tell(new net.minecraft.server.TickTask(victim.getServer().getTickCount(),()->{
                if(!event.isCanceled())store.append(snapshot).exceptionally(error->{
                    LoggerFactory.getLogger("admin_panel").error("Could not persist kill-feed death snapshot",error);return null;
                });
            }));
        }catch(RuntimeException error){LoggerFactory.getLogger("admin_panel").error("Could not capture kill-feed death snapshot",error);}
    }

    private void joined(PlayerEvent.PlayerLoggedInEvent event) { if (bridge != null) bridge.requestPublish(); }
    private void left(PlayerEvent.PlayerLoggedOutEvent event) { if (bridge != null) bridge.requestPublish(); }
    private void stop(ServerStoppingEvent event) { if (bridge != null) { bridge.close(); bridge = null; } if(killFeed!=null){killFeed.close();killFeed=null;} }
}
