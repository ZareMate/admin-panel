package com.zaremate.admin_panel;

/** A safe status/message to return over the bridge without exposing a stack trace. */
final class BridgeFailure extends RuntimeException {
    final int status;
    BridgeFailure(int status, String message) { super(message); this.status = status; }
}
