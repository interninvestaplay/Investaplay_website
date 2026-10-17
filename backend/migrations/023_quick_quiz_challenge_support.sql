-- Quick Quiz Challenge support: metadata columns for challenges and rooms

ALTER TABLE challenges ADD COLUMN quiz_type VARCHAR(40) NULL DEFAULT 'standard';
ALTER TABLE challenges ADD COLUMN topic VARCHAR(120) NULL;
ALTER TABLE challenges ADD COLUMN difficulty VARCHAR(20) NULL;
ALTER TABLE challenges ADD COLUMN question_limit INT NULL;
ALTER TABLE challenges ADD COLUMN custom_question_ids JSON NULL;

ALTER TABLE rooms ADD COLUMN custom_question_ids JSON NULL;
