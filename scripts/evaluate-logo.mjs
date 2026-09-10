import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const [slug] = process.argv.slice(2);

if (!slug || !/^[a-z0-9_-]+$/.test(slug)) {
  throw new Error("Usage: bun run logo:eval -- <canonical-slug>");
}

const root = process.cwd();
const sources = JSON.parse(
  await readFile(resolve(root, "logo-sources.json"), "utf8")
);
const source = sources[slug];

if (!source) {
  throw new Error(`No direct official SVG source is registered for ${slug}.`);
}

const sourceUrl = new URL(source.source);
if (sourceUrl.protocol !== "https:" || !sourceUrl.pathname.endsWith(".svg")) {
  throw new Error("Logo source must be a direct HTTPS SVG URL, never a brand or product page.");
}

const asset = await readFile(resolve(root, "src", "assets", `${slug}.svg`), "utf8");
const rootTag = asset.match(/<svg\b[^>]*>/i)?.[0];
if (!rootTag) throw new Error("Asset has no SVG root element.");

const errors = [];
if (!/\bwidth=["']128["']/.test(rootTag) || !/\bheight=["']128["']/.test(rootTag)) {
  errors.push("root SVG must explicitly be 128 × 128");
}
if (/<(?:script|foreignObject)\b/i.test(asset)) errors.push("scripts and foreignObject are forbidden");
if (/\b(?:href|xlink:href)=["']https?:\/\//i.test(asset)) errors.push("external SVG references are forbidden");
if (/currentColor/i.test(asset)) errors.push("currentColor is unsafe for external image rendering");
if (!/<(?:path|circle|rect|polygon|ellipse|g)\b/i.test(asset)) errors.push("asset has no recognizable vector artwork");

const body = (svg) => svg.slice(svg.indexOf(">") + 1).trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const localBodyHash = sha256(body(asset));

const officialResponse = await fetch(source.source);
if (!officialResponse.ok) errors.push(`official source returned ${officialResponse.status}`);
const officialAsset = await officialResponse.text();
if (!officialAsset.includes("<svg")) errors.push("official source did not return SVG content");
if (sha256(body(officialAsset)) !== source.bodySha256) {
  errors.push("official source artwork changed; review and deliberately update the registered fingerprint");
}
if (localBodyHash !== source.bodySha256) {
  errors.push("asset geometry does not match the registered official artwork");
}

const liveResponse = await fetch(`https://logos.composio.dev/api/${slug}`);
const liveSvg = await liveResponse.text();
if (!liveResponse.ok) errors.push(`live logo endpoint returned ${liveResponse.status}`);
if (!liveResponse.headers.get("content-type")?.includes("image/svg+xml")) errors.push("live endpoint is not serving SVG");
if (liveResponse.headers.get("x-logo-fallback") === "true") errors.push("live endpoint served the fallback logo");
if (sha256(body(liveSvg)) !== localBodyHash) errors.push("live artwork differs from the checked-in asset");

if (errors.length) {
  throw new Error(`Logo evaluation failed for ${slug}:\n- ${errors.join("\n- ")}`);
}

console.log(`Logo evaluation passed for ${slug}.`);
