-- The household's own currency (Account settings, DC 17 Nov 2026): the currency a household says its policies are in.
-- A cover amount whose document prints no currency, and names no other currency anywhere, is read in it
-- (lib/documents/household-currency.ts). NULL = not chosen (the app uses S$); 'NONE' = "Don't assume a currency".
--
-- Additive only: one nullable column, nothing existing is changed or dropped. Owner-only writes come from the existing
-- accounts_update RLS policy (is_household_owner()), as for the household's name.
-- Code deployed before this file is applied keeps working without it (lib/household/currency.ts reads the column
-- through to_jsonb; a household reads as "not chosen", and saving the setting says it is not available yet).
-- Applies to documents read after a change; a document already read keeps what it showed until it is read again.
-- Rollback: ALTER TABLE accounts DROP COLUMN IF EXISTS currency;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS currency text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_currency_check') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_currency_check
      CHECK (currency IS NULL OR currency IN ('SGD','USD','HKD','AUD','MYR','GBP','EUR','PHP','NONE'));
  END IF;
END $$;
