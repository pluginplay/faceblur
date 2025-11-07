// Motion Graphics Template (MOGRT) Helpers

export const fillMogrtText = (
  clip: TrackItem,
  propName: string,
  text: string
) => {
  const mgt = clip.getMGTComponent();
  const prop = mgt.properties.getParamForDisplayName(propName);
  if (prop) {
    const valueStr = prop.getValue();
    let value = JSON.parse(valueStr) as any;
    value.textEditValue = text;
    prop.setValue(JSON.stringify(value), true);
  }
};
