-- Clean up legacy duplicate active challenges before applying active pair constraint
UPDATE challenges c
JOIN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY (CASE WHEN challenger_id < challenged_id THEN CONCAT(challenger_id, ':', challenged_id) ELSE CONCAT(challenged_id, ':', challenger_id) END)
             ORDER BY created_at DESC, id DESC
           ) as rn
    FROM challenges
    WHERE status IN ('pending', 'accepted')
  ) ranked
  WHERE ranked.rn > 1
) dupes ON c.id = dupes.id
SET c.status = 'expired';

-- Expand status ENUM to include 'cancelled'
ALTER TABLE challenges MODIFY COLUMN status ENUM('pending', 'accepted', 'declined', 'completed', 'expired', 'cancelled') NOT NULL DEFAULT 'pending';

-- Drop legacy uq_challenges_active_pair index if present
DROP INDEX uq_challenges_active_pair ON challenges;

-- Add canonical pair_key virtual column
ALTER TABLE challenges ADD COLUMN pair_key VARCHAR(73) GENERATED ALWAYS AS (
  CASE WHEN challenger_id < challenged_id
       THEN CONCAT(challenger_id, ':', challenged_id)
       ELSE CONCAT(challenged_id, ':', challenger_id)
  END
) VIRTUAL;

-- Add active_pair_key virtual column (NULL for terminal statuses: completed, declined, cancelled, expired)
ALTER TABLE challenges ADD COLUMN active_pair_key VARCHAR(73) GENERATED ALWAYS AS (
  CASE WHEN status IN ('pending', 'accepted')
       THEN (CASE WHEN challenger_id < challenged_id
                  THEN CONCAT(challenger_id, ':', challenged_id)
                  ELSE CONCAT(challenged_id, ':', challenger_id)
             END)
       ELSE NULL
  END
) VIRTUAL;

-- Enforce strictly ONE active challenge/session per pair regardless of direction
ALTER TABLE challenges ADD UNIQUE KEY uq_challenges_active_pair (active_pair_key);

-- Add index on pair_key and status for fast lookups
ALTER TABLE challenges ADD INDEX idx_challenges_pair_key_status (pair_key, status);
