import type { NextApiRequest, NextApiResponse } from "next";
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const DARK_THEME = "dark";
const DARK_MODE_COLOR = "#ffffff";
const DARK_COLOR_PATTERN =
  /(fill|stroke)(\s*=\s*["']|\s*:\s*)(#000(?:000)?|#111111|#111|#1a1a1a|#222222|#222|#333333|#333|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|rgb\(\s*17\s*,\s*17\s*,\s*17\s*\)|rgb\(\s*26\s*,\s*26\s*,\s*26\s*\)|rgb\(\s*34\s*,\s*34\s*,\s*34\s*\)|rgb\(\s*51\s*,\s*51\s*,\s*51\s*\))/gi;

function normalizeSlug(slug: string) {
  const lowerSlug = slug.toLowerCase();
  return lowerSlug.endsWith(".svg") ? lowerSlug : `${lowerSlug}.svg`;
}

function getAssetPath(fileName: string) {
  return join(process.cwd(), "src", "assets", fileName);
}

function resolveSvgPath(slug: string, theme?: string) {
  const normalizedSlug = normalizeSlug(slug);

  if (theme === DARK_THEME) {
    const darkVariantSlug = normalizedSlug.replace(/\.svg$/, "-dark.svg");
    const darkVariantPath = getAssetPath(darkVariantSlug);

    if (existsSync(darkVariantPath)) {
      return {
        filePath: darkVariantPath,
        assetKey: darkVariantSlug,
        transformed: false,
      };
    }
  }

  return {
    filePath: getAssetPath(normalizedSlug),
    assetKey: normalizedSlug,
    transformed: theme === DARK_THEME,
  };
}

function transformSvgForDarkTheme(svgContent: string) {
  const recoloredSvg = svgContent.replace(
    DARK_COLOR_PATTERN,
    (_, attr: string, separator: string) =>
      `${attr}${separator}${DARK_MODE_COLOR}`
  );

  return recoloredSvg === svgContent ? svgContent : recoloredSvg;
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
    const { filePath, assetKey, transformed } = resolveSvgPath(slug, theme);

    // check if file exists
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: "svg not found" });
    }

    let svgContent = await readFile(filePath, "utf-8");

    if (transformed) {
      svgContent = transformSvgForDarkTheme(svgContent);
    }

    const etag = `"${assetKey}:${theme || "default"}:${
      transformed ? "transformed" : "raw"
    }"`;

    // set strong caching headers
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=432000, immutable");
    res.setHeader("ETag", etag);

    // check if client has cached version
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch === etag) {
      return res.status(304).end();
    }

    // return the svg content
    res.status(200).send(svgContent);
  } catch (error) {
    console.error("error serving svg:", error);
    res.status(500).json({ error: "internal server error" });
  }
}

export const config = {
  unstable_revalidate: 3600,
};
