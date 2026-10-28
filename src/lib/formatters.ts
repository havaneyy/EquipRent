const phpCurrencyFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
});

export function formatPHP(value: number): string {
  return phpCurrencyFormatter.format(value);
}

export function formatPhilippinePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  let nationalNumber: string;

  if (/^09\d{9}$/.test(digits)) {
    nationalNumber = digits.slice(1);
  } else if (/^9\d{9}$/.test(digits)) {
    nationalNumber = digits;
  } else if (/^639\d{9}$/.test(digits)) {
    nationalNumber = digits.slice(2);
  } else {
    return value.trim();
  }

  return `+63 ${nationalNumber.slice(0, 3)} ${nationalNumber.slice(3, 6)} ${nationalNumber.slice(6)}`;
}

export function getOrderTotal(order: {
  total_amount?: number | null;
  subtotal_amount?: number | null;
  insurance_amount?: number | null;
  tax_amount?: number | null;
}): number {
  if (typeof order.total_amount === 'number' && order.total_amount > 0) {
    return order.total_amount;
  }
  const subtotal = order.subtotal_amount || 0;
  const insurance = order.insurance_amount || 0;
  const tax =
    typeof order.tax_amount === 'number' && order.tax_amount > 0
      ? order.tax_amount
      : Math.round((subtotal + insurance) * 0.08 * 100) / 100;
  return Math.round((subtotal + insurance + tax) * 100) / 100;
}
