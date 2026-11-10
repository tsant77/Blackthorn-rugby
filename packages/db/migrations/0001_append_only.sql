-- Ledger and audit rows are corrected by inserting a new row, never by editing history.
CREATE TRIGGER point_transactions_no_update
BEFORE UPDATE ON point_transactions
BEGIN
  SELECT RAISE(ABORT, 'point_transactions are immutable');
END;

CREATE TRIGGER point_transactions_no_delete
BEFORE DELETE ON point_transactions
BEGIN
  SELECT RAISE(ABORT, 'point_transactions are immutable');
END;

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are immutable');
END;

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are immutable');
END;
