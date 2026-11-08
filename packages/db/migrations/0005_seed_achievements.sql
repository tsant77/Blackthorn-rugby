-- Club badge definitions. No player rows.
INSERT INTO achievements (id, club_id, key, name, description, criteria_json, created_at, updated_at) VALUES
  ('ach_first_session', 'club_blackthorn', 'first_session', 'First session', 'Log the first workout that counts.', '{"kind":"sessions","count":1}', 1794096000000, 1794096000000),
  ('ach_streak_3', 'club_blackthorn', 'streak_3', 'Three-day streak', 'Train three days in a row.', '{"kind":"streak","days":3}', 1794096000000, 1794096000000),
  ('ach_streak_7', 'club_blackthorn', 'streak_7', 'Seven-day streak', 'Train seven days in a row.', '{"kind":"streak","days":7}', 1794096000000, 1794096000000),
  ('ach_points_50', 'club_blackthorn', 'points_50', '50 points', 'Earn 50 points on the ledger.', '{"kind":"points","tenths":500}', 1794096000000, 1794096000000),
  ('ach_points_250', 'club_blackthorn', 'points_250', '250 points', 'Earn 250 points on the ledger.', '{"kind":"points","tenths":2500}', 1794096000000, 1794096000000),
  ('ach_variety_3', 'club_blackthorn', 'variety_3', 'Three activities', 'Log three different activity types.', '{"kind":"variety","types":3}', 1794096000000, 1794096000000),
  ('ach_variety_7', 'club_blackthorn', 'variety_7', 'Full mix', 'Log every activity type.', '{"kind":"variety","types":7}', 1794096000000, 1794096000000);
