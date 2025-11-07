import { useEffect, useState } from "react";
import { subscribeBackgroundColor } from "../lib/utils/bolt";
import { parseMaskPathBinary } from "../lib/utils/prfpset";
import {
  buildAndImportMogrt,
  selectAndImportMogrt,
  parseMogrtXmlMaskPath,
  getDefaultMaskXmlPath,
} from "../lib/utils/mogrt";

export const App = () => {
  const [bgColor, setBgColor] = useState("#282c34");
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (window.cep) {
      subscribeBackgroundColor(setBgColor);
    }
  }, []);

  const handleParseMaskKeyframes = () => {
    try {
      setStatusMessage("Parsing mask path from FaceBlur Test...");
      const xmlPath = getDefaultMaskXmlPath();
      const result = parseMogrtXmlMaskPath(xmlPath);

      if (result.hasKeyframes) {
        setStatusMessage(
          "Mask path contains keyframes. Keyframe handling is not implemented yet."
        );
        return;
      }

      const startValue = result.startValue;
      const parsed =
        result.parsedPath ||
        (startValue ? parseMaskPathBinary(startValue) : undefined);

      if (startValue && parsed) {
        const pointsInfo = parsed.points
          .map(
            (p, idx) => `Point ${idx}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`
          )
          .join("\n");

        const analysisInfo = `Analysis: ${parsed.analysis.totalBytes} bytes, ${parsed.points.length} points found, ~${parsed.analysis.bytesPerPoint.toFixed(1)} bytes/point`;

        const baseInfo = `Source: ${xmlPath}\nStart value size: ${startValue.length} bytes`;

        setStatusMessage(
          `Parsed mask path successfully.\n${baseInfo}\n${analysisInfo}\n\n${pointsInfo}`
        );
      } else {
        setStatusMessage(
          `Mask path data not found in FaceBlur Test (source: ${xmlPath}).`
        );
      }

      console.log("Parsed mask path data:", result);
    } catch (error: any) {
      setStatusMessage(`Error: ${error.toString()}`);
      console.error("Failed to parse mask keyframes:", error);
    }
  };

  const handleBuildAndImportMogrt = async () => {
    try {
      setStatusMessage("Building and importing MOGRT...");
      const result = await buildAndImportMogrt();
      setStatusMessage(result);
    } catch (error: any) {
      setStatusMessage(`Error: ${error.toString()}`);
      console.error("Failed to build and import MOGRT:", error);
    }
  };

  const handleSelectAndImportMogrt = async () => {
    try {
      setStatusMessage("Selecting MOGRT file...");
      const result = await selectAndImportMogrt();
      setStatusMessage(result);
    } catch (error: any) {
      setStatusMessage(`Error: ${error.toString()}`);
      console.error("Failed to select and import MOGRT:", error);
    }
  };

  return (
    <div className="app" style={{ backgroundColor: bgColor }}>
      <header className="app-header">
        <div className="flex flex-col items-center justify-center p-8 gap-4">
          <h1 className="text-2xl font-bold text-white mb-4">Face Blur Tool</h1>
          <button
            onClick={handleParseMaskKeyframes}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg shadow-lg transition-colors"
          >
            Parse Mask Path Keyframes
          </button>
          <button
            onClick={handleBuildAndImportMogrt}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg shadow-lg transition-colors"
          >
            Build & Import MOGRT
          </button>
          <button
            onClick={handleSelectAndImportMogrt}
            className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg shadow-lg transition-colors"
          >
            Select & Import MOGRT
          </button>
          {statusMessage && (
            <p className="text-sm text-gray-300 mt-2">{statusMessage}</p>
          )}
        </div>
      </header>
    </div>
  );
};
