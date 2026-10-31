// Align integration-fixture periods with the production agency cycle's
// Asia/Riyadh calendar. UTC months diverge for the final three hours of
// each UTC month, when payout and accrual tests must still stay correct.
export function riyadhPeriodKeys(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  const month = fields.year + "-" + fields.month;
  return {day: month + "-" + fields.day, month};
}

export function previousRiyadhMonthKey(date = new Date()) {
  const {month} = riyadhPeriodKeys(date);
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 2, 1))
    .toISOString().slice(0, 7);
}
