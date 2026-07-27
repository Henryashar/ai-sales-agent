export type USPhoneTimezone = "Pacific" | "Mountain" | "Central" | "Eastern" | "Unknown";

const TIMEZONE_BY_AREA_CODE: Record<string, Exclude<USPhoneTimezone, "Unknown">> = {
  ...mapAreaCodes("Pacific", [
    "206", "253", "360", "425", "503", "541", "971", "310", "213", "323", "424", "818", "619", "858",
    "760", "415", "510", "925", "408", "916", "702", "725", "775",
  ]),
  ...mapAreaCodes("Mountain", [
    "303", "720", "719", "970", "480", "602", "623", "520", "928", "801", "385", "307", "406", "208",
  ]),
  ...mapAreaCodes("Central", [
    "312", "773", "630", "847", "214", "972", "469", "713", "832", "281", "612", "651", "763", "414",
    "608",
  ]),
  ...mapAreaCodes("Eastern", [
    "212", "646", "718", "917", "347", "305", "786", "954", "561", "404", "770", "678", "617", "857",
    "781",
  ]),
};

export function getTimezoneFromPhone(phone: string): USPhoneTimezone {
  const areaCode = phone.replace(/\D/g, "").slice(0, 3);

  return TIMEZONE_BY_AREA_CODE[areaCode] ?? "Unknown";
}

function mapAreaCodes<T extends Exclude<USPhoneTimezone, "Unknown">>(timezone: T, areaCodes: string[]) {
  return Object.fromEntries(areaCodes.map((areaCode) => [areaCode, timezone])) as Record<string, T>;
}
