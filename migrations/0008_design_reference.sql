-- The picture the design was asked to look like, if any: an upload, in R2
-- under uploads/<id>. Each version made from the design keeps it, until
-- its maker takes it off.
ALTER TABLE designs ADD COLUMN reference TEXT;
