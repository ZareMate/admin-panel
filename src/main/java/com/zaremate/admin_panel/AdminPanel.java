package com.zaremate.admin_panel;

import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import org.slf4j.LoggerFactory;

@Mod("admin_panel")
public final class AdminPanel {
    private PanelServer panel;
    public AdminPanel() {
        NeoForge.EVENT_BUS.addListener(this::start);
        NeoForge.EVENT_BUS.addListener(this::stop);
    }
    private void start(ServerStartedEvent event) {
        try {
            var root = event.getServer().getServerDirectory();
            Config config = Config.load(root.resolve("config/admin-panel.properties"));
            if (config == null) { LoggerFactory.getLogger("admin_panel").info("Web panel disabled. Configure config/admin-panel.properties to enable."); return; }
            panel = new PanelServer(config, new MinecraftBackend(event.getServer()), new Audit(root.resolve("logs/admin-panel-audit.jsonl")));
            panel.start();
            LoggerFactory.getLogger("admin_panel").info("Admin Panel listening on {}:{} (origin {})", config.bind(), config.port(), config.origin());
        } catch (Exception e) { LoggerFactory.getLogger("admin_panel").error("Admin Panel could not start", e); }
    }
    private void stop(ServerStoppingEvent event) { if (panel != null) { panel.close(); panel = null; } }
}
