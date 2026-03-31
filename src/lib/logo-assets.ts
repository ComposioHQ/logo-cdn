import { existsSync } from "fs";
import { join } from "path";

export const DARK_THEME = "dark";

export function normalizeSlug(slug: string) {
  const lowerSlug = slug.toLowerCase();
  return lowerSlug.endsWith(".svg") ? lowerSlug : `${lowerSlug}.svg`;
}

export function getAssetPath(fileName: string) {
  return join(process.cwd(), "src", "assets", fileName);
}

export function resolveSvgAsset(slug: string, theme?: string) {
  const normalizedSlug = normalizeSlug(slug);

  if (theme === DARK_THEME) {
    const darkVariantSlug = normalizedSlug.replace(/\.svg$/, "-dark.svg");
    const darkVariantPath = getAssetPath(darkVariantSlug);

    if (existsSync(darkVariantPath)) {
      return {
        filePath: darkVariantPath,
        assetKey: darkVariantSlug,
        variant: "dark" as const,
      };
    }
  }

  return {
    filePath: getAssetPath(normalizedSlug),
    assetKey: normalizedSlug,
    variant: "default" as const,
  };
}
