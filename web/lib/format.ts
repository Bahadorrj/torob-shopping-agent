const faNumber = new Intl.NumberFormat("fa-IR");

// Torob groups thousands with U+066B, not the U+066C that fa-IR gives
export const faDigits = (n: number) => faNumber.format(n).replaceAll("٬", "٫");

// the only word for a missing value; render it muted
export const UNKNOWN = "نامشخص";

export const toman = (n: number) => `${faDigits(n)} تومان`;

// the lowest of several prices
export const fromToman = (n: number) => `از ${toman(n)}`;

// the value of the "آخرین تغییر قیمت" slot
export function priceAge(days: number | null) {
  if (days === null) return UNKNOWN;
  const age = days === 0 ? "امروز" : days < 60 ? `${faDigits(days)} روز پیش` : `${faDigits(Math.floor(days / 30))} ماه پیش`;
  return days > 30 ? `${age}، قدیمی` : age;
}

export function openLabel(openNow: boolean | null) {
  if (openNow === null) return `ساعت کاری: ${UNKNOWN}`;
  return openNow ? "الان باز" : "بسته";
}

// ASCII digits inside free text, e.g. "علاالدین 2" or "09:30", in Persian digits
export const faText = (s: string) => s.replace(/\d/g, (d) => faDigits(Number(d)));

export function distance(m: number) {
  return m < 1000 ? `${faDigits(m)} متر` : `${faDigits(Math.round(m / 100) / 10)} کیلومتر`;
}

// shortcut: the device's local date stands in for the Tehran date; fine while users are in Iran
export function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function locate(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), reject),
  );
}
