// A design's versions. Each change makes a new design that points back at
// the one it was changed from, so the versions form a tree.

import type { Design } from "./library";

// Every design seen this visit, by id, including shared ones and the
// earlier versions of a design that aren't in this browser's library.
const known = new Map<string, Design>();

export function remember(item: Design) {
  known.set(item.id, item);
  return item;
}

export function recall(id: string) {
  return known.get(id);
}

// The versions a design was changed from, oldest first.
function ancestors(item: Design) {
  const chain: Design[] = [];
  for (let id = item.parent; id && known.has(id); id = known.get(id)!.parent) {
    chain.unshift(known.get(id)!);
  }
  return chain;
}

// A design's line of versions, oldest first: the ones it was changed from,
// itself, then the newest line of changes made from it.
export function versions(item: Design) {
  const newest = [...known.values()]
    .filter((other) => ancestors(other).some((a) => a.id === item.id))
    .sort((a, b) => b.created - a.created)[0] as Design | undefined;
  const after: Design[] = [];
  for (let other = newest; other && other.id !== item.id;) {
    after.unshift(other);
    other = other.parent ? known.get(other.parent) : undefined;
  }
  return [...ancestors(item), item, ...after];
}

// The latest version of each design in a list.
export function latest(list: Design[]) {
  return list.filter((item) => !list.some((other) => other.parent === item.id));
}
