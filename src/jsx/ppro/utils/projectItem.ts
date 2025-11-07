// ProjectItem Helpers

export const forEachChild = (
  item: ProjectItem,
  callback: (item: ProjectItem) => void
) => {
  const len = item.children.numItems;
  for (let i = 0; i < len; i++) {
    callback(item.children[i]);
  }
};

export const deleteItem = (item: ProjectItem) => {
  if (item.type === 2 /* BIN */) {
    item.deleteBin();
  } else {
    const tmpBin = app.project.rootItem.createBin("tmp");
    item.moveBin(tmpBin);
    tmpBin.deleteBin();
  }
};

export const getChildByName = (item: ProjectItem, name: string) => {
  for (let i = 0; i < item.children.numItems; i++) {
    const child = item.children[i];
    if (child.name === name) {
      return child;
    }
  }
};

export const getChildByNodeId = (item: ProjectItem, nodeId: string) => {
  for (let i = 0; i < item.children.numItems; i++) {
    const child = item.children[i];
    if (child.nodeId === nodeId) {
      return child;
    }
  }
};

export const getChildFromTreePath = (project: Project, treePath: string) => {
  const elements = treePath.split("\\"); // first item is blank, second is root
  let projectItem: ProjectItem | undefined = project.rootItem;
  for (let i = 2; i < elements.length; i++) {
    const item = elements[i];
    projectItem = getChildByName(projectItem, item);
    if (!projectItem) return null;
  }
  return projectItem;
};

export const getDescendantByNodeId = (
  item: ProjectItem,
  nodeId: string
): ProjectItem | undefined => {
  for (let i = 0; i < item.children.numItems; i++) {
    const child = item.children[i];
    if (child.nodeId === nodeId) {
      return child;
    } else if (child.type === 2 /* BIN */) {
      const found = getDescendantByNodeId(child, nodeId);
      if (found) return found;
    }
  }
};

export const getParentItem = (item: ProjectItem) => {
  const dir = item.treePath.split("\\");
  if (dir.length < 2) {
    return app.project.rootItem;
  }
  let current = app.project.rootItem;
  for (let i = 2; i < dir.length - 1; i++) {
    const name = dir[i];
    const next = getChildByName(current, name);
    if (next) {
      current = next;
    }
  }
  return current;
};

export const findItemByPath = (
  item: ProjectItem,
  path: string
): ProjectItem | undefined => {
  const len = item.children.numItems;
  for (let i = 0; i < len; i++) {
    const child = item.children[i];
    if (child.children && child.children.numItems > 0) {
      const res = findItemByPath(child, path);
      if (res) {
        return res;
      }
    } else if (child.getMediaPath() === path) {
      return child;
    }
  }
};
