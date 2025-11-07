import { fs, path, zlib } from "../../cep/node";
import { getProjectName, getMogrtFilePaths } from "./config";
import { createZipBuffer } from "./archive";
import type { Archiver } from "archiver";

/**
 * Builds a MOGRT file from the extracted XML and supporting files
 * @param xmlPath Path to the extracted XML file
 * @param outputPath Path where the .mogrt file should be created
 * @returns Promise that resolves to the path of the created .mogrt file
 */
export const buildMogrtFile = async (
  xmlPath: string,
  outputPath: string
): Promise<string> => {
  console.log("[buildMogrtFile] Starting MOGRT build...");
  console.log("[buildMogrtFile] XML path:", xmlPath);
  console.log("[buildMogrtFile] Output path:", outputPath);

  // Validate XML file exists
  if (!fs.existsSync(xmlPath)) {
    throw new Error(`XML file not found: ${xmlPath}`);
  }

  // Get paths to required files
  const { definitionPath, thumbPath } = getMogrtFilePaths();

  // Validate required files exist
  if (!fs.existsSync(definitionPath)) {
    throw new Error(`definition.json not found at: ${definitionPath}`);
  }
  if (!fs.existsSync(thumbPath)) {
    throw new Error(`thumb.png not found at: ${thumbPath}`);
  }

  // Get project name from definition.json
  const projectName = getProjectName();
  console.log("[buildMogrtFile] Project name:", projectName);

  // Step 1: GZIP XML to .prproj
  console.log("[buildMogrtFile] Step 1: GZIPping XML to .prproj...");
  const xmlContent = fs.readFileSync(xmlPath, "utf8");
  const xmlBuffer = Buffer.from(xmlContent, "utf8");
  const prprojData = zlib.gzipSync(
    xmlBuffer as unknown as Uint8Array,
    { mtime: 0 } as any
  ); // GZIP, not DEFLATE, with mtime=0 for determinism
  const prprojFileName = `${projectName}.prproj`;
  console.log(
    `[buildMogrtFile] GZIPped to ${prprojData.length} bytes (${prprojFileName})`
  );

  // Step 2: Create inner ZIP: project.prgraphic containing the .prproj file
  console.log(
    "[buildMogrtFile] Step 2: Creating inner ZIP (project.prgraphic)..."
  );
  const projectPrgraphic = await createZipBuffer(
    [{ name: prprojFileName, data: prprojData }],
    { forceZip64: false, zlibLevel: 9 } // DEFLATE compression, no ZIP64
  );
  console.log(
    `[buildMogrtFile] Inner ZIP created: ${projectPrgraphic.length} bytes (project.prgraphic)`
  );

  // Step 3: Create outer ZIP archive (.mogrt) with files in correct order
  console.log(
    "[buildMogrtFile] Step 3: Creating outer ZIP archive (.mogrt)..."
  );

  // Step 4: Write ZIP file
  const mogrtPath = outputPath.endsWith(".mogrt")
    ? outputPath
    : path.join(outputPath, `${projectName}_modified.mogrt`);

  // Ensure output directory exists
  const outputDir = path.dirname(mogrtPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Overwrite if exists
  if (fs.existsSync(mogrtPath)) {
    console.log("[buildMogrtFile] Overwriting existing file:", mogrtPath);
    fs.unlinkSync(mogrtPath);
  }

  // Create file stream for output
  const output = fs.createWriteStream(mogrtPath);
  const archiver = require("archiver") as typeof import("archiver");
  const archive: Archiver = archiver("zip", {
    forceZip64: false, // Disable ZIP64 - critical for Premiere compatibility
    zlib: { level: 9 }, // Maximum compression
  });

  // Resolve promise when archive is finalized
  return new Promise<string>((resolve, reject) => {
    output.on("close", () => {
      console.log(
        `[buildMogrtFile] Archive finalized: ${archive.pointer()} total bytes`
      );
      console.log(
        "[buildMogrtFile] MOGRT file created successfully:",
        mogrtPath
      );
      resolve(mogrtPath);
    });

    archive.on("error", (err: Error) => {
      reject(err);
    });

    // Pipe archive data to the file
    archive.pipe(output);

    // Add files in CORRECT ORDER: project.prgraphic first, then definition.json, then thumb.png
    archive.append(projectPrgraphic, { name: "project.prgraphic" });
    console.log("[buildMogrtFile] Added project.prgraphic");

    const definitionContent = fs.readFileSync(definitionPath);
    archive.append(definitionContent, { name: "definition.json" });
    console.log("[buildMogrtFile] Added definition.json");

    const thumbContent = fs.readFileSync(thumbPath);
    archive.append(thumbContent, { name: "thumb.png" });
    console.log("[buildMogrtFile] Added thumb.png");

    // Finalize the archive
    archive.finalize();
  });
};
