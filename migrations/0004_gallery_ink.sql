-- The marks' colours as the studio picked them from the full art, as JSON
-- { marks, outlines }, so the gallery's small copy draws them the same.
ALTER TABLE designs ADD COLUMN gallery_ink TEXT;
