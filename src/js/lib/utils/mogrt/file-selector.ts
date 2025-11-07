import { fs, os } from "../../cep/node";
import { IOpenDialogResult } from "./types";
import { evalTS } from "../bolt";

/**
 * Selects a .mogrt file using the system file dialog
 * @param initialPath Optional initial directory path. If not provided, uses user's home directory
 * @returns Promise that resolves to the selected file path, or rejects if no file selected
 */
export const selectMogrtFile = async (
  initialPath?: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const dialogTitle = "Select MOGRT File";
      const startDir = initialPath || os.homedir();
      const fileTypes = ["mogrt"];

      const result = (
        window.cep.fs.showOpenDialogEx || window.cep.fs.showOpenDialog
      )(
        false, // allowMultipleSelection
        false, // chooseDirectory
        dialogTitle,
        startDir,
        fileTypes
      ) as IOpenDialogResult;

      if (result.data?.length > 0) {
        const filePath = decodeURIComponent(
          result.data[0].replace("file://", "")
        );
        console.log("[selectMogrtFile] Selected file:", filePath);
        resolve(filePath);
      } else {
        reject(new Error("No file selected"));
      }
    } catch (error: any) {
      const errorMsg = `Error selecting MOGRT file: ${error instanceof Error ? error.message : String(error)}`;
      console.error("[selectMogrtFile]", errorMsg);
      reject(new Error(errorMsg));
    }
  });
};

/**
 * Selects a .mogrt file and imports it into Premiere Pro
 * @param initialPath Optional initial directory path for file dialog
 * @param timeInTicks Optional time position for import. If not provided, uses playhead position
 * @param videoTrackOffset Track offset for video (default: 2)
 * @param audioTrackOffset Track offset for audio (default: 2)
 * @returns Success message or error description
 */
export const selectAndImportMogrt = async (
  initialPath?: string,
  timeInTicks?: string,
  videoTrackOffset: number = 2,
  audioTrackOffset: number = 2
): Promise<string> => {
  try {
    console.log("[selectAndImportMogrt] Opening file dialog...");
    const mogrtPath = await selectMogrtFile(initialPath);
    console.log("[selectAndImportMogrt] File selected:", mogrtPath);

    // Validate file exists
    if (!fs.existsSync(mogrtPath)) {
      const error = `MOGRT file not found: ${mogrtPath}`;
      console.error("[selectAndImportMogrt]", error);
      return error;
    }

    // Import into Premiere Pro
    console.log("[selectAndImportMogrt] Importing MOGRT into Premiere Pro...");
    const importResult = await evalTS(
      "importModifiedMogrt",
      mogrtPath,
      timeInTicks,
      videoTrackOffset,
      audioTrackOffset
    );

    console.log("[selectAndImportMogrt] Import completed");
    return `MOGRT imported successfully.\nFile: ${mogrtPath}\nImport: ${importResult}`;
  } catch (error: any) {
    const errorMsg = `Error in selectAndImportMogrt: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[selectAndImportMogrt]", errorMsg);
    return errorMsg;
  }
};
