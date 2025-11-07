// Metadata Helpers

export const getPrMetadata = (projectItem: ProjectItem, fields: string[]) => {
  let PProMetaURI = "http://ns.adobe.com/premierePrivateProjectMetaData/1.0/";
  if (ExternalObject.AdobeXMPScript === undefined) {
    ExternalObject.AdobeXMPScript = new ExternalObject("lib:AdobeXMPScript");
  }
  if (!app.isDocumentOpen() || !ExternalObject.AdobeXMPScript || !XMPMeta) {
    return {};
  }
  let xmp = new XMPMeta(projectItem.getProjectMetadata());
  let result: {
    [key: string]: string;
  } = {};
  for (let i = 0; i < fields.length; i++) {
    if (xmp.doesPropertyExist(PProMetaURI, fields[i])) {
      result[fields[i]] = xmp.getProperty(PProMetaURI, fields[i]).value;
    }
  }
  return result;
};

export const setPrMetadata = (
  projectItem: ProjectItem,
  data: {
    fieldName: string;
    fieldId: string;
    value: string;
  }[]
) => {
  let PProMetaURI = "http://ns.adobe.com/premierePrivateProjectMetaData/1.0/";
  if (ExternalObject.AdobeXMPScript === undefined) {
    ExternalObject.AdobeXMPScript = new ExternalObject("lib:AdobeXMPScript");
  }
  if (!app.isDocumentOpen() || !ExternalObject.AdobeXMPScript || !XMPMeta) {
    return {};
  }
  let xmp = new XMPMeta(projectItem.getProjectMetadata());
  for (var i = 0; i < data.length; i++) {
    let item = data[i];
    var successfullyAdded = app.project.addPropertyToProjectMetadataSchema(
      item.fieldName,
      item.fieldId,
      2
    );
  }
  var array = [];
  for (var i = 0; i < data.length; i++) {
    let item = data[i];
    xmp.setProperty(PProMetaURI, item.fieldName, item.value);
    array.push(item.fieldName);
  }
  var str = xmp.serialize();
  projectItem.setProjectMetadata(str, array);
};

export const removePrMetadata = (
  projectItem: ProjectItem,
  fields: string[]
) => {
  let PProMetaURI = "http://ns.adobe.com/premierePrivateProjectMetaData/1.0/";
  if (ExternalObject.AdobeXMPScript === undefined) {
    ExternalObject.AdobeXMPScript = new ExternalObject("lib:AdobeXMPScript");
  }
  if (!app.isDocumentOpen() || !ExternalObject.AdobeXMPScript || !XMPMeta) {
    return {};
  }
  let xmp = new XMPMeta(projectItem.getProjectMetadata());
  var array = [];
  for (var i = 0; i < fields.length; i++) {
    xmp.deleteProperty(PProMetaURI, fields[i]);
    array.push(fields[i]);
  }
  var str = xmp.serialize();
  projectItem.setProjectMetadata(str, array);
};
