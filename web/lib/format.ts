const faNumber = new Intl.NumberFormat("fa-IR");

export const faDigits = (n: number) => faNumber.format(n);

export function toman(min: number, max: number) {
  return min === max ? `${faDigits(min)} تومان` : `${faDigits(min)} تا ${faDigits(max)} تومان`;
}

export function priceAge(days: number | null) {
  if (days === null) return "تاریخ تغییر قیمت ثبت نشده";
  return days === 0 ? "آخرین تغییر قیمت: امروز" : `آخرین تغییر قیمت: ${faDigits(days)} روز پیش`;
}
