import type { Archiver } from "archiver";
import { ZipEntry, ZipOptions } from "./types";

/**
 * Helper function to create a ZIP archive in memory using archiver
 * @param entries Array of {name, data} objects to add to the ZIP
 * @param options Optional archiver options
 * @returns Promise that resolves to the ZIP file as a Buffer
 */
export const createZipBuffer = async (
  entries: ZipEntry[],
  options?: ZipOptions
): Promise<Buffer> => {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archiver = require("archiver");
    const archive: Archiver = archiver("zip", {
      forceZip64: options?.forceZip64 ?? false, // Disable ZIP64
      zlib: { level: options?.zlibLevel ?? 9 }, // Maximum compression
    });

    archive.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    archive.on("end", () => {
      resolve(Buffer.concat(chunks as unknown as readonly Uint8Array[]));
    });

    archive.on("error", (err: Error) => {
      reject(err);
    });

    // Add all entries
    for (const entry of entries) {
      archive.append(entry.data, { name: entry.name });
    }

    archive.finalize();
  });
};
