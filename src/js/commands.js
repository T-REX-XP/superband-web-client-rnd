/**
 * FitPro / "legacy MyWatch" command builders.
 *
 * Reconstructed from the SuperBand 1.10.04 Android APK (`com.legend.mywatch`
 * SDK): `SendData` + `Profile.PBSmartBandCommandId*`. These are the plain
 * `0xCD` frames used for settings, device control and sport toggles — the same
 * frame family the dial push (module 0x1F/0x20) and the live preview (0x27) use.
 *
 * Frame layout (`buildFitProFrame`):
 *   CD | u16BE(len-3) | module | 01 | cmd/key | u16BE(payloadLen) | payload
 *
 * Notable equivalences:
 *  - "value" frame  CD 00 09 12 01 01 00 04 <u32>   (e.g. sync time)
 *  - "no-value"     CD 00 05 12 01 19 00 00         (e.g. enter OTA mode)
 *  - "switch"       CD 00 06 12 01 0B 00 01 <v>     (e.g. find device)
 */

import { buildFitProFrame } from './fitpro.js';

/** Module / command-group IDs (offset 3 of a `0xCD` frame). */
export const Legacy = {
  Setting: 0x12,
  Binding: 0x13,
  Strapped: 0x14,
  Sport: 0x15,
  ResetDeviceV1: 0x16,
  MsgPushSwitch: 0x17,
  Alarm: 0x18,
  OtherSetInfo: 0x19,
  SetInfoByKey: 0x1a,
  TestMode: 0x1b,
  DeviceControl: 0x1c,
  DeviceReset: 0x1d,
  Factory: 0x1e,
  Dial: 0x1f,
  DialRead: 0x20,
  Game: 0x21,
  Private: 0x22,
  AIGadgets: 0x26,
  Preview: 0x27,
};

/** Module 0x12 sub-keys (`Profile.PBSmartBandCommandIdSettingKeyId`). */
export const SettingKey = {
  Shutdown: 0xfd, // -3
  HeartRate: 0xfe, // -2
  PhoneType: 0xff, // -1
  SyncTime: 1,
  AlarmClock: 2,
  StepTarget: 3,
  UserInfo: 4,
  LongSit: 5,
  HandSide: 6,
  CallRemind: 7,
  RaiseToWake: 8,
  BrightScreen: 9,
  IsPaired: 10,
  FindMe: 11,
  TakePhoto: 12,
  HeartSwitch: 13,
  BloodSwitch: 14,
  SleepSwitch: 15,
  TestDataSwitch: 16,
  CallPush: 17,
  MsgPush: 18,
  SyncContacts: 19,
  DisturbSwitch: 20,
  Language: 21,
  HeartAuto: 22,
  DeleteContact: 23,
  Measure: 24,
  EnterOtaMode: 25,
  EcgMeasure: 26,
  SpoSwitch: 27,
  Weather: 32,
  TempUnit: 33,
  SportTime: 34,
  StandTime: 35,
  GetHistoryCal: 36,
  TimerHeart: 37,
  SleepWarn: 38,
  TargetKcal: 39,
  DrinkWarn: 40,
  SosContact: 41,
  GestureControl: 42,
  PhoneImei: 43,
  OtaNum: 44,
  Pay: 45,
  AI: 46,
};

/** Module 0x1C sub-keys (`Profile.PBSmartBandCommandIdDeviceControlAppKeyId`). */
export const DeviceControlKey = {
  FindPhone: 1,
  TakePhoto: 2,
  OpenCamera: 3,
  ExitCamera: 4,
  ExitHeart: 5,
  ExitBlood: 6,
  HangUp: 7,
  ExitMeasure: 8,
  AnswerPhone: 9,
  SwitchUp: 10,
  SwitchPause: 11,
  SwitchDown: 12,
  ExitSpo: 13,
  StopFindPhone: 14,
  SyncTime: 15,
  GetImei: 16,
};

/** Module 0x15 sub-keys (`Profile.PBSmartBandCommandIdSportKeyId`, subset). */
export const SportKey = {
  Get: 1,
  RealtimeStepSwitch: 6,
  HistoryStart: 7,
  HistoryEnd: 8,
  GetDayDatas: 13,
};

function u32be(value) {
  const v = Number(value) >>> 0;
  return Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}

function u16be(value) {
  const v = Number(value) & 0xffff;
  return Uint8Array.of((v >>> 8) & 0xff, v & 0xff);
}

/**
 * Pack a JS Date into the vendor 32-bit "sync time" word.
 * v = sec | (year-2000)<<26 | month<<22 | day<<17 | hour<<12 | minute<<6
 */
export function packSyncTime(date = new Date()) {
  const sec = date.getSeconds() & 0x3f;
  const year = (date.getFullYear() - 2000) & 0x3f;
  const month = (date.getMonth() + 1) & 0x0f;
  const day = date.getDate() & 0x1f;
  const hour = date.getHours() & 0x1f;
  const minute = date.getMinutes() & 0x3f;
  const v = (((year << 26) | (month << 22) | (day << 17) | (hour << 12) | (minute << 6) | sec) >>> 0);
  return u32be(v);
}

/**
 * Generic helpers — mostly useful from the debug console.
 * `buildSwitch` is byte-identical to Android `SendData.SwitchProtocol`.
 */
export function buildSettingValue(key, payload = new Uint8Array(0)) {
  return buildFitProFrame(Legacy.Setting, key, payload);
}

export function buildSwitch(module, key, value) {
  return buildFitProFrame(module, key, Uint8Array.of(value & 0xff));
}

export function buildNoValue(module, key) {
  return buildFitProFrame(module, key);
}

// ── Concrete commands ────────────────────────────────────────────────────────

/** Module 0x12 key 1 — set the device clock to `date` (default: now). */
export function buildSyncTime(date = new Date()) {
  return buildSettingValue(SettingKey.SyncTime, packSyncTime(date));
}

/** Module 0x12 key 11 — find/vibrate the badge on or off. */
export function buildFindDevice(on = true) {
  return buildSwitch(Legacy.Setting, SettingKey.FindMe, on ? 1 : 0);
}

/** Module 0x12 key 3 — daily step goal. */
export function buildSetStepTarget(steps) {
  return buildSettingValue(SettingKey.StepTarget, u32be(steps));
}

/**
 * Module 0x12 key 4 — user profile.
 * v = sex<<31 | age<<24 | height(cm)<<15 | weight(kg)<<5
 */
export function buildSetUserInfo({ sex = 0, age = 30, heightCm = 170, weightKg = 70 } = {}) {
  const v =
    (((sex & 1) << 31) |
      ((age & 0x7f) << 24) |
      ((heightCm & 0x1ff) << 15) |
      ((weightKg & 0x3ff) << 5)) >>>
    0;
  return buildSettingValue(SettingKey.UserInfo, u32be(v));
}

/** Module 0x12 key 12 — remote photo page on the phone. */
export function buildTakePhoto(on = true) {
  return buildSwitch(Legacy.Setting, SettingKey.TakePhoto, on ? 1 : 0);
}

/** Module 0x12 key 25 — reboot the badge into firmware-update (OTA) mode. */
export function buildEnterOtaMode() {
  return buildNoValue(Legacy.Setting, SettingKey.EnterOtaMode);
}

/** Module 0x12 key -3 (0xFD) — power the badge off. */
export function buildShutdown() {
  return buildNoValue(Legacy.Setting, SettingKey.Shutdown);
}

/** Module 0x12 key 21 — display language index. */
export function buildSetLanguage(index) {
  return buildSwitch(Legacy.Setting, SettingKey.Language, index);
}

/** Module 0x12 key 20 — do-not-disturb window (start/end hours). */
export function buildDisturbSwitch(on, startHour = 22, endHour = 7) {
  return buildSettingValue(
    SettingKey.DisturbSwitch,
    Uint8Array.of(on ? 1 : 0, startHour & 0xff, endHour & 0xff),
  );
}

/** Module 0x15 key 6 — real-time step stream toggle. */
export function buildRealtimeStep(on = true) {
  return buildSwitch(Legacy.Sport, SportKey.RealtimeStepSwitch, on ? 1 : 0);
}

/** Module 0x1C — device/app control. Some keys take a value, most are no-value. */
export function buildDeviceControl(key, value = null) {
  if (value == null) return buildNoValue(Legacy.DeviceControl, key);
  return buildSwitch(Legacy.DeviceControl, key, value);
}

/** `CD 00 02 13 01` — bind / pair. */
export function buildBind() {
  return Uint8Array.of(0xcd, 0x00, 0x02, Legacy.Binding, 0x01);
}

/** `CD 00 02 1D 01` — factory / device reset. Destructive. */
export function buildDeviceReset() {
  return Uint8Array.of(0xcd, 0x00, 0x02, Legacy.DeviceReset, 0x01);
}

export const helpers = { u16be, u32be };
