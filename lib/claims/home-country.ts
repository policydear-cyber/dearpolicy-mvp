/**
 * Where a household lives, and whether a place a family names is at home or overseas. DearPolicy is used by households
 * anywhere: "overseas" is relative to the household, never to Singapore (new-user walkthrough, 31 Oct: an Australian
 * family's ankle broken at work in Sydney was recorded as "Overseas", so travel insurance's overseas medical cover was
 * offered for an accident at home).
 *
 * The household's home country is read from its own documents: the currencies its policies state. When they name one
 * country's currency (Australian dollars, ringgit, pounds), that is home; US dollars and euros name no one country; two
 * countries' currencies, or none stated, leave home unknown. An unknown home never assumes one: a named place is then
 * neither at home nor overseas, and the chat asks.
 */
import { statedCurrencyCode } from "@/lib/format/currency";

/** The country whose currency each code is, for currencies used by one country only. */
const CURRENCY_COUNTRY: Record<string, string> = {
  SGD: "Singapore", MYR: "Malaysia", AUD: "Australia", NZD: "New Zealand", GBP: "United Kingdom", HKD: "Hong Kong",
  PHP: "Philippines", IDR: "Indonesia", THB: "Thailand", INR: "India", JPY: "Japan", CAD: "Canada", CNY: "China",
  TWD: "Taiwan", KRW: "South Korea", VND: "Vietnam", CHF: "Switzerland", ZAR: "South Africa", AED: "United Arab Emirates",
  BND: "Brunei", LKR: "Sri Lanka", PKR: "Pakistan", BDT: "Bangladesh", MOP: "Macau",
};

/** The household's home country from the currencies its documents state, or null when they do not name one country. */
export function homeCountryFromCurrencies(codes: (string | null | undefined)[]): string | null {
  const countries = new Set(codes.map((c) => statedCurrencyCode(c)).filter((c): c is string => !!c).map((c) => CURRENCY_COUNTRY[c]).filter(Boolean));
  return countries.size === 1 ? [...countries][0] : null;
}

/** Named places and the country each is in. A place listed here is told apart from home; any other place is unknown. */
const PLACES: [RegExp, string][] = [
  [/\b(?:singapore|nccs|kkh|sgh|ttsh|nuh|cgh|ktph|polyclinic|mount elizabeth|gleneagles|raffles hospital|mount alvernia|thomson medical|changi general|tan tock seng|singapore general|national university hospital|sentosa|jurong|woodlands|tampines|orchard road)\b/i, "Singapore"],
  [/\b(?:malaysia|kuala lumpur|\bkl\b|johor(?: bahru)?|\bjb\b|penang|malacca|melaka|ipoh|langkawi|sabah|sarawak|kota kinabalu|kuching|putrajaya|selangor|petaling jaya)\b/i, "Malaysia"],
  [/\b(?:australia|sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|darwin|gold coast|cairns|queensland|new south wales|victoria, australia|tasmania)\b/i, "Australia"],
  [/\b(?:new zealand|auckland|wellington|christchurch|queenstown)\b/i, "New Zealand"],
  [/\b(?:united kingdom|\buk\b|england|scotland|wales|london|manchester|birmingham|edinburgh|glasgow|liverpool)\b/i, "United Kingdom"],
  [/\b(?:hong kong)\b/i, "Hong Kong"],
  [/\b(?:thailand|phuket|bangkok|chiang mai|pattaya|krabi|koh samui)\b/i, "Thailand"],
  [/\b(?:indonesia|bali|jakarta|batam|bintan|surabaya|bandung|lombok|yogyakarta)\b/i, "Indonesia"],
  [/\b(?:japan|tokyo|osaka|kyoto|hokkaido|sapporo|okinawa|fukuoka|nagoya)\b/i, "Japan"],
  [/\b(?:south korea|korea|seoul|busan|jeju)\b/i, "South Korea"],
  [/\b(?:taiwan|taipei|kaohsiung)\b/i, "Taiwan"],
  [/\b(?:china|beijing|shanghai|shenzhen|guangzhou|chengdu|xiamen)\b/i, "China"],
  [/\b(?:vietnam|hanoi|ho chi minh|saigon|da nang)\b/i, "Vietnam"],
  [/\b(?:philippines|manila|cebu|boracay|davao)\b/i, "Philippines"],
  [/\b(?:india|mumbai|delhi|bangalore|bengaluru|chennai|kolkata|goa)\b/i, "India"],
  [/\b(?:usa|u\.s\.a?\.?|united states|america|new york|california|los angeles|san francisco|hawaii|las vegas|florida)\b/i, "United States"],
  [/\b(?:canada|toronto|vancouver|montreal)\b/i, "Canada"],
  [/\b(?:france|paris|nice)\b/i, "France"],
  [/\b(?:italy|rome|milan|venice|florence)\b/i, "Italy"],
  [/\b(?:spain|madrid|barcelona)\b/i, "Spain"],
  [/\b(?:germany|berlin|munich|frankfurt)\b/i, "Germany"],
  [/\b(?:switzerland|zurich|geneva)\b/i, "Switzerland"],
  [/\b(?:cambodia|siem reap|phnom penh)\b/i, "Cambodia"],
  [/\b(?:maldives)\b/i, "Maldives"],
  [/\b(?:dubai|abu dhabi|united arab emirates|uae)\b/i, "United Arab Emirates"],
];
/** A continent or region: away from home for a household whose home is not in it. */
const REGIONS: [RegExp, Set<string>][] = [
  [/\beurope\b/i, new Set(["United Kingdom", "France", "Italy", "Spain", "Germany", "Switzerland"])],
];

/** The words that put a place where something happened: "in Sydney", "at KKH", "on holiday to Bali", "back from
 * Penang". A place name anywhere else is not read as one: "a nice time", "Florence's knee", "Darwin fell", "the Prince
 * of Wales Hospital" (test engineer, 31 Oct). */
const LOCATIVE = /\b(?:in|at|to|from|near|around|visiting|visit|across|through|outside|inside|into|towards?|via|within|on)\s+(?:the\s+)?(?:(?:city|centre|center|middle|north|south|east|west|northern|southern|eastern|western|central|downtown|outskirts|island|state|region)\s+(?:of\s+)?)?$/i;

/** The country a place a family named is in, or null when it is not one listed (a park, an office, a town not listed).
 * A closed, positive match: the text is only the place ("Sydney", an answer to "Where did it happen?"), or the place
 * follows a word that says where (LOCATIVE). */
export function placeCountry(text: string | null | undefined): string | null {
  const t = String(text ?? "").trim();
  const bare = t.replace(/^(?:in|at)\s+/i, "").replace(/[\s.!?,;:]+$/, "");
  for (const [pattern, country] of PLACES) {
    const whole = bare.match(pattern);
    if (whole && whole.index === 0 && whole[0].length === bare.length) return country;
    for (const m of t.matchAll(new RegExp(pattern.source, "gi"))) if (LOCATIVE.test(t.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0))) return country;
  }
  return null;
}

const OVERSEAS_WORDS = /\b(?:overseas|abroad|outside (?:of )?(?:the country|my country|our country|home))\b/i;
const HOME_WORDS = /\b(?:at home|home country|my country|our country|where (?:we|i) live|local(?:ly)?|in (?:my|our) (?:own )?(?:country|city|town))\b|^\s*home\s*$/i;

/** Whether a place is away from the household's home: true overseas, false at home, null when that cannot be told
 * (home unknown, or a place that is not listed). */
export function awayFromHome(location: string | null | undefined, home: string | null): boolean | null {
  const t = String(location ?? "").trim();
  if (!t) return null;
  if (OVERSEAS_WORDS.test(t)) return true;
  if (HOME_WORDS.test(t)) return false;
  const country = placeCountry(t);
  if (country) return home ? country !== home : null;
  for (const [pattern, countries] of REGIONS) {
    const m = t.match(pattern);
    if (m && (m[0].length === t.replace(/[\s.!?]+$/, "").length || LOCATIVE.test(t.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0)))) return home ? !countries.has(home) : null;
  }
  return null;
}
