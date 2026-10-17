// Keeps the page from zooming, for a page whose content zooms on gestures
// of its own, in the elements matching own. Safari pinches past
// user-scalable and touch-action, so its gesture events are stopped, as
// are trackpad pinches, which arrive as ctrl-wheel.
export function stopPageZoom(own: string) {
  for (const type of ["gesturestart", "gesturechange"]) {
    document.addEventListener(type, (event) => event.preventDefault());
  }
  addEventListener(
    "wheel",
    (event) => event.ctrlKey && event.preventDefault(),
    { passive: false },
  );

  // Nor does a quick second tap, which Safari still zooms on now and then.
  // It's cancelled and clicked by hand, so quick taps on buttons all count.
  // Text fields keep their double tap. Safari times a double tap from the
  // first tap's end to the second's start, so this does too.
  let last = { end: -Infinity, start: 0, x: 0, y: 0 };
  document.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    last = {
      ...last,
      start: event.timeStamp,
      x: touch.clientX,
      y: touch.clientY,
    };
  });
  document.addEventListener(
    "touchend",
    (event) => {
      const touch = event.changedTouches[0];
      let target = event.target as Element | null;
      const quick = last.start - last.end < 500;
      const still =
        Math.hypot(touch.clientX - last.x, touch.clientY - last.y) < 10;
      last.end = event.timeStamp;
      if (
        !quick ||
        !still ||
        event.touches.length ||
        target?.closest(`input, textarea, ${own}`)
      ) {
        return;
      }
      event.preventDefault();
      // An icon's SVG can't be clicked; the button round it can.
      while (target && !(target instanceof HTMLElement)) {
        target = target.parentElement;
      }
      target?.click();
    },
    { passive: false },
  );
}
