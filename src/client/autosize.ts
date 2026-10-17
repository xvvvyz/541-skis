// field-sizing: content, for browsers without it. A copy is measured, so the
// page never jumps, and it holds the placeholder when empty, as native does.
export function autosize(field: HTMLTextAreaElement) {
  if (CSS.supports("field-sizing", "content")) return;

  const fit = () => {
    const copy = field.cloneNode() as HTMLTextAreaElement;
    copy.value = field.value || field.placeholder;
    Object.assign(copy.style, {
      height: "0",
      position: "absolute",
      width: `${field.offsetWidth}px`,
    });
    field.after(copy);
    const borders = copy.offsetHeight - copy.clientHeight;
    field.style.height = `${copy.scrollHeight + borders}px`;
    copy.remove();
  };

  // Text set from script fires no input event.
  const value = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!;
  Object.defineProperty(field, "value", {
    get: () => value.get!.call(field),
    set: (text: string) => {
      value.set!.call(field, text);
      fit();
    },
  });

  field.addEventListener("input", fit);
  new MutationObserver(fit).observe(field, {
    attributeFilter: ["placeholder"],
  });
  // Fitting changes only the height, so only width changes refit.
  let width = 0;
  new ResizeObserver(() => {
    if (field.offsetWidth === width) return;
    width = field.offsetWidth;
    fit();
  }).observe(field);
  document.fonts.ready.then(fit);
}
