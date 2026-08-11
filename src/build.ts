/**
 * Production build for static hosting (GitHub Pages, etc.).
 *
 * BASE_PATH controls asset URLs:
 *   - local / custom domain root: "/" (default)
 *   - GitHub project Pages: "/<repo>/"
 */

const outdir = './dist';
const raw = process.env.BASE_PATH || '/';
const publicPath = raw.endsWith('/') ? raw : `${raw}/`;

console.log(`Building with publicPath=${JSON.stringify(publicPath)}`);

await Bun.$`rm -rf ${outdir}`;

const result = await Bun.build({
  entrypoints: ['./index.html'],
  outdir,
  minify: true,
  publicPath,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Prevent Jekyll processing on GitHub Pages (harmless with Actions, still best practice).
await Bun.write(`${outdir}/.nojekyll`, '');

// CalVer build stamp: YYYY.MM.DD.<build> (override with APP_VERSION / BUILD_NUMBER).
const pkg = await Bun.file('./package.json').json();
const today = new Date();
const yyyy = today.getUTCFullYear();
const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
const dd = String(today.getUTCDate()).padStart(2, '0');
const buildNum = process.env.BUILD_NUMBER || '1';
const version =
  process.env.APP_VERSION ||
  (pkg.version?.startsWith(`${yyyy}.${mm}.${dd}.`) ? pkg.version : `${yyyy}.${mm}.${dd}.${buildNum}`);
const versionPayload = {
  version,
  repository: process.env.GITHUB_REPOSITORY || 'T-REX-XP/superband-web-client-rnd',
  built_at: new Date().toISOString(),
  source: process.env.GITHUB_ACTIONS ? 'pages-workflow' : 'local-build',
  base_path: publicPath,
};
await Bun.write(`${outdir}/version.json`, `${JSON.stringify(versionPayload, null, 2)}\n`);
console.log(`version.json → ${version}`);

// Soft-404: recover deep links / missing trailing slash navigations.
const indexHtml = await Bun.file(`${outdir}/index.html`).text();
const redirect = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0;url=${publicPath}" />
    <script>location.replace(${JSON.stringify(publicPath)});</script>
    <title>SuperBand</title>
  </head>
  <body>
    <p><a href="${publicPath}">Open SuperBand</a></p>
  </body>
</html>
`;
await Bun.write(`${outdir}/404.html`, redirect);

// Keep a copy of index as fallback content for hosts that serve 404.html body.
if (!indexHtml.includes('SUPERBAND')) {
  console.warn('Unexpected index.html — missing SUPERBAND marker');
}

console.log(`Wrote ${outdir}/ (${result.outputs.length} outputs + .nojekyll + 404.html)`);
