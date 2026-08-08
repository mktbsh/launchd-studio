const UNIT_SECONDS: Readonly<Record<string, number>> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

export function parseDurationSeconds(value: string): number | null {
  if (value.length === 0 || !/^\d+(?:s|m|h|d)(?:\d+(?:s|m|h|d))*$/u.test(value)) {
    return null;
  }

  let total = 0;
  let consumed = "";
  for (const match of value.matchAll(/(\d+)(s|m|h|d)/gu)) {
    const amountText = match[1];
    const unit = match[2];
    if (amountText === undefined || unit === undefined) {
      return null;
    }
    const amount = Number.parseInt(amountText, 10);
    const multiplier = UNIT_SECONDS[unit];
    if (!Number.isSafeInteger(amount) || multiplier === undefined) {
      return null;
    }
    total += amount * multiplier;
    consumed += match[0];
  }

  if (consumed !== value || !Number.isSafeInteger(total) || total <= 0) {
    return null;
  }

  return total;
}
