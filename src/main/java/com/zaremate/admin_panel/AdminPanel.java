package com.zaremate.admin_panel;

import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import org.slf4j.LoggerFactory;

@Mod("admin_panel")
public final class AdminPanel {
    private BridgeClient bridge;
    public AdminPanel() {
        NeoForge.EVENT_BUS.addListener(this::start);
        NeoForge.EVENT_BUS.addListener(this::stop);
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
            bridge = new BridgeClient(config, new MinecraftBackend(event.getServer()));
            bridge.start();
        } catch (Exception e) { LoggerFactory.getLogger("admin_panel").error("Panel bridge could not start", e); }
    }
    private void stop(ServerStoppingEvent event) { if (bridge != null) { bridge.close(); bridge = null; } }
}
