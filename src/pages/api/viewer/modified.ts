import type { NextApiRequest, NextApiResponse } from "next";
import { execSync } from "child_process";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Get modified files in src/assets/ using git
    const output = execSync(
      'git diff --name-only HEAD -- src/assets/ && git diff --name-only --cached -- src/assets/',
      { cwd: process.cwd(), encoding: "utf8" }
    );

    // Also get untracked files
    const untracked = execSync(
      'git ls-files --others --exclude-standard -- src/assets/',
      { cwd: process.cwd(), encoding: "utf8" }
    );

    const allFiles = (output + untracked)
      .split("\n")
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.replace("src/assets/", "").replace(".svg", ""));

    // Remove duplicates
    const modified = [...new Set(allFiles)];

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ modified });
  } catch (error) {
    console.error("Error checking git status:", error);
    // If git fails, return empty array
    res.status(200).json({ modified: [] });
  }
}
