-- The customer's own images on the skis, and any decals moved by hand, as
-- a JSON array bottom of the stack first (see src/client/uploads.ts). The
-- images themselves live in R2 under uploads/<id>, with what each shows,
-- for the planner, under captions/<id>. NULL for designs from before.
ALTER TABLE designs ADD COLUMN uploads TEXT;
