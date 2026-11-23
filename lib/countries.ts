/**
 * Country names from location names ("Marienplatz, Munich, Germany" → "Germany") and the matching
 * with Mapbox's country-boundaries layer (name_en). Names are compared accent-free and lower-case.
 */

const COUNTRIES = (
  "Afghanistan|Albania|Algeria|Andorra|Angola|Antigua and Barbuda|Argentina|Armenia|Australia|Austria|Azerbaijan|Bahamas|Bahrain|Bangladesh|Barbados|Belarus|Belgium|Belize|Benin|Bhutan|Bolivia|Bosnia and Herzegovina|Botswana|Brazil|Brunei|Bulgaria|Burkina Faso|Burundi|Cambodia|Cameroon|Canada|Cape Verde|Central African Republic|Chad|Chile|China|Colombia|Comoros|Costa Rica|Croatia|Cuba|Cyprus|Czechia|Democratic Republic of the Congo|Denmark|Djibouti|Dominica|Dominican Republic|Ecuador|Egypt|El Salvador|Equatorial Guinea|Eritrea|Estonia|Eswatini|Ethiopia|Faroe Islands|Fiji|Finland|France|Gabon|Gambia|Georgia|Germany|Ghana|Greece|Greenland|Grenada|Guatemala|Guinea|Guinea-Bissau|Guyana|Haiti|Honduras|Hong Kong|Hungary|Iceland|India|Indonesia|Iran|Iraq|Ireland|Israel|Italy|Ivory Coast|Jamaica|Japan|Jordan|Kazakhstan|Kenya|Kiribati|Kosovo|Kuwait|Kyrgyzstan|Laos|Latvia|Lebanon|Lesotho|Liberia|Libya|Liechtenstein|Lithuania|Luxembourg|Macau|Madagascar|Malawi|Malaysia|Maldives|Mali|Malta|Marshall Islands|Mauritania|Mauritius|Mexico|Micronesia|Moldova|Monaco|Mongolia|Montenegro|Morocco|Mozambique|Myanmar|Namibia|Nauru|Nepal|Netherlands|New Zealand|Nicaragua|Niger|Nigeria|North Korea|North Macedonia|Norway|Oman|Pakistan|Palau|Palestine|Panama|Papua New Guinea|Paraguay|Peru|Philippines|Poland|Portugal|Puerto Rico|Qatar|Republic of the Congo|Romania|Russia|Rwanda|Saint Kitts and Nevis|Saint Lucia|Saint Vincent and the Grenadines|Samoa|San Marino|Sao Tome and Principe|Saudi Arabia|Senegal|Serbia|Seychelles|Sierra Leone|Singapore|Slovakia|Slovenia|Solomon Islands|Somalia|South Africa|South Korea|South Sudan|Spain|Sri Lanka|Sudan|Suriname|Sweden|Switzerland|Syria|Taiwan|Tajikistan|Tanzania|Thailand|Timor-Leste|Togo|Tonga|Trinidad and Tobago|Tunisia|Turkey|Turkmenistan|Tuvalu|Uganda|Ukraine|United Arab Emirates|United Kingdom|United States|Uruguay|Uzbekistan|Vanuatu|Vatican City|Venezuela|Vietnam|Yemen|Zambia|Zimbabwe"
).split("|");

/** alias → canonical name (all accent-free lower-case) */
const ALIASES: Record<string, string> = {
  usa: "United States", us: "United States", "u.s.": "United States", "u.s.a.": "United States",
  "united states of america": "United States", america: "United States",
  uk: "United Kingdom", "u.k.": "United Kingdom", england: "United Kingdom", scotland: "United Kingdom",
  wales: "United Kingdom", "northern ireland": "United Kingdom", "great britain": "United Kingdom", britain: "United Kingdom",
  "czech republic": "Czechia", turkiye: "Turkey", holland: "Netherlands", "the netherlands": "Netherlands",
  "republic of korea": "South Korea", korea: "South Korea", "russian federation": "Russia",
  uae: "United Arab Emirates", burma: "Myanmar", "cote d'ivoire": "Ivory Coast", "cote divoire": "Ivory Coast",
  swaziland: "Eswatini", macedonia: "North Macedonia", "cabo verde": "Cape Verde", "east timor": "Timor-Leste",
  "democratic republic of congo": "Democratic Republic of the Congo", "dr congo": "Democratic Republic of the Congo",
  drc: "Democratic Republic of the Congo", "congo-kinshasa": "Democratic Republic of the Congo",
  "republic of congo": "Republic of the Congo", congo: "Republic of the Congo", "the gambia": "Gambia",
  "the bahamas": "Bahamas", "hong kong sar": "Hong Kong", "macao": "Macau", "viet nam": "Vietnam",
  "state of palestine": "Palestine", "palestinian territories": "Palestine", "bosnia & herzegovina": "Bosnia and Herzegovina",
  "bosnia": "Bosnia and Herzegovina", "trinidad & tobago": "Trinidad and Tobago", "sao tome & principe": "Sao Tome and Principe",
  "vatican": "Vatican City", "holy see": "Vatican City", "myanmar (burma)": "Myanmar", "south georgia": "United Kingdom",
};

export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const BY_KEY = new Map<string, string>();
for (const c of COUNTRIES) BY_KEY.set(norm(c), c);
for (const [alias, canon] of Object.entries(ALIASES)) BY_KEY.set(norm(alias), canon);

/** "Romania" / "USA" / "Türkiye" → canonical country name, or null when it is not a country */
export function canonicalCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return BY_KEY.get(norm(raw)) ?? null;
}

/** The country at the end of a "Place, Town, Country" location name */
export function countryFromLocation(locationName: string | null | undefined): string | null {
  if (!locationName) return null;
  const parts = locationName.split(",");
  return canonicalCountry(parts[parts.length - 1]);
}

/** Every spelling the boundary layer may use for this canonical country (for the highlight filter) */
export function boundaryNames(canonical: string): string[] {
  const out = new Set<string>([canonical]);
  for (const [alias, canon] of Object.entries(ALIASES)) if (canon === canonical) out.add(alias);
  if (canonical === "Czechia") out.add("Czech Republic");
  if (canonical === "Turkey") out.add("Türkiye");
  if (canonical === "Ivory Coast") out.add("Côte d'Ivoire");
  if (canonical === "Eswatini") out.add("Swaziland");
  if (canonical === "Cape Verde") out.add("Cabo Verde");
  if (canonical === "Sao Tome and Principe") out.add("São Tomé and Príncipe");
  return [...out];
}
