// Help for people new to prompts: example ideas, and styles added as a
// visible line, so a prompt reads as a subject and a style. None of it says
// skis, which gets the image model painting pictures of skis.

export const IDEAS = [
  "Your dog on a powder day, in watercolor",
  "The Oregon coast at sunset, as a woodcut print",
  "Bold neon zigzags, retro 80s",
  "A grizzly in a pine forest, travel poster style",
  "Northern lights over Mt. Hood, paper-cut style",
  "Koi fish swimming toward the tips",
  "Tie-dye in sunset colors",
];

export const CHANGES = [
  "add a moon",
  "make it pinker",
  "bolder colors",
  "fewer trees",
  "add falling snow",
];

interface Style {
  label: string;
  text: string;
}

// Most likely picks first: a phone shows only the first few.
export const STYLES: Style[] = [
  {
    label: "Watercolor",
    text: "loose watercolor painting on textured paper, soft washes of color",
  },
  {
    label: "Poster",
    text: "mid-century travel poster, flat crisp shapes in a limited palette",
  },
  {
    label: "Retro",
    text: "1980s retro graphics, neon colors on black with a subtle halftone texture",
  },
  {
    label: "Cartoon",
    text: "bold cartoon illustration with thick clean outlines and flat bright colors",
  },
  {
    label: "Woodcut",
    text: "bold woodcut print in two or three ink colors on cream paper, hand-carved lines",
  },
  {
    label: "Oil painting",
    text: "oil painting with visible expressive brushstrokes and rich, saturated color",
  },
  {
    label: "Pixel art",
    text: "16-bit pixel art with chunky visible pixels and a limited palette",
  },
  {
    label: "Photo",
    text: "photorealistic, crisp detail and natural light",
  },
  {
    label: "Stained glass",
    text: "stained glass, jewel-toned glass panes joined by dark lead lines, with light glowing through",
  },
  {
    label: "Ink sketch",
    text: "black ink pen drawing with loose, confident lines on warm off-white paper",
  },
  {
    label: "Paper cut",
    text: "flat layered paper-cut shapes with soft shadows between the layers",
  },
  {
    label: "Risograph",
    text: "two-color risograph print with slight misregistration and visible grain",
  },
];

// A style is the prompt's last line, after the subject. The examples' are
// written this way too, so picking a style swaps theirs out.
const PREFIX = "Style: ";

export const styled = (subject: string, style: string) =>
  `${subject}\n${PREFIX}${style}`;

function split(prompt: string) {
  const text = prompt.trimEnd();
  const match = text.match(new RegExp(`(?:^|\n)${PREFIX}([^\n]*)$`));
  return match
    ? { style: match[1], subject: text.slice(0, match.index).trimEnd() }
    : { subject: text };
}

// The style picked for the prompt, if it ends with one of these.
export function styleOf(prompt: string) {
  const { style } = split(prompt);
  return STYLES.find((each) => each.text === style);
}

// The prompt with its style swapped for this one, or taken off if it's
// this one. With no subject yet, the style goes on the second line, leaving
// the first for one.
export function toggleStyle(prompt: string, style: Style) {
  const { subject, style: current } = split(prompt);
  return current === style.text ? subject : styled(subject, style.text);
}
