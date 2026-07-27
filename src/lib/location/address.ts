const ADDRESS_PATTERN =
  /\b\d{1,6}\s+[A-Za-z][A-Za-z0-9.#'-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.#'-]*)*?,\s*([A-Za-z][A-Za-z\s.'-]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/;
const ADDRESS_WITHOUT_CITY_COMMA_PATTERN =
  /\b\d{1,6}\s+[A-Za-z][A-Za-z0-9.#'-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.#'-]*)*?\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/;

export type ParsedAddress = {
  formattedAddress: string;
  city: string;
  state: string;
  zip?: string;
};

export function parseCityStateFromAddress(value: string): ParsedAddress | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  const match = ADDRESS_PATTERN.exec(normalized) ?? ADDRESS_WITHOUT_CITY_COMMA_PATTERN.exec(normalized);

  if (!match) {
    return undefined;
  }

  const city = toTitleCase(match[1].trim());
  const state = match[2].toUpperCase();
  const zip = match[3];
  const formattedAddress = match[0].replace(/\s+/g, " ").trim();

  return {
    formattedAddress,
    city,
    state,
    zip,
  };
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) => {
      if (/^\s+$|^-$/.test(part)) {
        return part;
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}
