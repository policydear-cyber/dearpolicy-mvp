/** The household currency choices (lib/documents/household-currency): no imports, so the settings page can use them. */
/** The currencies a household can choose. "NONE" is "Don't assume a currency". */
export const HOUSEHOLD_CURRENCIES = ["SGD", "USD", "HKD", "AUD", "MYR", "GBP", "EUR", "PHP"] as const;
export type HouseholdCurrency = (typeof HOUSEHOLD_CURRENCIES)[number];
export const NO_HOUSEHOLD_CURRENCY = "NONE" as const;
export type HouseholdCurrencySetting = HouseholdCurrency | typeof NO_HOUSEHOLD_CURRENCY;

export const HOUSEHOLD_CURRENCY_LABELS: Record<HouseholdCurrencySetting, string> = {
  SGD: "Singapore dollar (S$)", USD: "US dollar (US$)", HKD: "Hong Kong dollar (HK$)", AUD: "Australian dollar (A$)",
  MYR: "Malaysian ringgit (RM)", GBP: "British pound (£)", EUR: "Euro (€)", PHP: "Philippine peso (₱)",
  NONE: "Don't assume a currency",
};

