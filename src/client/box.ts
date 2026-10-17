// Where an element's content goes: the area inside its padding, from its
// top left corner, in CSS pixels.
export function contentBox(element: HTMLElement) {
  const style = getComputedStyle(element);
  const [top, right, bottom, left] = [
    style.paddingTop,
    style.paddingRight,
    style.paddingBottom,
    style.paddingLeft,
  ].map(parseFloat);
  return {
    height: element.clientHeight - top - bottom,
    left,
    top,
    width: element.clientWidth - left - right,
  };
}
