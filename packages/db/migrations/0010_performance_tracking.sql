-- Additive only: existing workouts, exercise rows, scoring rules and ledger are retained.
ALTER TABLE player_profiles ADD COLUMN performance_public integer NOT NULL DEFAULT 0 CHECK (performance_public IN (0,1));
ALTER TABLE workouts ADD COLUMN calories integer CHECK (calories IS NULL OR calories BETWEEN 1 AND 10000);
ALTER TABLE workouts ADD COLUMN calorie_source text CHECK (calorie_source IS NULL OR calorie_source IN ('device','estimated'));
CREATE INDEX workout_exercises_record_idx ON workout_exercises(name,reps,workout_id,load_grams);
