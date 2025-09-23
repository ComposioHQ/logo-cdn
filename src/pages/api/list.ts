import { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const assetsPath = path.join(process.cwd(), "src", "assets");
    const files = fs.readdirSync(assetsPath);

    // Filter for SVG files and create slug-to-URL mapping
    const logoMap: Record<string, string> = {};

    files
      .filter((file) => file.endsWith(".svg"))
      .forEach((file) => {
        const slug = file.replace(".svg", "");
        // Use the current domain or fallback to localhost for development
        const baseUrl = req.headers.host
          ? `${req.headers["x-forwarded-proto"] || "http"}://${
              req.headers.host
            }`
          : "http://localhost:3000";
        logoMap[slug] = `${baseUrl}/api/${slug}`;
      });

    res.status(200).json(logoMap);
  } catch (error) {
    console.error("Error reading assets directory:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
