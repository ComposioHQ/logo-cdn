import type { NextApiRequest, NextApiResponse } from "next";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

import { resolveSvgAsset, DARK_THEME } from "../../lib/logo-assets";
import { transformSvgForDarkTheme } from "../../lib/logo-render";

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
    const { filePath, assetKey, variant } = resolveSvgAsset(slug, theme);

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: "svg not found" });
    }

    let svgContent = await readFile(filePath, "utf-8");

    if (theme === DARK_THEME && variant === "default") {
      const transformed = transformSvgForDarkTheme(svgContent);
      if (transformed) {
        svgContent = transformed;
      }
    }

    const etag = `"${assetKey}:${variant}:svg"`;

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=432000, immutable");
    res.setHeader("ETag", etag);

    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.status(200).send(svgContent);
  } catch (error) {
    console.error("error serving svg:", error);
    res.status(500).json({ error: "internal server error" });
  }
}

export const config = {
  unstable_revalidate: 3600,
};
