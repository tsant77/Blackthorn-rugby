CREATE TABLE IF NOT EXISTS team_suggestions (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL, author_user_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('feature','improvement','bug')),
  title TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','planned','in_progress','completed','declined')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_suggestions_club ON team_suggestions(club_id,created_at DESC);
CREATE TABLE IF NOT EXISTS suggestion_votes (
  suggestion_id TEXT NOT NULL REFERENCES team_suggestions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(suggestion_id,user_id)
);
CREATE TABLE IF NOT EXISTS suggestion_announcements (
  user_id TEXT NOT NULL, announcement_key TEXT NOT NULL, seen_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,announcement_key)
);
