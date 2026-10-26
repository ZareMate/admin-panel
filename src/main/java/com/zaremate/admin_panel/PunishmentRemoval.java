package com.zaremate.admin_panel;

import java.util.*;

/** Plans an exact-record removal before persistence or vanilla ban-list changes. */
final class PunishmentRemoval {
    record Entry(long id, String uuid, String offense, String removedBy, String type, boolean ipBased, String ip, boolean live) {}
    record Plan(Entry record, boolean clearBan) {}
    static Plan plan(List<Entry> records, long recordId, UUID player) {
        Entry selected = records.stream().filter(r -> r.id == recordId && player.toString().equals(r.uuid)).findFirst()
                .orElseThrow(() -> new BridgeFailure(409, "Punishment is missing"));
        if (selected.removedBy != null) throw new BridgeFailure(409, "Punishment already removed");
        if (selected.offense != null && !selected.offense.isBlank()) throw new BridgeFailure(409, "Remove the offense case instead");
        boolean clearBan = selected.type.equals("ban") && selected.live && records.stream().noneMatch(r ->
                r.id != selected.id && r.type.equals("ban") && r.live && r.ipBased == selected.ipBased
                && (selected.ipBased ? Objects.equals(r.ip, selected.ip) : Objects.equals(r.uuid, selected.uuid)));
        return new Plan(selected, clearBan);
    }
}
