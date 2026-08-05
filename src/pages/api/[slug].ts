import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

import { resolveSvgAsset, DARK_THEME } from "../../lib/logo-assets";
import { transformSvgForDarkTheme } from "../../lib/logo-render";
import {
  FALLBACK_LOGO_SVG_DARK,
  FALLBACK_LOGO_SVG_LIGHT,
} from "../../lib/fallback-logo";

const LOGO_CACHE_CONTROL = "public, max-age=300, must-revalidate";

function createSvgEtag(svgContent: string) {
  const digest = createHash("sha256")
    .update(svgContent)
    .digest("base64url");

  return `"sha256-${digest}"`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { slug } = req.query;
  const theme =
    typeof req.query.theme === "string" ? req.query.theme.toLowerCase() : "";

  if (!slug || typeof slug !== "string") {
    return res.status(400).json({ error: "invalid slug parameter" });
  }

  try {
    const { filePath, variant } = resolveSvgAsset(slug, theme);

    if (!existsSync(filePath)) {
      // No logo for this slug: serve the generic Composio placeholder instead
      // of a 404 so callers never render a broken image. Short, revalidatable
      // cache (NOT immutable) so a real logo added later replaces this within
      // minutes. X-Logo-Fallback lets tooling still detect missing logos.
      const dark = theme === DARK_THEME;
      const placeholder = dark
        ? FALLBACK_LOGO_SVG_DARK
        : FALLBACK_LOGO_SVG_LIGHT;

      const fallbackEtag = createSvgEtag(placeholder);

      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", LOGO_CACHE_CONTROL);
      res.setHeader("ETag", fallbackEtag);
      res.setHeader("X-Logo-Fallback", "true");

      if (req.headers["if-none-match"] === fallbackEtag) {
        return res.status(304).end();
      }

      return res.status(200).end(placeholder);
    }

    let svgContent = await readFile(filePath, "utf-8");

    if (theme === DARK_THEME && variant === "default") {
      const transformed = transformSvgForDarkTheme(svgContent);
      if (transformed) {
        svgContent = transformed;
      }
    }

    const etag = createSvgEtag(svgContent);

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", LOGO_CACHE_CONTROL);
    res.setHeader("ETag", etag);

    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.status(200).end(svgContent);
  } catch (error) {
    console.error("error serving svg:", error);
    res.status(500).json({ error: "internal server error" });
  }
}

export const config = {
  unstable_revalidate: 3600,
};
