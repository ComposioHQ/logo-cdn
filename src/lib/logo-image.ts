export function getImageDimensions(svgContent: string) {
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

export function toBase64(value: string) {
  return btoa(unescape(encodeURIComponent(value)));
}
