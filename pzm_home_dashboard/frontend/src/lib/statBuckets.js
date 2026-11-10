// Date handling for the /solar/daily and /solar/monthly payloads.
//
// Home Assistant buckets long-term statistics at LOCAL midnight. The backend
// sends each bucket's start as unix ms (`t`) plus legacy UTC date parts
// (`year`/`month`/`day`). East of Greenwich local midnight is still the
// previous day in UTC, so the UTC parts label every bucket one day — or, for
// the 1st, one month — early. Derive the calendar date from `t` in the
// browser's timezone instead; the parts are only a fallback for payloads
// without a timestamp.
export function bucketDate(item) {
  if (item && Number.isFinite(item.t) && item.t > 0) {
    const d = new Date(item.t);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
  return { year: item?.year, month: item?.month, day: item?.day };
}

// Bucket the /solar/daily payload into last-N-days chart items, keyed by
// Y-M-D so React can match bars stably across polls. Carries the date parts
// so the Solar callout can print weekday initials under bars.
export function bucketByDay(days) {
  if (!days || days.length === 0) return [];
  return days.map((d) => {
    const { year, month, day } = bucketDate(d);
    return {
      key: `${year}-${month}-${day}`,
      v: Math.max(0, Number(d.v) || 0),
      year,
      month,
      day,
    };
  });
}

// The bucket for the calendar month containing `now`; when none matches
// (statistics lagging right after a month rolls over) the newest bucket.
export function pickCurrentMonth(months, now = new Date()) {
  if (!Array.isArray(months) || months.length === 0) return null;
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const cur = months.find((b) => {
    const d = bucketDate(b);
    return d.year === y && d.month === m;
  });
  return cur || months[months.length - 1];
}
