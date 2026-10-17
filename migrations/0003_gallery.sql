-- The gallery. The maker's browser holds the owner token; the shop's email
-- holds the review token.
ALTER TABLE designs ADD COLUMN owner_hash TEXT;
ALTER TABLE designs ADD COLUMN review_hash TEXT;
-- NULL while it's off the gallery.
ALTER TABLE designs ADD COLUMN published INTEGER;
-- 1 shown, 0 kept out, NULL not reviewed. Kept if the maker re-adds it.
ALTER TABLE designs ADD COLUMN approved INTEGER;
CREATE INDEX designs_gallery ON designs (published) WHERE approved = 1;
