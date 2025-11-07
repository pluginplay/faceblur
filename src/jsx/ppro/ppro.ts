// Premiere Pro Main Functions

import { applyEffectsToTrackItem } from "./effects/effects";
import {
  getComponentByMatchName,
  getQEComponentByMatchName,
} from "./effects/components";
import { getQEClipWithName } from "./utils/qe";
import { getTrackIndexForClip } from "./utils/sequence";
import { sdkLog } from "./utils/logger";

/**
 * Applies Gaussian blur effect to the first selected clip in the active sequence
 */
export const applyBlurToSelectedClip = (): string => {
  try {
    if (!app.project.activeSequence) {
      return "No active sequence found.";
    }

    const activeSequence = app.project.activeSequence;
    const currentSelection = activeSequence.getSelection();

    if (!currentSelection || currentSelection.length === 0) {
      return "No clips selected. Please select a clip first.";
    }

    // Get the first selected TrackItem
    const trackItem = currentSelection[0];

    // Find which track this clip is on
    const trackIndex = getTrackIndexForClip(activeSequence, trackItem);

    if (trackIndex === null) {
      return "Could not determine which track the selected clip is on.";
    }

    // Apply Gaussian blur effect
    applyEffectsToTrackItem(
      trackItem,
      [
        {
          effectMatchName: "AE.ADBE Gaussian Blur 2",
          staticProperties: {
            blurRadius: 20,
          },
          keyframes: [],
        },
      ],
      trackIndex
    );

    return "Gaussian blur applied successfully.";
  } catch (e: any) {
    return `Error applying blur: ${e.toString()}`;
  }
};

/**
 * Checks all component items for the Gaussian blur effect and alerts each one
 * @param useQE - If true, uses QE API to get the component; otherwise uses ExtendScript API
 */
export const checkGaussianBlurComponents = (useQE: boolean = false): string => {
  const EFFECT_MATCH_NAME = "AE.ADBE Lumetri";
  try {
    if (!app.project.activeSequence) {
      return "No active sequence found.";
    }

    const activeSequence = app.project.activeSequence;
    const currentSelection = activeSequence.getSelection();

    if (!currentSelection || currentSelection.length === 0) {
      return "No clips selected. Please select a clip first.";
    }

    // Get the first selected TrackItem
    const trackItem = currentSelection[0];

    // Find which track this clip is on
    const trackIndex = getTrackIndexForClip(activeSequence, trackItem);

    if (trackIndex === null) {
      return "Could not determine which track the selected clip is on.";
    }

    if (useQE) {
      // Enable QE and get QE clip, then use getComponentByMatchName on TrackItem
      try {
        app.enableQE();
        if (!qe) {
          return "QuickEdit API (qe) is not available.";
        }

        const QEClip = getQEClipWithName(trackItem, trackIndex, "video");
        if (!QEClip) {
          return "Could not find QE clip for selected track item.";
        }

        // Use getComponentByMatchName on the TrackItem
        const component = getQEComponentByMatchName(QEClip, EFFECT_MATCH_NAME);

        if (!component) {
          return `${EFFECT_MATCH_NAME} effect not found on selected clip (QE).`;
        }

        // Get properties from the component
        const paramsList = component.getParamList();
        sdkLog(JSON.stringify(paramsList));
        const numProperties = paramsList ? paramsList.length : 0;
        if (paramsList && numProperties > 0) {
          for (var i = 0; i < numProperties; i++) {
            const param = paramsList[i];
            // sdkLog(
            //   `Param ${i}: ${JSON.stringify(param)}  value: ${JSON.stringify(component.getParamValue(param))}`
            // );
          }
        }
        const apiType = useQE ? "QE" : "ExtendScript";
        return `Checked ${numProperties} ${EFFECT_MATCH_NAME} component properties (${apiType}).`;
      } catch (e: any) {
        return `Error accessing QE API: ${e.toString()}`;
      }
    } else {
      // Use ExtendScript API to get the Gaussian blur component
      const component = getComponentByMatchName(trackItem, EFFECT_MATCH_NAME);

      if (!component) {
        return `${EFFECT_MATCH_NAME} effect not found on selected clip.`;
      }

      // Iterate through all properties of the Gaussian blur component
      const properties = component.properties;
      const numProperties = properties.numItems;

      if (numProperties === 0) {
        return `${EFFECT_MATCH_NAME} effect has no properties.`;
      }

      // Alert each property as a stringified version
      for (var i = 0; i < numProperties; i++) {
        const property: ComponentParam = properties[i];
        try {
          // Try to get property value and other info
          const propertyInfo: any = {
            index: i,
            displayName: property.displayName || "Unknown",
            isTimeVarying: property.isTimeVarying() ? true : false,
          };

          // Try to get the value if possible
          try {
            if (property.isTimeVarying()) {
              propertyInfo.value = "Time-varying (keyframed)";
            } else {
              propertyInfo.value = JSON.stringify(property.getValue());
            }
          } catch (e: any) {
            propertyInfo.value = "Unable to get value: " + e.toString();
          }

          // Stringify and log
          const stringified = JSON.stringify(propertyInfo);
          const apiType = useQE ? "QE" : "ExtendScript";
          sdkLog(
            `${EFFECT_MATCH_NAME} Component Property ${i + 1}/${numProperties} (${apiType}):\n${stringified}`
          );
        } catch (e: any) {
          sdkLog(`Error processing property ${i}: ${e.toString()}`);
        }
      }

      const apiType = useQE ? "QE" : "ExtendScript";
      return `Checked ${numProperties} ${EFFECT_MATCH_NAME} component properties (${apiType}).`;
    }
  } catch (e: any) {
    return `Error checking ${EFFECT_MATCH_NAME} components: ${e.toString()}`;
  }
};

/**
 * Imports a modified MOGRT file into the active sequence
 * @param mogrtPath Complete path to .mogrt file
 * @param timeInTicks Time (in ticks) at which to insert. If not provided, uses playhead position
 * @param videoTrackOffset The offset from first video track to targeted track (default: 0)
 * @param audioTrackOffset The offset from first audio track to targeted track (default: 0)
 * @returns Success message or error description
 */
export const importModifiedMogrt = (
  mogrtPath: string,
  timeInTicks?: string,
  videoTrackOffset: number = 2,
  audioTrackOffset: number = 2
): string => {
  try {
    if (!app.project.activeSequence) {
      return "No active sequence found.";
    }

    const activeSequence = app.project.activeSequence;

    // Determine timeInTicks - use playhead position if not provided
    let insertTime: string;
    if (timeInTicks) {
      insertTime = timeInTicks;
    } else {
      // Get playhead position in ticks
      const playhead = activeSequence.getPlayerPosition();
      insertTime = playhead.toString();
    }

    sdkLog(
      `Importing MOGRT from: ${mogrtPath}\nTime: ${insertTime}\nVideo track offset: ${videoTrackOffset}\nAudio track offset: ${audioTrackOffset}`
    );

    // Import the MOGRT
    const trackItem = activeSequence.importMGT(
      mogrtPath,
      insertTime,
      videoTrackOffset,
      audioTrackOffset
    );

    if (trackItem) {
      return `MOGRT imported successfully at time ${insertTime}.`;
    } else {
      return "Failed to import MOGRT - importMGT returned null.";
    }
  } catch (e: any) {
    return `Error importing MOGRT: ${e.toString()}`;
  }
};
