import type { NextApiRequest, NextApiResponse } from "next";

const VECTORIZER_API_KEY = "vkig9acadmc83pp";
const VECTORIZER_API_SECRET = "7tbpgt4pnjrd8efnpc8abmibkis1n52s12n4rp465udrd4duosg4";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { image, filename } = req.body;

    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "No image data provided" });
    }

    // Extract base64 data from data URL
    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "Invalid image format" });
    }

    const [, imageType, base64Data] = matches;
    const imageBuffer = Buffer.from(base64Data, "base64");

    // Determine mime type
    const mimeTypes: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    };

    const mimeType = mimeTypes[imageType] || "image/png";

    // Create form data for Vectorizer.ai API
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: mimeType });
    formData.append("image", blob, filename || `image.${imageType}`);

    // Call Vectorizer.ai API
    const authString = Buffer.from(
      `${VECTORIZER_API_KEY}:${VECTORIZER_API_SECRET}`
    ).toString("base64");

    console.log("[Vectorize] Calling Vectorizer.ai API...");

    const apiRes = await fetch("https://vectorizer.ai/api/v1/vectorize", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authString}`,
      },
      body: formData,
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.log("[Vectorize] API error:", apiRes.status, errText);
      return res.status(apiRes.status).json({ error: `Vectorizer API error: ${errText}` });
    }

    let svgContent = await apiRes.text();
    console.log("[Vectorize] Success, SVG length:", svgContent.length);

    // Resize SVG to fit 128x128 frame
    // First, try to extract existing viewBox or width/height
    const viewBoxMatch = svgContent.match(/viewBox=["']([^"']+)["']/);
    const widthMatch = svgContent.match(/\bwidth=["']([^"']+)["']/);
    const heightMatch = svgContent.match(/\bheight=["']([^"']+)["']/);

    let viewBox = viewBoxMatch ? viewBoxMatch[1] : null;

    // If no viewBox but has width/height, create viewBox from them
    if (!viewBox && widthMatch && heightMatch) {
      const w = parseFloat(widthMatch[1]);
      const h = parseFloat(heightMatch[1]);
      if (!isNaN(w) && !isNaN(h)) {
        viewBox = `0 0 ${w} ${h}`;
      }
    }

    // Remove existing width/height and add new ones with viewBox
    svgContent = svgContent.replace(/\bwidth=["'][^"']*["']\s*/g, "");
    svgContent = svgContent.replace(/\bheight=["'][^"']*["']\s*/g, "");

    // Add width="128" height="128" and viewBox if we have one
    if (viewBox) {
      svgContent = svgContent.replace(
        /<svg\b/,
        `<svg width="128" height="128" viewBox="${viewBox}"`
      );
    } else {
      svgContent = svgContent.replace(
        /<svg\b/,
        '<svg width="128" height="128"'
      );
    }

    res.status(200).json({ svg: svgContent });
  } catch (error) {
    console.error("Vectorize error:", error);
    res.status(500).json({ error: "Failed to vectorize image" });
  }
}
