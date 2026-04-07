export const DARK_MODE_COLOR = "#ffffff";
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

export function transformSvgForDarkTheme(svgContent: string) {
  const matches = [...svgContent.matchAll(SVG_COLOR_REFERENCE_PATTERN)];

  if (matches.length === 0) {
    return null;
  }

  const allDark = matches.every(([, , , color]) => isDarkColor(color));
  if (!allDark) {
    return null;
  }

  return svgContent.replace(
    SVG_COLOR_REFERENCE_PATTERN,
    (match: string, attr: string, separator: string, color: string) =>
      `${attr}${separator}${DARK_MODE_COLOR}`
  );
}
