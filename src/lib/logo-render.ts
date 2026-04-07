export const DARK_MODE_COLOR = "#ffffff";
const COLOR_VALUE = `#[0-9a-f]{3,8}|rgb\\(\\s*[\\d.\\s%,]+\\)|rgba\\(\\s*[\\d.\\s%,]+\\)|black|white`;
const SVG_COLOR_REFERENCE_PATTERN = new RegExp(
  `(fill|stroke)(\\s*=\\s*["']|\\s*:\\s*)(${COLOR_VALUE})\\b`,
  "gi"
);
const STYLE_COLOR_PATTERN = new RegExp(
  `(fill|stroke)(\\s*:\\s*)(${COLOR_VALUE})(\\s*!important)?`,
  "gi"
);

function parseSvgColor(color: string) {
  const normalizedColor = color.trim().toLowerCase();

  if (normalizedColor === "black") {
    return { r: 0, g: 0, b: 0 };
  }

  if (normalizedColor === "white") {
    return { r: 255, g: 255, b: 255 };
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

  // Use relative luminance (sRGB) — better than weighted average for blues
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
  return luminance < 0.1;
}

function stripDefs(svg: string) {
  return svg.replace(/<defs[\s\S]*?<\/defs>/gi, "");
}

export function transformSvgForDarkTheme(svgContent: string) {
  if (/<(linearGradient|radialGradient)\b/i.test(svgContent)) {
    return null;
  }

  const visibleSvg = stripDefs(svgContent);
  const attrMatches = [...visibleSvg.matchAll(SVG_COLOR_REFERENCE_PATTERN)];
  const styleMatches = [...visibleSvg.matchAll(STYLE_COLOR_PATTERN)];

  const allColors = [
    ...attrMatches.map(([, , , color]) => color.toLowerCase()),
    ...styleMatches.map(([, , , color]) => color.toLowerCase()),
  ];

  if (allColors.length === 0) {
    return null;
  }

  const colorKey = (c: string) => {
    const rgb = parseSvgColor(c);
    return rgb ? `${rgb.r},${rgb.g},${rgb.b}` : c;
  };
  const uniqueColors = new Set(allColors.map(colorKey));
  const allDark = allColors.every((color) => isDarkColor(color));

  // Skip multi-color logos — only transform single-color dark logos
  if (!allDark || uniqueColors.size > 1) {
    return null;
  }

  let result = svgContent.replace(
    SVG_COLOR_REFERENCE_PATTERN,
    (match: string, attr: string, separator: string, color: string) =>
      isDarkColor(color) ? `${attr}${separator}${DARK_MODE_COLOR}` : match
  );
  result = result.replace(
    STYLE_COLOR_PATTERN,
    (match: string, attr: string, separator: string, color: string, important: string) =>
      isDarkColor(color)
        ? `${attr}${separator}${DARK_MODE_COLOR}${important || ""}`
        : match
  );
  return result;
}
