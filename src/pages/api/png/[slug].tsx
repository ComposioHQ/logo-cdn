import React from "react";
import { ImageResponse } from "next/og";

import { getImageDimensions, toBase64 } from "../../../lib/logo-image";
import { transformSvgForDarkTheme } from "../../../lib/logo-render";

const DARK_THEME = "dark";

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const slug = url.pathname.split("/").pop();
  const theme = url.searchParams.get("theme")?.toLowerCase() || "";

  if (!slug) {
    return Response.json({ error: "invalid slug parameter" }, { status: 400 });
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

  const variant = assetResponse.headers.get("x-logo-variant") || "default";
  let svgContent = await assetResponse.text();

  if (theme === DARK_THEME && variant !== "dark") {
    svgContent = transformSvgForDarkTheme(svgContent);
  }

  const { width, height } = getImageDimensions(svgContent);
  const dataUrl = `data:image/svg+xml;base64,${toBase64(svgContent)}`;

  return new ImageResponse(
    React.createElement(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        },
      },
      React.createElement("img", {
        src: dataUrl,
        width,
        height,
        alt: `${slug} logo`,
      })
    ),
    {
      width,
      height,
      headers: {
        "Cache-Control": "public, max-age=432000, immutable",
        ETag: `"${slug}:${theme || "default"}:${variant}:png"`,
      },
    }
  );
}

export const config = {
  runtime: "edge",
};
