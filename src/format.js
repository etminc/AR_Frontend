const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDate(value, locale = "en-US") {
  if (!value) return "—";

  const text = String(value);
  const match = dateOnlyPattern.exec(text);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date(text);

  if (Number.isNaN(date.getTime())) return text;

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: match ? "UTC" : undefined,
  }).format(date);
}

export function nextOptionIndex(currentIndex, direction, optionCount) {
  if (!Number.isInteger(optionCount) || optionCount <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= optionCount) {
    return direction < 0 ? optionCount - 1 : 0;
  }
  return (currentIndex + (direction < 0 ? -1 : 1) + optionCount) % optionCount;
}
