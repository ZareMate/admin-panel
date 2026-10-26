package com.zaremate.admin_panel;

import java.util.Set;
import java.util.UUID;

/** Identity and explicit permission snapshot supplied by the authenticated web host. */
record StaffActor(String name, UUID uuid, String rank, Set<String> permissions) {
    StaffActor { permissions = Set.copyOf(permissions); }
    boolean has(String permission) { return permissions.contains(permission); }
    void require(String permission) {
        if (!has(permission)) throw new BridgeFailure(403, "Permission required: " + permission);
    }
}
