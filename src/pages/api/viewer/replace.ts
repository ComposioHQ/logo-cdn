import type { NextApiRequest, NextApiResponse } from "next";
import { writeFileSync } from "fs";
import { join } from "path";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { slug, content } = req.body;

    if (!slug || typeof slug !== "string") {
      return res.status(400).json({ error: "Invalid slug" });
    }

    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "Invalid content" });
    }

    // Validate SVG content
    if (!content.includes("<svg") || !content.includes("</svg>")) {
      return res.status(400).json({ error: "Invalid SVG content" });
    }

    // Sanitize slug
    const sanitizedSlug = slug.replace(/[^a-z0-9_-]/gi, "").toLowerCase();
    if (!sanitizedSlug) {
      return res.status(400).json({ error: "Invalid slug format" });
    }

    const filepath = join(process.cwd(), "src", "assets", `${sanitizedSlug}.svg`);

    writeFileSync(filepath, content, "utf8");

    res.status(200).json({ success: true, slug: sanitizedSlug });
  } catch (error) {
    console.error("Error replacing logo:", error);
    res.status(500).json({ error: "Failed to replace logo" });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};
