import type { NextApiRequest, NextApiResponse } from "next";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

export interface LogoAnalysis {
  slug: string;
  isWhiteOnly: boolean;
  isOversized: boolean;
  isNonSquare: boolean;
  width: number | null;
  height: number | null;
}

function isWhiteOnlySvg(content: string): boolean {
  // Check for non-white colors
  const nonWhitePatterns = [
    /#(?![fF]{3}(?:[fF]{3})?(?![0-9a-fA-F]))[0-9a-fA-F]{3,6}/g,
    /rgb\s*\(\s*(?!255\s*,\s*255\s*,\s*255)/gi,
    /fill\s*[=:]\s*["']?(?!#fff|#ffffff|white|none|transparent|currentColor)/gi,
    /stroke\s*[=:]\s*["']?(?!#fff|#ffffff|white|none|transparent|currentColor)/gi,
  ];

  for (const pattern of nonWhitePatterns) {
    if (pattern.test(content)) {
      return false;
    }
  }

  // Check if there are shapes
  const hasShapes = /<(path|rect|circle|ellipse|polygon|polyline|line|text)\b/i.test(content);
  if (!hasShapes) return false;

  // Check for white colors
  const whitePatterns = [
    /#fff(?:fff)?(?![0-9a-f])/gi,
    /white/gi,
    /rgb\s*\(\s*255\s*,\s*255\s*,\s*255\s*\)/gi,
  ];

  for (const pattern of whitePatterns) {
    if (pattern.test(content)) {
      return true;
    }
  }

  // Check for shapes without fill (default is black)
  const hasFillAttr = /fill\s*=/i.test(content);
  const hasStrokeAttr = /stroke\s*=/i.test(content);
  
  if (hasShapes && !hasFillAttr && !hasStrokeAttr) {
    return false;
  }

  return false;
}

function extractDimensions(content: string): { width: number | null; height: number | null } {
  // Try viewBox first
  const viewBoxMatch = content.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/\s+/);
    if (parts.length >= 4) {
      return {
        width: parseFloat(parts[2]),
        height: parseFloat(parts[3]),
      };
    }
  }

  // Try width/height attributes
  const widthMatch = content.match(/\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)/i);
  const heightMatch = content.match(/\bheight\s*=\s*["']?(\d+(?:\.\d+)?)/i);

  return {
    width: widthMatch ? parseFloat(widthMatch[1]) : null,
    height: heightMatch ? parseFloat(heightMatch[1]) : null,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const assetsDir = join(process.cwd(), "src", "assets");
    const files = readdirSync(assetsDir).filter((f) => f.endsWith(".svg"));

    const analysis: LogoAnalysis[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(assetsDir, file), "utf8");
        const slug = file.replace(".svg", "");
        const { width, height } = extractDimensions(content);

        analysis.push({
          slug,
          isWhiteOnly: isWhiteOnlySvg(content),
          isOversized: (width !== null && width > 128) || (height !== null && height > 128),
          isNonSquare: width !== null && height !== null && Math.abs(width - height) > 1,
          width,
          height,
        });
      } catch {
        // Skip files that can't be read
      }
    }

    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate");
    res.status(200).json({ analysis });
  } catch (error) {
    console.error("Error analyzing logos:", error);
    res.status(500).json({ error: "Failed to analyze logos" });
  }
}
