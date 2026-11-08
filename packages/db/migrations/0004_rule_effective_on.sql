UPDATE scoring_rule_versions
SET effective_on = '2026-11-08'
WHERE id = 'rule_v1' AND effective_on IS NULL;
