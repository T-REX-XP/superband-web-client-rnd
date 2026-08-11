/**
 * Serve the production dist/ folder locally (simulates GitHub Pages).
 * Usage: bun run build && bun run preview:dist
 * Optional: BASE_PATH=/repo/ bun run build && bun run preview:dist
 */

const dist = `${import.meta.dir}/dist`;
const port = Number(process.env.PORT) || 8788;

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    if (path === '/') path = '/index.html';

    const file = Bun.file(`${dist}${path}`);
    if (await file.exists()) {
      return new Response(file);
    }

    const fallback = Bun.file(`${dist}/404.html`);
    if (await fallback.exists()) {
      return new Response(fallback, { status: 404 });
    }
    return new Response('Not found', { status: 404 });
  },
});

console.log(`Preview dist → ${server.url}`);
