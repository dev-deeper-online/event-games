-- Identifies the opponent's retry after the first wrong answer commits.
alter table match_questions add column retry_id uuid;
