import type { NextApiRequest, NextApiResponse } from "next";
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { slug } = req.query;

  if (!slug || typeof slug !== "string") {
    return res.status(400).json({ error: "invalid slug parameter" });
  }

  try {
    // normalize the slug to lowercase and add .svg if not present
    const lowerSlug = slug.toLowerCase();
    const normalizedSlug = lowerSlug.endsWith(".svg")
      ? lowerSlug
      : `${lowerSlug}.svg`;

    // construct the file path
    const filePath = join(process.cwd(), "src", "assets", normalizedSlug);

    // check if file exists
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: "svg not found" });
    }

    // read the svg file
    const svgContent = await readFile(filePath, "utf-8");

    // set no-cache headers during development to always get fresh content
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

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
