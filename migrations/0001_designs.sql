-- Every generated design. The artwork itself lives in R2 under designs/<id>.
CREATE TABLE designs (
  id TEXT PRIMARY KEY,
  -- The design this one was edited from: another design or an example.
  parent TEXT,
  prompt TEXT NOT NULL,
  -- Changes made after the prompt, oldest first, as a JSON array.
  edits TEXT NOT NULL DEFAULT '[]',
  ski TEXT NOT NULL,
  model TEXT,
  created INTEGER NOT NULL,
  -- Lets the browser that made the design upload its preview card, once.
  card_token TEXT
);
