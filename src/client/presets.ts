// Example designs, generated once with the same prompt the studio uses,
// before about half had their style moved to its own line. In colour order,
// so the home page's rack flows from pale neutrals through blues, warm
// tones, reds and pinks to night and black.

import { styled } from "./prompts";

export interface Preset {
  id: string;
  label: string;
  prompt: string;
  art: string;
  thumbnail: string;
}

const preset = (id: string, label: string, prompt: string): Preset => ({
  art: `/designs/${id}.jpg`,
  id,
  label,
  prompt,
  thumbnail: `/designs/${id}-sm.webp`,
});

export const PRESETS = [
  preset(
    "sketch",
    "Sketch",
    styled(
      "Mt. Hood and its ridges, like a page from a mountaineer's sketchbook",
      "single-weight black ink pen drawing, drawn by hand with loose, confident lines on warm off-white paper",
    ),
  ),
  preset(
    "sumi",
    "Sumi",
    styled(
      "Misty mountain ridges and a few pines",
      "Japanese sumi-e ink wash painting, black ink on warm off-white rice paper, lots of empty paper",
    ),
  ),
  preset(
    "birch",
    "Birch",
    styled(
      "A grove of slender white birch trunks seen from below and running the length of the skis, with dark bark markings and a hint of golden autumn leaves between them",
      "soft gouache painting",
    ),
  ),
  preset(
    "granite",
    "Granite",
    "A flat honed slab of speckled grey Oregon granite: salt-and-pepper grains of white, grey and black",
  ),
  preset(
    "camo",
    "Camo",
    styled(
      "Classic woodland-style camouflage recoloured for snow: interlocking blotches of white, light grey, icy blue and slate",
      "printed fabric with a subtle texture",
    ),
  ),
  preset(
    "glacier",
    "Glacier",
    "Close-up of glacier ice: layered translucent blues from pale aqua to deep cobalt, with white fractures, trapped bubbles and swirling bands, rich and luminous",
  ),
  preset(
    "wave",
    "Wave",
    styled(
      "One colossal wave curling across the pair, with claw-like white foam, under a calm cream sky",
      "Japanese woodblock print, broad flat bands of Prussian blue, indigo and pale blue-grey, soft bokashi fade",
    ),
  ),
  preset(
    "wildflower",
    "Wildflower",
    styled(
      "An alpine meadow of lupine, Indian paintbrush and avalanche lilies in lilac, coral and green, with a faint soft Mt. Hood in the distance near the tips",
      "loose gouache painting, gentle colors with a little contrast",
    ),
  ),
  preset(
    "fern",
    "Fern",
    styled(
      "Western sword fern fronds running tip to tail: deep moss-green and olive silhouettes layered over a dark spruce-green ground",
      "botanical cyanotype-style print in natural forest greens, crisp leaflet edges",
    ),
  ),
  preset(
    "sunflower",
    "Sunflower",
    styled(
      "A few large sunflowers on tall winding stems with olive leaves on a bright mustard-yellow ground, spaced well apart with plenty of open ground, flower heads in golden yellow and burnt orange with dark brown dotted centers",
      "mid-century botanical pattern, flat crisp shapes",
    ),
  ),
  preset(
    "blanket",
    "Blanket",
    "A classic Oregon wool trading blanket: bold horizontal bands of deep red, mustard, forest green and black on cream, with visible wool weave",
  ),
  preset(
    "campfire",
    "Campfire",
    styled(
      "A campfire with crackling logs near the tails, flames rising toward the tips and sparks and stars above",
      "two-color woodcut print in warm orange and black ink on cream paper, bold carved lines",
    ),
  ),
  preset(
    "elk",
    "Elk",
    styled(
      "A Roosevelt elk bull standing on a ridge on the right ski, among Douglas firs, cliffs and a waterfall that continue across both skis",
      "mid-century travel poster, flat colors in rust, olive, mustard and deep teal on cream, crisp-edged shapes",
    ),
  ),
  preset(
    "river",
    "River",
    "Looking straight down into a clear, shallow Oregon mountain river: smooth rounded river stones in warm browns, greys and rust under rippling blue-green water, with bright sunlight caustics dancing over them, crisp and luminous, running tip to tail",
  ),
  preset(
    "cedar",
    "Cedar",
    "Real Western red cedar wood: warm reddish-brown straight grain with natural color variation running tip to tail, satin finish",
  ),
  preset(
    "firs",
    "Firs",
    styled(
      "A dense Douglas fir forest",
      "two-color risograph print in fluorescent orange and deep teal on cream paper, with visible riso grain",
    ),
  ),
  preset(
    "flannel",
    "Flannel",
    "Classic red and black buffalo check flannel fabric laid perfectly flat, with visible soft woven texture",
  ),
  preset(
    "salmon",
    "Salmon",
    styled(
      "Columbia River Chinook salmon swimming upstream: a few large fish, each shown whole, heads pointing up toward the tips, among flowing water lines",
      "bold three-color linocut print in deep red, slate blue and black ink on cream paper, crisp hand-carved texture",
    ),
  ),
  preset(
    "alpenglow",
    "Alpenglow",
    "A smooth alpenglow fade from warm peach at the tips through dusty pink to deep indigo at the tails, with fine film grain",
  ),
  preset(
    "lupine",
    "Lupine",
    styled(
      "Tall purple lupine flower spikes rising toward the tips, a few spikes on each ski with open space between them",
      "two-color risograph print in soft lavender violet and sage green ink on warm cream paper, slight misregistration and visible riso grain",
    ),
  ),
  preset(
    "pixel",
    "Pixel",
    styled(
      "Outer space like a 1990s video game background: planets with rings, twinkling stars and a nebula",
      "16-bit pixel art, chunky crisp hard-edged pixels, a limited palette of deep indigo, magenta, orange and pale yellow",
    ),
  ),
  preset(
    "neon",
    "Neon",
    "An 1980s ski racing livery: sharp angular stripes and zigzags in hot pink, electric teal and purple on black, with a subtle halftone texture",
  ),
  preset(
    "carpet",
    "Carpet",
    "A retro 80s airport carpet on a deep teal ground, loosely and irregularly scattered with little diamonds, dots, short dashes and meandering dashed flight paths in magenta, violet, gold and aqua, varied and not repeating, loop-pile texture",
  ),
  preset(
    "stars",
    "Starlight",
    styled(
      "A night sky, deep navy fading to indigo, with small cream and gold stars, a slim crescent moon near the tips and a soft glowing band of the Milky Way in muted violet, no mountains or land",
      "flat layered paper-cut",
    ),
  ),
  preset(
    "topo",
    "Topo",
    "Minimal topographic contour map of Mt. Hood: fine white contour lines on a near-black ground",
  ),
  preset(
    "hexdump",
    "Hexdump",
    "A hex dump as ski art: rows of small monospace hexadecimal bytes and memory addresses in soft amber on warm charcoal, with an ASCII column in pale cyan and a few rows picked out in muted rose and teal like a selection in a debugger, quiet and typographic",
  ),
  preset(
    "walnut",
    "Ebony",
    "A real book-matched ebonized black walnut wood veneer topsheet: very dark, nearly black wood with subtle deep brown grain running tip to tail, satin finish",
  ),
  preset(
    "basalt",
    "Basalt",
    "Dark Columbia Gorge basalt: a honed slab of near-black volcanic rock with subtle grey speckle and faint mineral veins",
  ),
];
