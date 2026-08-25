const SITE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_KEYS = [
  "date",
  "dueCardsCompleted",
  "site",
];

function validDate(value) {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseCelebration(search) {
  const parameters = new URLSearchParams(search);
  const keys = Array.from(parameters.keys()).sort();
  if (
    keys.length !== REQUIRED_KEYS.length ||
    keys.some((key, index) => key !== REQUIRED_KEYS[index])
  ) {
    throw new TypeError("Celebration parameters are invalid.");
  }
  const site = parameters.get("site");
  const date = parameters.get("date");
  if (!SITE_PATTERN.test(site ?? "") || !validDate(date ?? "")) {
    throw new TypeError("Celebration identity is invalid.");
  }
  if (parameters.get("dueCardsCompleted") !== "true") {
    throw new TypeError("Celebration metrics are invalid.");
  }
  return {
    site,
    date,
    dueCardsCompleted: true,
  };
}

export function celebrationSearch(celebration) {
  const parameters = new URLSearchParams();
  for (const key of REQUIRED_KEYS) {
    parameters.set(key, String(celebration[key]));
  }
  return parameters.toString();
}
