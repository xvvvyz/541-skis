// How far a wheel turn zooms, for the views that zoom or size with it.

// Trackpad pinches arrive as ctrl-wheel, in small steps.
export function wheelZoom(event: WheelEvent, rate = 1) {
  const lines = event.deltaMode === 1 ? 16 : 1;
  const speed = event.ctrlKey ? 0.01 : 0.002;
  return Math.exp(-event.deltaY * lines * speed * rate);
}
