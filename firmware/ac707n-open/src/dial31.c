#include "fitpro_dial.h"

#include <string.h>

static void put_u16be(uint8_t *p, uint16_t v) {
  p[0] = (uint8_t)(v >> 8);
  p[1] = (uint8_t)(v & 0xff);
}

static void put_u32be(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)(v >> 24);
  p[1] = (uint8_t)(v >> 16);
  p[2] = (uint8_t)(v >> 8);
  p[3] = (uint8_t)(v & 0xff);
}

static uint16_t get_u16be(const uint8_t *p) {
  return (uint16_t)((p[0] << 8) | p[1]);
}

static uint32_t get_u32be(const uint8_t *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}

static void emit_status(fitpro_tx_fn tx, void *user, uint32_t code) {
  uint8_t payload[4];
  uint8_t frame[16];
  put_u32be(payload, code);
  size_t n = fitpro_build_frame(frame, sizeof frame, FITPRO_INFO_MODULE, FITPRO_INFO_STATUS, payload, 4);
  if (n && tx) tx(frame, n, user);
}

void dial31_init(dial31_t *d) {
  if (!d) return;
  memset(d, 0, sizeof *d);
}

void dial31_set_blob_buf(dial31_t *d, uint8_t *buf, size_t cap) {
  if (!d) return;
  d->blob = buf;
  d->blob_cap = cap;
}

size_t dial31_build_info_payload(uint8_t *out, size_t cap, uint16_t short_pkg) {
  /* Minimal ClockDialInfo-compatible payload: 360×360, algorithm 0, shortPkg. */
  static const char mch[] = "BJ-1";
  static const char main[] = "LJ733";
  size_t need = 6 + 1 + sizeof(mch) - 1 + 1 + sizeof(main) - 1 + 2 /* config+alg */
                + 5 + 1 /* customer len 0 + pad to i13 */ + 1 + 1 + 2 + 2;
  /* Layout matching src/js/fitpro.js parseDialInfo best-effort offsets. */
  if (!out || cap < 32) return 0;
  size_t o = 0;
  out[o++] = 1; /* screenType */
  out[o++] = 0; /* grade */
  put_u16be(out + o, FITPRO_DEFAULT_W);
  o += 2;
  put_u16be(out + o, FITPRO_DEFAULT_H);
  o += 2;
  out[o++] = (uint8_t)(sizeof(mch) - 1);
  memcpy(out + o, mch, sizeof(mch) - 1);
  o += sizeof(mch) - 1;
  out[o++] = (uint8_t)(sizeof(main) - 1);
  memcpy(out + o, main, sizeof(main) - 1);
  o += sizeof(main) - 1;
  out[o++] = 0; /* config */
  out[o++] = 0; /* algorithm 0 → RGB565 */
  /* versionCode(4) + customerLen @ i12 */
  out[o++] = 0;
  out[o++] = 0;
  out[o++] = 0;
  out[o++] = 0;
  out[o++] = 0; /* filler to keep i12 = i6+5 */
  out[o++] = 0; /* customerLen */
  out[o++] = 0; /* ? */
  out[o++] = 1; /* pictureNums */
  put_u16be(out + o, 1);
  o += 2; /* themeVersion */
  put_u16be(out + o, short_pkg ? short_pkg : FITPRO_DEFAULT_CHUNK);
  o += 2;
  (void)need;
  return o;
}

static void handle_info(dial31_t *d, const fitpro_frame_t *fr, fitpro_tx_fn tx, void *user) {
  (void)d;
  (void)fr;
  uint8_t payload[64];
  uint8_t frame[80];
  size_t plen = dial31_build_info_payload(payload, sizeof payload, FITPRO_DEFAULT_CHUNK);
  size_t n = fitpro_build_frame(frame, sizeof frame, FITPRO_INFO_MODULE, FITPRO_INFO_INFO, payload,
                                (uint16_t)plen);
  if (n && tx) tx(frame, n, user);
}

static void handle_start(dial31_t *d, const fitpro_frame_t *fr, fitpro_tx_fn tx, void *user) {
  if (!d || !fr || fr->payload_len < 14) {
    emit_status(tx, user, FITPRO_STATUS_CHECK_FAIL);
    return;
  }
  if (d->charging) {
    emit_status(tx, user, FITPRO_STATUS_CHARGING);
    return;
  }
  const uint8_t *p = fr->payload;
  d->dial_id = get_u32be(p);
  d->dial_type = p[4];
  d->flags = p[5];
  d->expect_size = get_u32be(p + 9);
  if (!d->blob || d->expect_size == 0 || d->expect_size > d->blob_cap) {
    emit_status(tx, user, 5); /* insufficient storage */
    return;
  }
  d->active = true;
  d->received = 0;
  d->blob_sum = 0;
  d->next_seq = 1;
  emit_status(tx, user, FITPRO_STATUS_CHUNK_BASE); /* 1000 */
}

static void handle_data(dial31_t *d, const fitpro_frame_t *fr, fitpro_tx_fn tx, void *user) {
  if (!d || !d->active || !fr || fr->payload_len < 6) {
    emit_status(tx, user, FITPRO_STATUS_CHECK_FAIL);
    return;
  }
  uint16_t seq = get_u16be(fr->payload);
  uint16_t chunk_len = (uint16_t)(fr->payload_len - 6);
  const uint8_t *chunk = fr->payload + 2;
  uint32_t declared = get_u32be(fr->payload + 2 + chunk_len);
  /* checksum over seq‖chunk (same as src/js/fitpro.js fitproByteSum) */
  uint32_t sum = fitpro_byte_sum(fr->payload, (size_t)(2 + chunk_len));
  if (sum != declared || seq != d->next_seq) {
    emit_status(tx, user, FITPRO_STATUS_CHECK_FAIL);
    d->active = false;
    return;
  }
  if (d->received + chunk_len > d->expect_size) {
    emit_status(tx, user, FITPRO_STATUS_CHECK_FAIL);
    d->active = false;
    return;
  }
  memcpy(d->blob + d->received, chunk, chunk_len);
  d->received += chunk_len;
  d->next_seq++;
  emit_status(tx, user, (uint32_t)(FITPRO_STATUS_CHUNK_BASE + seq));
}

static void handle_finish(dial31_t *d, const fitpro_frame_t *fr, fitpro_tx_fn tx, void *user) {
  if (!d || !d->active || !fr || fr->payload_len < 4) {
    emit_status(tx, user, FITPRO_STATUS_CHECK_FAIL);
    return;
  }
  uint32_t want = get_u32be(fr->payload);
  uint32_t got = fitpro_byte_sum(d->blob, d->received);
  if (want != got || d->received != d->expect_size) {
    emit_status(tx, user, FITPRO_STATUS_CHECK_FAIL);
    d->active = false;
    return;
  }
  d->blob_sum = got;
  d->active = false;
  /* Platform hook: decode RGB565 type0 / JPEG type2 and show face — SDK layer. */
  emit_status(tx, user, FITPRO_STATUS_OK);
}

void dial31_on_frame(dial31_t *d, const fitpro_frame_t *fr, fitpro_tx_fn tx, void *user) {
  if (!d || !fr) return;
  if (fr->module == FITPRO_INFO_MODULE) {
    if (fr->cmd == FITPRO_INFO_INFO) handle_info(d, fr, tx, user);
    else if (fr->cmd == FITPRO_INFO_STATUS) {
      /* Host poll — reply idle OK / in-progress next_seq band if desired. */
      emit_status(tx, user, d->active ? (uint32_t)(FITPRO_STATUS_CHUNK_BASE + d->next_seq - 1)
                                      : FITPRO_STATUS_OK);
    }
    return;
  }
  if (fr->module != FITPRO_DIAL_MODULE) return;
  switch (fr->cmd) {
    case FITPRO_CMD_START:
      handle_start(d, fr, tx, user);
      break;
    case FITPRO_CMD_DATA:
      handle_data(d, fr, tx, user);
      break;
    case FITPRO_CMD_FINISH:
      handle_finish(d, fr, tx, user);
      break;
    default:
      break;
  }
}
