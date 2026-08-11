#ifndef SUPERBAND_FITPRO_DIAL_H
#define SUPERBAND_FITPRO_DIAL_H

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
  FITPRO_START = 0xCD,
  FITPRO_DIAL_MODULE = 0x1F,
  FITPRO_INFO_MODULE = 0x20,
  FITPRO_LEGACY_MODULE = 0x1A,
  FITPRO_CMD_DATA = 1,
  FITPRO_CMD_START = 2,
  FITPRO_CMD_FINISH = 3,
  FITPRO_INFO_STATUS = 1,
  FITPRO_INFO_INFO = 2,
  FITPRO_STATUS_CHUNK_BASE = 1000,
  FITPRO_STATUS_OK = 2,
  FITPRO_STATUS_CHECK_FAIL = 1,
  FITPRO_STATUS_CHARGING = 4,
  FITPRO_PICTURE_DIAL_ID = 5538,
  FITPRO_MAX_FRAME = 256,
  FITPRO_DEFAULT_CHUNK = 180,
  FITPRO_DEFAULT_W = 360,
  FITPRO_DEFAULT_H = 360,
};

typedef struct {
  uint8_t module;
  uint8_t cmd;
  const uint8_t *payload;
  uint16_t payload_len;
} fitpro_frame_t;

typedef struct {
  uint8_t buf[FITPRO_MAX_FRAME];
  size_t len;
  size_t need; /* 0 = waiting for header */
} fitpro_rx_t;

typedef struct {
  bool active;
  uint32_t dial_id;
  uint8_t dial_type;
  uint8_t flags;
  uint32_t expect_size;
  uint32_t received;
  uint32_t blob_sum;
  uint16_t next_seq;
  uint8_t *blob; /* caller-owned buffer of expect_size */
  size_t blob_cap;
  bool charging; /* Stage-2: reject with status 4 when true */
} dial31_t;

typedef void (*fitpro_tx_fn)(const uint8_t *frame, size_t len, void *user);

uint32_t fitpro_byte_sum(const uint8_t *data, size_t len);
size_t fitpro_build_frame(uint8_t *out, size_t out_cap, uint8_t module, uint8_t cmd,
                          const uint8_t *payload, uint16_t payload_len);
void fitpro_rx_reset(fitpro_rx_t *rx);
/** Feed one UART/GATT byte; returns true when a full frame is in rx->buf. */
bool fitpro_rx_byte(fitpro_rx_t *rx, uint8_t b, fitpro_frame_t *out);

void dial31_init(dial31_t *d);
void dial31_set_blob_buf(dial31_t *d, uint8_t *buf, size_t cap);
/** Handle one parsed FitPro frame; may call tx with status responses. */
void dial31_on_frame(dial31_t *d, const fitpro_frame_t *fr, fitpro_tx_fn tx, void *user);
/** Build dial-info response payload (algorithm 0 / RGB565, 360×360 defaults). */
size_t dial31_build_info_payload(uint8_t *out, size_t cap, uint16_t short_pkg);

#ifdef __cplusplus
}
#endif

#endif
