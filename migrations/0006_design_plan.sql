-- What the design was planned as (see src/server/plan.ts): the background
-- in the image model's terms, and the decals the studio places on the
-- skis, as JSON. NULL for designs from before plans, whose art is all
-- background.
ALTER TABLE designs ADD COLUMN plan TEXT;
