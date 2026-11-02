package com.zaremate.tsa_anticheat.api;
public enum TsaSetting {
 WEBHOOK_URL(String.class), WEBHOOK_ENABLED(Boolean.class), LOGIN_CHECK_DELAY_SECONDS(Integer.class), FILENAME_DETECTION_KEYWORDS(java.util.List.class);
 private final Class<?> type;
 TsaSetting(Class<?> type){this.type=type;}
 public Class<?> valueType(){return type;}
 public Object validate(Object value){if(this==LOGIN_CHECK_DELAY_SECONDS&&((Integer)value<0||(Integer)value>300))throw new IllegalArgumentException("bad delay");return value;}
}
