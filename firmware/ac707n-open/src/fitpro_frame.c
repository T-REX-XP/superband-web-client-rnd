#include "fitpro_dial.h"

#include <string.h>

uint32_t fitpro_byte_sum(const uint8_t *data, size_t len) {
  uint32_t s = 0;
  for (size_t i = 0; i < len; i++) s += data[i];
  return s;
}

static void put_u16be(uint8_t *p, uint16_t v) {
  p[0] = (uint8_t)(v >> 8);
  p[1] = (uint8_t)(v & 0xff);
}

static uint16_t get_u16be(const uint8_t *p) {
  return (uint16_t)((p[0] << 8) | p[1]);
}

size_t fitpro_build_frame(uint8_t *out, size_t out_cap, uint8_t module, uint8_t cmd,
                          const uint8_t *payload, uint16_t payload_len) {
  size_t total = 8u + (size_t)payload_len;
  if (!out || out_cap < total) return 0;
  out[0] = FITPRO_START;
  put_u16be(out + 1, (uint16_t)(total - 3));
  out[3] = module;
  out[4] = 0x01;
  out[5] = cmd;
  put_u16be(out + 6, payload_len);
  if (payload_len && payload) memcpy(out + 8, payload, payload_len);
  return total;
}

void fitpro_rx_reset(fitpro_rx_t *rx) {
  if (!rx) return;
  rx->len = 0;
  rx->need = 0;
}

bool fitpro_rx_byte(fitpro_rx_t *rx, uint8_t b, fitpro_frame_t *out) {
  if (!rx || !out) return false;
  if (rx->len == 0) {
    if (b != FITPRO_START) return false;
    rx->buf[0] = b;
    rx->len = 1;
    rx->need = 3; /* need lenBE */
    return false;
  }
  if (rx->len >= FITPRO_MAX_FRAME) {
    fitpro_rx_reset(rx);
    return false;
  }
  rx->buf[rx->len++] = b;
  if (rx->len == 3) {
    uint16_t body = get_u16be(rx->buf + 1);
    rx->need = 3u + (size_t)body;
    if (rx->need > FITPRO_MAX_FRAME || rx->need < 8) {
      fitpro_rx_reset(rx);
      return false;
    }
  }
  if (rx->need && rx->len >= rx->need) {
    out->module = rx->buf[3];
    out->cmd = rx->buf[5];
    out->payload_len = get_u16be(rx->buf + 6);
    out->payload = rx->buf + 8;
    if (8u + out->payload_len > rx->len) {
      fitpro_rx_reset(rx);
      return false;
    }
    fitpro_rx_reset(rx);
    return true;
  }
  return false;
}
