// Component (Effect) Retrieval Functions

/**
 * Gets a component (effect) on a clip by its matchName
 */
export function getComponentByMatchName(
  clip: TrackItem,
  effectMatchName: string
): Component | null {
  for (var i = 0; i < clip.components.numItems; i++) {
    if (clip.components[i].matchName === effectMatchName) {
      return clip.components[i];
    }
  }
  return null;
}

/**
 * Gets a QE component by matchName
 */
export function getQEComponentByMatchName(
  QEClip: QETrackItem,
  effectMatchName: string
): QEComponent | null {
  try {
    if (!QEClip) {
      return null;
    }
    const numComponents = QEClip.numComponents;
    for (var i = 0; i < numComponents; i++) {
      const component = QEClip.getComponentAt(i);
      if (component.matchName === effectMatchName) {
        return component;
      }
    }
    return null;
  } catch (e: any) {
    return null;
  }
}
