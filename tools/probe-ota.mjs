#!/usr/bin/env bun
/**
 * Probe tomato.gulaike.com firmware catalog (same endpoint as SuperBand OTA check).
 *
 * Usage:
 *   bun tools/probe-ota.mjs --name DG01 --version V32294
 *   bun tools/probe-ota.mjs --version V32172 --name BJ-1
 */
const TOKEN = "Bearer 6fcb7f58475b4e5aad8f0f1cadce235e";
const PKG = "com.legend.smartwatch.electronicbadge.android";

function parseArgs(argv) {
  const out = { name: "DG01", version: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") out.name = argv[++i];
    else if (a === "--version") out.version = argv[++i];
    else if (a === "--quiet" || a === "-q") out.quiet = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.version) {
  console.log(`Usage: bun tools/probe-ota.mjs --version V32294 [--name DG01] [--quiet]`);
  process.exit(args.help ? 0 : 1);
}

const appName = Buffer.from(PKG).toString("base64");
const url = new URL("https://tomato.gulaike.com/api/v1/config/app");
url.searchParams.set("name", args.name);
url.searchParams.set("type", "1");
url.searchParams.set("version", args.version);

const res = await fetch(url, {
  headers: {
    authorization: TOKEN,
    "app-type": "1",
    "app-name": appName,
    "app-version": "2.1.25",
    country: "foreign",
  },
});
const body = await res.json();
const result = { url: url.toString(), status: res.status, body };
if (!args.quiet) {
  console.log(JSON.stringify(result, null, 2));
}
if (body?.data?.app_down_url) {
  if (!args.quiet) console.error(`\nDownload: ${body.data.app_down_url}`);
  // Machine-readable single line for shell wrappers
  console.error(`OTA_URL=${body.data.app_down_url}`);
  console.error(`OTA_NAME=${body.data.name ?? ""}`);
  console.error(`OTA_VERSION=${body.data.version ?? ""}`);
}
process.exit(body?.data?.app_down_url ? 0 : 2);
