import homepage from './index.html';

const port = Number(process.env.PORT) || 8787;

const server = Bun.serve({
  port,
  routes: {
    '/': homepage,
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`SuperBand manager → ${server.url}`);
