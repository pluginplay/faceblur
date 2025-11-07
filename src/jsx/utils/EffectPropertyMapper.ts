interface EffectPropertyMap {
  [effectMatchName: string]: {
    [propertyName: string]: number;
  };
}

export const propertyMap: EffectPropertyMap = {
  "AE.ADBE Motion": {
    position: 0,
    scalePercent: 1,
    rotation: 2,
    opacity: 3,
  },
  "AE.ADBE Geometry2": {
    position: 1,
    scalePercent: 3,
    rotation: 7,
    opacity: 8,
  },
  "AE.ADBE Drop Shadow": {
    shadowColor: 0,
    opacity: 1,
    shadowDirection: 2,
    shadowDistance: 3,
    shadowSoftness: 4,
  },
  "AE.ADBE Tint": {
    mapBlackTo: 0,
    mapWhiteTo: 1,
    amountToTint: 2,
    color: 0,
  },
  "AE.ADBE Basic 3D": {
    swivel: 0,
    tilt: 1,
    distance: 2,
    specularHighlight: 3,
  },
  "AE.ADBE Gaussian Blur 2": {
    blurRadius: 0,
  },
};

export function getEffectPropertyIndex(
  effectMatchName: string,
  propertyName: string
): number | null {
  if (
    propertyMap[effectMatchName] &&
    propertyMap[effectMatchName][propertyName] !== undefined
  ) {
    return propertyMap[effectMatchName][propertyName];
  }
  return null;
}
