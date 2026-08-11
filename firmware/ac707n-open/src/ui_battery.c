/**
 * Stage-2 stub: charge / battery reporting for dial reject (status 4) + UI.
 */
#include <stdint.h>
#include <stdbool.h>

typedef struct {
  uint8_t percent; /* 0..100 */
  bool charging;
  bool present;
} ui_battery_t;

void ui_battery_init(ui_battery_t *b) {
  if (!b) return;
  b->percent = 100;
  b->charging = false;
  b->present = true;
}

void ui_battery_update(ui_battery_t *b, uint8_t percent, bool charging) {
  if (!b) return;
  b->percent = percent > 100 ? 100 : percent;
  b->charging = charging;
  b->present = true;
}

/** FitPro dial upgrade should refuse while powered (stock status 4). */
bool ui_battery_blocks_dial_upgrade(const ui_battery_t *b) {
  return b && b->charging;
}

bool ui_battery_too_low(const ui_battery_t *b, uint8_t min_percent) {
  return b && b->present && b->percent < min_percent;
}
