import { round } from "./skills.mjs";

// Зарплата в вакансии — это либо «от», либо «до», либо диапазон. Чтобы
// считать медиану, сводим каждую вакансию к одной точке: середине диапазона,
// иначе вакансии с вилкой весят вдвое больше, чем с одной границей.
export function salaryPoint(vacancy) {
  const from = Number.isFinite(vacancy.salary_from) ? vacancy.salary_from : null;
  const to = Number.isFinite(vacancy.salary_to) ? vacancy.salary_to : null;
  if (from != null && to != null) return (from + to) / 2;
  if (from != null) return from;
  if (to != null) return to;
  return null;
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

// Считает p25/median/p75 по вакансиям одной валюты. Разные валюты мешать
// нельзя, поэтому по умолчанию берём только рубли.
export function salaryStats(vacancies, { currency = "RUR" } = {}) {
  const points = [];
  let currencies = new Set();
  for (const vacancy of vacancies) {
    if (vacancy.salary_currency && vacancy.salary_currency !== currency) continue;
    const point = salaryPoint(vacancy);
    if (point == null) continue;
    points.push(point);
    currencies.add(vacancy.salary_currency ?? currency);
  }
  points.sort((a, b) => a - b);
  if (points.length === 0) {
    return { n: 0, p25: null, median: null, p75: null, min: null, max: null, currency };
  }
  return {
    n: points.length,
    p25: Math.round(percentile(points, 0.25)),
    median: Math.round(percentile(points, 0.5)),
    p75: Math.round(percentile(points, 0.75)),
    min: points[0],
    max: points[points.length - 1],
    currency,
  };
}

const EXPERIENCE_LABELS = {
  noExperience: "без опыта",
  between1And3: "1–3 года",
  between3And6: "3–6 лет",
  moreThan6: "6+ лет",
};

export function experienceStats(vacancies) {
  const counts = { noExperience: 0, between1And3: 0, between3And6: 0, moreThan6: 0 };
  let unknown = 0;
  for (const vacancy of vacancies) {
    if (vacancy.experience && vacancy.experience in counts) counts[vacancy.experience] += 1;
    else unknown += 1;
  }
  const known = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    counts: Object.fromEntries(
      Object.entries(counts).map(([key, value]) => [
        key,
        { count: value, share: known > 0 ? round(value / known, 3) : 0, label: EXPERIENCE_LABELS[key] },
      ]),
    ),
    known,
    unknown,
    labels: EXPERIENCE_LABELS,
  };
}

export function formatStats(vacancies) {
  const counts = new Map();
  for (const vacancy of vacancies) {
    for (const format of new Set(vacancy.work_formats ?? [])) {
      counts.set(format, (counts.get(format) ?? 0) + 1);
    }
  }
  const base = vacancies.length;
  const labels = { REMOTE: "удалённо", HYBRID: "гибрид", ON_SITE: "офис", FIELD_WORK: "разъездная" };
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labels[key] ?? key, count, share: base > 0 ? round(count / base, 3) : 0 }))
    .sort((a, b) => b.count - a.count);
}

// Дедупликация между страницами поиска: за время сбора одни и те же
// вакансии могут попасть в выдачу дважды (например, при сдвиге выдачи).
export function dedupeById(vacancies) {
  const seen = new Map();
  for (const vacancy of vacancies) {
    if (!vacancy?.id) continue;
    const existing = seen.get(vacancy.id);
    if (!existing) {
      seen.set(vacancy.id, vacancy);
      continue;
    }
    // Дополняем: карточка могла не иметь навыков, а карточка с деталями — иметь.
    if ((vacancy.skills?.length ?? 0) > (existing.skills?.length ?? 0)) existing.skills = vacancy.skills;
    if (vacancy.description && !existing.description) existing.description = vacancy.description;
  }
  return [...seen.values()];
}
