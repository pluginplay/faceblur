// Effect Application Logic

import { getEffectPropertyIndex } from "../../utils/EffectPropertyMapper";
import { getComponentByMatchName } from "./components";
import { getQEClipWithName } from "../utils/qe";
import type { EffectData, EffectPropertyKeyframe, RgbColor } from "../types";

/**
 * Gets an existing effect on a clip by its matchName or adds it if not found.
 */
function getOrAddEffect(
  clip: TrackItem,
  effectMatchName: string,
  trackIndex: number
): Component | null {
  let effect = getComponentByMatchName(clip, effectMatchName);
  if (effect) {
    return effect;
  }
  try {
    app.enableQE();
    if (!qe) {
      throw new Error("QuickEdit API (qe) is not available after enabling it.");
    }
    const QEClip = getQEClipWithName(clip, trackIndex, "video");
    if (!QEClip) {
      throw new Error(
        `Could not find QEClip for item ${clip.name} on track ${trackIndex}`
      );
    }
    const premiereEffect = qe.project.getVideoEffectByName(
      effectMatchName,
      true
    );
    if (!premiereEffect) {
      throw new Error(`Could not find effect by matchName: ${effectMatchName}`);
    }
    const addedEffect = QEClip.addVideoEffect(premiereEffect);
    // Wait a moment for the effect to be added
    for (var i = 0; i < clip.components.numItems; i++) {
      if (clip.components[i].matchName === effectMatchName) {
        effect = clip.components[i];
        break;
      }
    }
    if (!effect) {
      throw new Error(`Could not add effect by matchName: ${effectMatchName}`);
    }
    return effect;
  } catch (e: any) {
    throw new Error(
      `Failed to add effect '${effectMatchName}': ${e.toString()}`
    );
  }
}

/**
 * Applies static properties to an effect
 */
function applyStaticProperties(
  effect: Component,
  effectMatchName: string,
  staticProperties: {
    [propertyName: string]: number | boolean | [number, number] | RgbColor;
  }
): void {
  for (const propName in staticProperties) {
    const propValue = staticProperties[propName];
    if (propValue === undefined || propValue === null) continue;

    const propIndex = getEffectPropertyIndex(effectMatchName, propName);
    if (propIndex === null) continue;

    try {
      const targetProperty = effect.properties[propIndex];
      if (!targetProperty) continue;

      targetProperty.setTimeVarying(false); // Ensure it's not keyframed

      if (propName === "color" || propName === "shadowColor") {
        const colorValue = propValue as RgbColor;
        targetProperty.setColorValue(
          1,
          colorValue.r,
          colorValue.g,
          colorValue.b,
          true
        );
      } else if (
        propValue instanceof Array &&
        propValue.length === 2 &&
        typeof propValue[0] === "number" &&
        typeof propValue[1] === "number"
      ) {
        targetProperty.setValue(propValue, true);
      } else if (typeof propValue === "number") {
        targetProperty.setValue(propValue, true);
      } else if (typeof propValue === "boolean") {
        targetProperty.setValue(propValue, true);
      }
    } catch (e: any) {
      // Silently fail for property setting errors
    }
  }
}

/**
 * Applies keyframes to an effect
 */
function applyKeyframes(
  effect: Component,
  effectMatchName: string,
  keyframes: EffectPropertyKeyframe[],
  trackItem: TrackItem
): void {
  const processedAnimatedProperties: { [key: string]: boolean } = {};

  for (var k = 0; k < keyframes.length; k++) {
    const keyframe = keyframes[k];
    const time = keyframe.time + trackItem.inPoint.seconds;

    for (const propName in keyframe) {
      if (propName === "time" || propName === "interpolationType") continue;

      const propValue = keyframe[propName];
      if (propValue === undefined || propValue === null) continue;

      const propIndex = getEffectPropertyIndex(effectMatchName, propName);
      if (propIndex === null) continue;

      try {
        const targetProperty = effect.properties[propIndex];
        if (!targetProperty) continue;

        if (!processedAnimatedProperties[propName]) {
          targetProperty.setTimeVarying(true);
          processedAnimatedProperties[propName] = true;
        }

        if (propName === "color" || propName === "shadowColor") {
          const colorValue = propValue as RgbColor;
          //@ts-ignore - ExtendScript API signature mismatch
          targetProperty.setColorValueAtTime(
            time,
            1,
            colorValue.r,
            colorValue.g,
            colorValue.b,
            true
          );
        } else if (
          propValue instanceof Array &&
          propValue.length === 2 &&
          typeof propValue[0] === "number" &&
          typeof propValue[1] === "number"
        ) {
          //@ts-ignore - ExtendScript API signature mismatch
          targetProperty.addKey(time);
          //@ts-ignore - ExtendScript API signature mismatch
          targetProperty.setValueAtKey(time, propValue, true);
        } else if (typeof propValue === "number") {
          //@ts-ignore - ExtendScript API signature mismatch
          targetProperty.addKey(time);
          //@ts-ignore - ExtendScript API signature mismatch
          targetProperty.setValueAtKey(time, propValue, true);
        } else if (typeof propValue === "boolean") {
          //@ts-ignore - ExtendScript API signature mismatch
          targetProperty.addKey(time);
          //@ts-ignore - ExtendScript API signature mismatch
          targetProperty.setValueAtKey(time, propValue, true);
        }
      } catch (e: any) {
        // Silently fail for keyframe errors
      }
    }
  }
}

/**
 * Applies a list of effects with their properties and keyframes to a track item.
 */
export function applyEffectsToTrackItem(
  trackItem: TrackItem,
  effectDataArray: EffectData,
  trackIndex: number
): void {
  if (!trackItem || !effectDataArray) {
    throw new Error("Invalid trackItem or effectDataArray provided.");
  }

  for (var i = 0; i < effectDataArray.length; i++) {
    const effectDataItem = effectDataArray[i];
    const effect = getOrAddEffect(
      trackItem,
      effectDataItem.effectMatchName,
      trackIndex
    );

    if (!effect) {
      throw new Error(
        `Could not get or add effect: ${effectDataItem.effectMatchName}. Skipping this effect.`
      );
    }

    // Apply static properties (non-animated)
    if (effectDataItem.staticProperties) {
      applyStaticProperties(
        effect,
        effectDataItem.effectMatchName,
        effectDataItem.staticProperties
      );
    }

    // Apply keyframes (animated properties)
    if (effectDataItem.keyframes && effectDataItem.keyframes.length > 0) {
      applyKeyframes(
        effect,
        effectDataItem.effectMatchName,
        effectDataItem.keyframes,
        trackItem
      );
    }
  }
}
