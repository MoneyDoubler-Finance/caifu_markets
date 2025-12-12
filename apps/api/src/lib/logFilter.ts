type LogContext = Record<string, unknown>;

const cachedFilters: { raw: string; regex: RegExp }[] = [];

function getFilters(): RegExp[] {
  const raw = process.env.WS_LOG_FILTERS || process.env.WS_LOG_FILTER || '';
  if (!raw) {
    cachedFilters.length = 0;
    return [];
  }

  if (cachedFilters.length && cachedFilters[0].raw === raw) {
    return cachedFilters.map((entry) => entry.regex);
  }

  cachedFilters.length = 0;
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    try {
      const regex = new RegExp(part, 'i');
      cachedFilters.push({ raw, regex });
    } catch {
      // Ignore invalid regex entries
    }
  }

  return cachedFilters.map((entry) => entry.regex);
}

export function shouldLog(context: LogContext): boolean {
  const filters = getFilters();
  if (filters.length === 0) {
    return true;
  }

  const haystack = Object.values(context)
    .map((value) => String(value ?? ''))
    .join(' ')
    .toLowerCase();

  for (const regex of filters) {
    if (regex.test(haystack)) {
      return true;
    }
  }

  return false;
}
