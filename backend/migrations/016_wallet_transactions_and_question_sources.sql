CREATE TABLE IF NOT EXISTS wallet_transactions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  amount INT NOT NULL,
  balance_after INT NOT NULL,
  reason VARCHAR(80) NOT NULL,
  reference_type VARCHAR(80) NOT NULL,
  reference_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wallet_transaction_reference (user_id, reason, reference_type, reference_id),
  CONSTRAINT wallet_transactions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE questions
  ADD COLUMN source_question_id VARCHAR(120) NULL UNIQUE AFTER id;