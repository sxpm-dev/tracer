import type { CallPath, CallPathFrame } from './callPaths';

export interface CallPathTreeNode {
  calls: number;
  children: CallPathTreeNode[];
  depth: number;
  frame: CallPathFrame;
  hasNextSibling: boolean;
  id: string;
  paths: number;
}

interface MutableNode {
  calls: number;
  children: Map<string, MutableNode>;
  depth: number;
  frame: CallPathFrame;
  id: string;
  paths: number;
}

export function buildCallPathTree(paths: CallPath[]): CallPathTreeNode[] {
  const roots = new Map<string, MutableNode>();
  for (const path of paths) {
    let children = roots;
    let parentId = '';
    for (const [depth, frame] of path.frames.entries()) {
      const key = JSON.stringify(frame);
      let node = children.get(key);
      if (!node) {
        node = {
          calls: 0,
          children: new Map(),
          depth,
          frame,
          id: `${parentId}\0${key}`,
          paths: 0,
        };
        children.set(key, node);
      }
      node.calls += path.calls;
      node.paths += 1;
      children = node.children;
      parentId = node.id;
    }
  }
  return sortedNodes([...roots.values()]);
}

function sortedNodes(nodes: MutableNode[]): CallPathTreeNode[] {
  const sorted = nodes.sort(
    (a, b) =>
      b.calls - a.calls ||
      JSON.stringify(a.frame).localeCompare(JSON.stringify(b.frame)),
  );
  return sorted.map((node, index) => ({
    calls: node.calls,
    children: sortedNodes([...node.children.values()]),
    depth: node.depth,
    frame: node.frame,
    hasNextSibling: index < sorted.length - 1,
    id: node.id,
    paths: node.paths,
  }));
}
