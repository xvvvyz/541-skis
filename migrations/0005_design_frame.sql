-- Where the pair sits on the art, as JSON { x, y, size } (see
-- src/client/frame.ts). NULL for the default: centered, as big as fits.
ALTER TABLE designs ADD COLUMN frame TEXT;
