-- Member profile: a household member's sex, as the household enters it on Account settings > Family.
--
-- Why it is collected: policies and the chat speak of people as "my son", "my daughter", "she", "he". Until now the
-- app could only tell a member's sex from relationship words ("wife", "son"); a member recorded as "child", "parent"
-- or "sibling" had none, so "my daughter" could not be told apart from "my son" and the household was asked again.
-- Values: 'female', 'male', or 'unspecified' (the household chose not to say). NULL means not yet answered, so the
-- Family page can ask existing members to complete their profile. Nothing else (no ID numbers, no occupation, no
-- smoker status) is stored: nothing in the answer pipeline uses them.
--
-- Safe to run more than once. Table-level grants and RLS on family_members (household-rls.sql) cover the new column.
-- The application reads the column through to_jsonb(...)->>'sex' and checks it exists before writing it, so the build
-- works before and after this file is applied; the sex field on the Family page appears once it is.
-- Rollback: ALTER TABLE family_members DROP COLUMN IF EXISTS sex;
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS sex text;
ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_sex_check;
ALTER TABLE family_members ADD CONSTRAINT family_members_sex_check CHECK (sex IS NULL OR sex IN ('female', 'male', 'unspecified'));
