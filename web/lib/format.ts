const faNumber = new Intl.NumberFormat("fa-IR");

export const faDigits = (n: number) => faNumber.format(n);

export function toman(min: number, max: number) {
  return min === max ? `${faDigits(min)} تومان` : `${faDigits(min)} تا ${faDigits(max)} تومان`;
}

export function priceAge(days: number | null) {
  if (days === null) return "تاریخ تغییر قیمت ثبت نشده";
  return days === 0 ? "آخرین تغییر قیمت: امروز" : `آخرین تغییر قیمت: ${faDigits(days)} روز پیش`;
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
