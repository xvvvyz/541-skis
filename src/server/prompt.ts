// Nano Banana 2.1 first, falling back to Nano Banana 2 when it is rate
// limited. They're the only models on OpenRouter that paint the tall
// canvases a pair of skis needs. 2.1 runs on our own Google AI Studio key,
// with billing, in the OpenRouter workspace; without it, OpenRouter's
// shared pool turns most requests away.
export const IMAGE_MODELS = [
  "google/gemini-nano-banana-2.1",
  "google/gemini-3.1-flash-image",
];

// New art is painted at 1:4, wider than the pair, so there's room to slide
// it over the art in the studio. Designs from before that, and the
// examples, are 1:8; their changes keep it, so the art keeps its layout.
export const ASPECT = "1:4";

export function aspectRatio(width: number, height: number) {
  return width / height < 0.18 ? "1:8" : ASPECT;
}

// Kept short. The model isn't told where the skis go, or shown them: given
// a map of them, it copied their outline into the art. Nor is it told the
// art is for skis: told that, it painted pictures of skis.
export const ARTWORK_RULES = `Tall artwork that fills the whole canvas, edge to edge, like a crop from a larger mural. Keep the main subject toward the middle. Only include words if the description asks for them.`;
