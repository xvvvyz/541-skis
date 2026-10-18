// The designs are saved on the server; this keeps a cleaned-up copy of each
// in the browser so the list loads fast.

import type { Frame } from "./frame";

export interface Design {
  id: string;
  prompt: string;
  // Changes made after the prompt, oldest first.
  edits?: string[];
  parent?: string | null;
  saved?: boolean;
  // Only in the browser that made it: adds it to the gallery.
  owner?: string;
  // A same-origin URL for examples, a JPEG data URL for generated designs.
  src: string;
  // Centered and as big as fits if unset.
  frame?: Frame;
  created: number;
  // When it was opened from someone else's link, so it sorts as new here.
  added?: number;
}

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("541-designs", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("designs", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function designs(mode: IDBTransactionMode) {
  return (await open()).transaction("designs", mode).objectStore("designs");
}

// Newest first. Storage can be unavailable, as in private browsing.
export async function loadLibrary() {
  try {
    const request = (await designs("readonly")).getAll();
    return await new Promise<Design[]>((resolve, reject) => {
      request.onsuccess = () =>
        resolve(
          (request.result as Design[]).sort(
            (a, b) => (b.added ?? b.created) - (a.added ?? a.created),
          ),
        );
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function saveToLibrary(design: Design) {
  try {
    (await designs("readwrite")).put(design);
  } catch {}
}
