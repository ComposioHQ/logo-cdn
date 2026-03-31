import { transformSvgForDarkTheme } from "../../lib/logo-render";

const DARK_THEME = "dark";

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const slug = url.pathname.split("/").pop();
  const theme = url.searchParams.get("theme")?.toLowerCase() || "";
  const type = url.searchParams.get("type")?.toLowerCase() || "svg";

  if (!slug) {
    return Response.json({ error: "invalid slug parameter" }, { status: 400 });
  }

  if (type === "png") {
    const pngUrl = new URL(`/api/png/${slug}`, url);
    url.searchParams.forEach((value, key) => {
      if (key !== "type") {
        pngUrl.searchParams.set(key, value);
      }
    });

    const pngResponse = await fetch(pngUrl);
    return new Response(pngResponse.body, {
      status: pngResponse.status,
      headers: pngResponse.headers,
    });
  }

  const assetUrl = new URL(`/api/_asset/${slug}`, url);
  if (theme) {
    assetUrl.searchParams.set("theme", theme);
  }

  const assetResponse = await fetch(assetUrl);

  if (!assetResponse.ok) {
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      headers: {
        "Content-Type":
          assetResponse.headers.get("content-type") || "application/json",
      },
    });
  }

  const svgContent = await assetResponse.text();
  const variant = assetResponse.headers.get("x-logo-variant");
  const outputSvg =
    theme === DARK_THEME && variant !== "dark"
      ? transformSvgForDarkTheme(svgContent)
      : svgContent;

  return new Response(outputSvg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=432000, immutable",
      ETag: `"${slug}:${theme || "default"}:${variant || "default"}:svg"`,
    },
  });
}

export const config = {
  runtime: "edge",
};
