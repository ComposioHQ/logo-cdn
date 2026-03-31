import React from "react";
import { ImageResponse } from "next/og";

const DARK_THEME = "dark";
const DARK_MODE_COLOR = "#ffffff";
const SVG_COLOR_REFERENCE_PATTERN =
  /(fill|stroke)(\s*=\s*["']|\s*:\s*)(#[0-9a-f]{3,8}|rgb\(\s*[\d.\s%,]+\)|rgba\(\s*[\d.\s%,]+\)|black)\b/gi;

function parseSvgColor(color: string) {
  const normalizedColor = color.trim().toLowerCase();

  if (normalizedColor === "black") {
    return { r: 0, g: 0, b: 0 };
  }

  if (normalizedColor.startsWith("#")) {
    const hex = normalizedColor.slice(1);

    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b] = hex.slice(0, 3).split("").map((value) => value + value);
      return {
        r: Number.parseInt(r, 16),
        g: Number.parseInt(g, 16),
        b: Number.parseInt(b, 16),
      };
    }

    if (hex.length === 6 || hex.length === 8) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
      };
    }
  }

  const rgbMatch = normalizedColor.match(/rgba?\(([^)]+)\)/i);
  if (!rgbMatch) {
    return null;
  }

  const [r, g, b] = rgbMatch[1]
    .split(",")
    .slice(0, 3)
    .map((part) => {
      const value = part.trim();
      if (value.endsWith("%")) {
        return Math.round((Number.parseFloat(value) / 100) * 255);
      }

      return Number.parseFloat(value);
    });

  if ([r, g, b].some((value) => Number.isNaN(value))) {
    return null;
  }

  return { r, g, b };
}

function isDarkColor(color: string) {
  const rgb = parseSvgColor(color);
  if (!rgb) {
    return false;
  }

  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness < 128;
}

function transformSvgForDarkTheme(svgContent: string) {
  return svgContent.replace(
    SVG_COLOR_REFERENCE_PATTERN,
    (match: string, attr: string, separator: string, color: string) =>
      isDarkColor(color) ? `${attr}${separator}${DARK_MODE_COLOR}` : match
  );
}

function getImageDimensions(svgContent: string) {
  const widthMatch = svgContent.match(/\bwidth=["'](\d+(?:\.\d+)?)["']/i);
  const heightMatch = svgContent.match(/\bheight=["'](\d+(?:\.\d+)?)["']/i);

  if (widthMatch && heightMatch) {
    return {
      width: Math.max(1, Math.round(Number.parseFloat(widthMatch[1]))),
      height: Math.max(1, Math.round(Number.parseFloat(heightMatch[1]))),
    };
  }

  const viewBoxMatch = svgContent.match(
    /\bviewBox=["'][^"']*?(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)["']/i
  );

  if (viewBoxMatch) {
    return {
      width: Math.max(1, Math.round(Number.parseFloat(viewBoxMatch[3]))),
      height: Math.max(1, Math.round(Number.parseFloat(viewBoxMatch[4]))),
    };
  }

  return { width: 128, height: 128 };
}

function toBase64(value: string) {
  return btoa(unescape(encodeURIComponent(value)));
}

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

  const svgContent = await assetResponse.text();
  const variant = assetResponse.headers.get("x-logo-variant");

  if (theme !== DARK_THEME || variant === "dark") {
    return new Response(svgContent, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=432000, immutable",
        ETag: `"${slug}:${theme || "default"}:${variant || "default"}:svg"`,
      },
    });
  }

  const transformedSvg = transformSvgForDarkTheme(svgContent);
  const { width, height } = getImageDimensions(transformedSvg);
  const dataUrl = `data:image/svg+xml;base64,${toBase64(transformedSvg)}`;

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
        ETag: `"${slug}:${theme}:image-response"`,
      },
    }
  );
}

export const config = {
  runtime: "edge",
};
