import { readdirSync, existsSync, copyFileSync } from "fs";
import { join } from "path";

const unverifiedAssetsDir = "./src/unverified-assets";
const assetsDir = "./src/assets";

async function processDarkFiles() {
  console.log("Processing _dark files from unverified-assets...\n");

  // Get all _dark files from unverified-assets
  const darkFiles = readdirSync(unverifiedAssetsDir).filter((file) =>
    file.endsWith("_dark.svg")
  );

  console.log(`Found ${darkFiles.length} _dark files to process\n`);

  let copied = 0;
  let skipped = 0;

  for (const darkFile of darkFiles) {
    // Remove _dark suffix to get target filename
    const targetFile = darkFile.replace("_dark.svg", ".svg");

    const sourcePath = join(unverifiedAssetsDir, darkFile);
    const targetPath = join(assetsDir, targetFile);

    // Check if target already exists in assets
    if (existsSync(targetPath)) {
      console.log(`⏭️  Skipped: ${targetFile} (already exists in assets)`);
      skipped++;
    } else {
      // Copy and rename the file
      copyFileSync(sourcePath, targetPath);
      console.log(`✅ Copied: ${darkFile} → ${targetFile}`);
      copied++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`- Copied: ${copied} files`);
  console.log(`- Skipped: ${skipped} files (already existed)`);
  console.log(`- Total processed: ${darkFiles.length} files`);
}

// Run the script
processDarkFiles().catch(console.error);
