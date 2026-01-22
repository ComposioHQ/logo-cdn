import type { NextApiRequest, NextApiResponse } from "next";
import { existsSync } from "fs";
import { join } from "path";

const COMPOSIO_API_URL = "https://backend.composio.dev/api/v3/toolkits?sort_by=usage";
const COMPOSIO_API_KEY = "y4ru2vrbb1ms91rowhcelk";

export interface Toolkit {
  slug: string;
  name: string;
  description: string;
  appUrl: string;
  logoUrl: string;
  toolsCount: number;
  hasLocalLogo: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiRes = await fetch(COMPOSIO_API_URL, {
      headers: { "x-api-key": COMPOSIO_API_KEY },
    });

    if (!apiRes.ok) {
      throw new Error(`Composio API error: ${apiRes.status}`);
    }

    const data = await apiRes.json();
    const assetsDir = join(process.cwd(), "src", "assets");

    const toolkits: Toolkit[] = data.items.map((item: {
      slug: string;
      name: string;
      meta: {
        description?: string;
        app_url?: string;
        logo?: string;
        tools_count?: number;
      };
    }) => {
      const localPath = join(assetsDir, `${item.slug}.svg`);
      return {
        slug: item.slug,
        name: item.name,
        description: item.meta?.description || "",
        appUrl: item.meta?.app_url || "",
        logoUrl: item.meta?.logo || "",
        toolsCount: item.meta?.tools_count || 0,
        hasLocalLogo: existsSync(localPath),
      };
    });

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
    res.status(200).json({ toolkits, total: toolkits.length });
  } catch (error) {
    console.error("Error fetching toolkits:", error);
    res.status(500).json({ error: "Failed to fetch toolkits" });
  }
}
