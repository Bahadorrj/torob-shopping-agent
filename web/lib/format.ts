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
