import { fs, path } from "../../cep/node";
import { csi } from "../bolt";

/**
 * Gets the project name from definition.json
 */
export const getProjectName = (): string => {
  const extensionPath = csi.getSystemPath("extension");
  const definitionPath = path.join(extensionPath, "bin/definition.json");

  if (!fs.existsSync(definitionPath)) {
    throw new Error(`definition.json not found at: ${definitionPath}`);
  }

  const definitionContent = fs.readFileSync(definitionPath, "utf8");
  const definition = JSON.parse(definitionContent);

  return definition.capsuleName || "FaceBlurTest";
};

/**
 * Gets the path to the bin directory
 */
export const getBinPath = (): string => {
  const extensionPath = csi.getSystemPath("extension");
  return path.join(extensionPath, "bin");
};

/**
 * Gets paths to required MOGRT files
 */
export const getMogrtFilePaths = () => {
  const binPath = getBinPath();
  return {
    binPath,
    definitionPath: path.join(binPath, "definition.json"),
    thumbPath: path.join(binPath, "thumb.png"),
  };
};

/**
 * Gets the default XML source path for FaceBlur mask parsing
 */
export const getDefaultMaskXmlPath = (): string => {
  const binPath = getBinPath();
  return path.join(binPath, "FaceBlur Test");
};
