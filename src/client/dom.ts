import { LOGO } from "./logo";

export const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

export function drawLogos() {
  for (const path of document.querySelectorAll("[data-logo]")) {
    path.setAttribute("d", LOGO);
  }
}
