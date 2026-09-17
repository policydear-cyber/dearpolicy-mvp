-- Additive, repeatable upgrade. Policy documents and coverages are untouched.
CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid REFERENCES family_members(id) ON DELETE CASCADE,
  title text NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  state jsonb NOT NULL DEFAULT '{"subjects":{}}'::jsonb,
  last_answer jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_scope
  ON chat_conversations(account_id,family_member_id,updated_at DESC,id);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES chat_conversations(id) ON DELETE CASCADE;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS answer_json jsonb;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS message_order bigserial;
CREATE INDEX IF NOT EXISTS idx_chat_messages_ordered
  ON chat_messages(account_id,conversation_id,created_at,message_order);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON chat_messages(account_id,conversation_id,created_at,id);
CREATE TABLE IF NOT EXISTS chat_history_epochs (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  epoch bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,scope_key)
);
CREATE TABLE IF NOT EXISTS chat_analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid REFERENCES family_members(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES chat_conversations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  request_json jsonb NOT NULL,
  progress jsonb NOT NULL DEFAULT '{"stage":"Queued","completed":0,"total":0}'::jsonb,
  result_json jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_jobs_scope ON chat_analysis_jobs(account_id,status,created_at);
CREATE TABLE IF NOT EXISTS policy_analysis_cache (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  analysis_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,cache_key)
);
ALTER TABLE policy_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english',coalesce(heading,'') || ' ' || text)) STORED;
CREATE INDEX IF NOT EXISTS idx_policy_chunks_search ON policy_chunks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_policy_pages_account_policy ON policy_pages(account_id,policy_id,page_number);

-- Keep every previous guided session addressable, including its saved facts.
INSERT INTO chat_conversations(id,account_id,family_member_id,title,state,created_at,updated_at)
SELECT id,account_id,family_member_id,coalesce(event_summary,'Previous claim check'),
  jsonb_build_object('subjects','{}'::jsonb,'legacyFacts',facts,'legacyPending',pending_question,'intent','claim'),
  created_at,updated_at
FROM claim_sessions ON CONFLICT(id) DO NOTHING;
UPDATE chat_messages m SET conversation_id=m.claim_session_id
WHERE m.conversation_id IS NULL AND m.claim_session_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM chat_conversations c WHERE c.id=m.claim_session_id AND c.account_id=m.account_id);

-- Ordinary policy chats previously had no conversation identifier.
INSERT INTO chat_conversations(id,account_id,family_member_id,title,created_at,updated_at)
SELECT md5('dearpolicy-old-chat:' || account_id::text || ':' || coalesce(family_member_id::text,'family'))::uuid,
  account_id,family_member_id,'Previous policy questions',min(created_at),max(created_at)
FROM chat_messages WHERE conversation_id IS NULL GROUP BY account_id,family_member_id
ON CONFLICT(id) DO NOTHING;
UPDATE chat_messages m SET conversation_id=
  md5('dearpolicy-old-chat:' || m.account_id::text || ':' || coalesce(m.family_member_id::text,'family'))::uuid
WHERE m.conversation_id IS NULL;
