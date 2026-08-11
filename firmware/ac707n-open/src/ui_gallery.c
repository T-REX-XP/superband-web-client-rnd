/**
 * Stage-2 stub: multi-page image gallery.
 * Replace storage hooks with NOR/FS when the AC707N SDK is linked.
 */
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#ifndef UI_GALLERY_MAX_FACES
#define UI_GALLERY_MAX_FACES 8
#endif

typedef struct {
  uint32_t id;
  uint16_t w;
  uint16_t h;
  uint8_t dial_type; /* 0 RGB565, 2 JPEG */
  const uint8_t *pixels; /* opaque pointer into NOR mapping */
  size_t nbytes;
} ui_face_t;

typedef struct {
  ui_face_t faces[UI_GALLERY_MAX_FACES];
  size_t count;
  size_t index;
} ui_gallery_t;

void ui_gallery_init(ui_gallery_t *g) {
  if (!g) return;
  g->count = 0;
  g->index = 0;
}

bool ui_gallery_add(ui_gallery_t *g, uint32_t id, uint16_t w, uint16_t h, uint8_t dial_type,
                    const uint8_t *pixels, size_t nbytes) {
  if (!g || g->count >= UI_GALLERY_MAX_FACES || !pixels || !nbytes) return false;
  ui_face_t *f = &g->faces[g->count++];
  f->id = id;
  f->w = w;
  f->h = h;
  f->dial_type = dial_type;
  f->pixels = pixels;
  f->nbytes = nbytes;
  g->index = g->count - 1;
  return true;
}

const ui_face_t *ui_gallery_current(const ui_gallery_t *g) {
  if (!g || !g->count) return NULL;
  return &g->faces[g->index % g->count];
}

void ui_gallery_next(ui_gallery_t *g) {
  if (!g || !g->count) return;
  g->index = (g->index + 1) % g->count;
}

void ui_gallery_prev(ui_gallery_t *g) {
  if (!g || !g->count) return;
  g->index = (g->index + g->count - 1) % g->count;
}

/* Platform: CST816D swipe → next/prev; lcd blit of current face. */
void ui_gallery_on_swipe(ui_gallery_t *g, int dx) {
  if (dx > 20) ui_gallery_prev(g);
  else if (dx < -20) ui_gallery_next(g);
}
