// Разбор страниц hh.ru.
//
// hh отдаёт готовый HTML, а данные кладёт в
//   <template id="HH-Lux-InitialState">{...}</template>
// Значения внутри экранированы как HTML-entities (&#34; вместо "), поэтому
// сначала декодируем, потом JSON.parse. Никакого headless-браузера не нужно.

export class MarkupError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarkupError";
  }
}

const STATE_RE = /<template[^>]*\bid="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/;

const HTML_ENTITIES = {
  "&quot;": '"',
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&nbsp;": "\u00a0",
};

export function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(quot|apos|lt|gt|amp|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m);
}

// Достаёт объект состояния из HTML. Бросает MarkupError, если hh поменял
// разметку: это отдельный сигнал «чинить парсер», а не «вакансий нет».
export function extractState(html, { page = "page" } = {}) {
  if (typeof html !== "string" || html.length === 0) {
    throw new MarkupError(`${page}: пустой ответ`);
  }
  const match = html.match(STATE_RE);
  if (!match) throw new MarkupError(`${page}: не найден HH-Lux-InitialState`);
  const raw = decodeEntities(match[1].trim());
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new MarkupError(`${page}: HH-Lux-InitialState не разбирается как JSON (${error.message})`);
  }
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

// hh упаковывает часть полей в обёртки вида {"professionalRoleId": [156]}
// или {"workFormatsElement": ["REMOTE"]}. Достаём вложенные значения.
function unwrap(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(unwrap);
  if (typeof value === "object") {
    return Object.values(value).flatMap(unwrap);
  }
  return [value];
}

function parseSalary(compensation) {
  if (!compensation || typeof compensation !== "object") {
    return { from: null, to: null, currency: null, gross: null };
  }
  const noCompensation = "noCompensation" in compensation;
  const from = Number.isFinite(Number(compensation.from)) ? Number(compensation.from) : null;
  const to = Number.isFinite(Number(compensation.to)) ? Number(compensation.to) : null;
  return {
    from: noCompensation ? null : from,
    to: noCompensation ? null : to,
    currency: noCompensation ? null : (compensation.currencyCode ?? null),
    gross: noCompensation ? null : (compensation.gross ?? null),
  };
}

function parsePublicationTime(time) {
  if (!time) return null;
  if (typeof time === "string") return time;
  if (typeof time === "object") {
    if (time.$) return String(time.$);
    const ts = Number(time["@timestamp"]);
    if (Number.isFinite(ts)) return new Date(ts * 1000).toISOString();
  }
  return null;
}

const EXPERIENCE_VALUES = new Set(["noExperience", "between1And3", "between3And6", "moreThan6"]);

function normalizeArea(area) {
  if (!area) return { id: null, name: null };
  if (typeof area === "string") return { id: null, name: area };
  return { id: area["@id"] ?? area.id ?? null, name: area.name ?? null };
}

// Сниппет требований: hh обрезает текст «…», но этого хватает, чтобы вытащить
// упоминания технологий, когда карточку не тянем.
function parseSnippet(snippet) {
  if (!snippet || typeof snippet !== "object") return null;
  const req = snippet.req ?? null;
  const resp = snippet.resp ?? null;
  if (!req && !resp) return null;
  return { requirements: req, responsibilities: resp };
}

export function parseSearchItem(item) {
  const salary = parseSalary(item.compensation);
  const area = normalizeArea(item.area);
  return {
    id: String(item.vacancyId ?? item.id ?? ""),
    name: String(item.name ?? "").trim(),
    employer: String(item.company?.visibleName ?? item.company?.name ?? "").trim() || null,
    area: area.name,
    area_id: area.id,
    published_at: parsePublicationTime(item.publicationTime),
    experience: EXPERIENCE_VALUES.has(item.workExperience) ? item.workExperience : null,
    employment: item.employmentForm ?? null,
    work_formats: unwrap(item.workFormats).filter((v) => typeof v === "string"),
    roles: unwrap(item.professionalRoleIds).map(Number).filter(Number.isFinite),
    salary_from: salary.from,
    salary_to: salary.to,
    salary_currency: salary.currency,
    salary_gross: salary.gross,
    skills: [],
    snippet: parseSnippet(item.snippet),
    description: null,
  };
}

// Возвращает { total, perPage, page, hasNext, vacancies }.
export function parseSearchPage(html, { page = "search" } = {}) {
  const state = extractState(html, { page });
  const result = state.vacancySearchResult;
  if (!result || !Array.isArray(result.vacancies)) {
    throw new MarkupError(`${page}: нет vacancySearchResult.vacancies`);
  }
  const total = Number(result.totalResults);
  const items = result.vacancies.map(parseSearchItem).filter((v) => v.id);
  const paging = result.paging ?? {};
  const hasNext = Array.isArray(paging.pages)
    ? paging.pages.some((p) => Number(p.page) > Number(result.criteria?.page ?? 0))
    : items.length > 0;
  return {
    total: Number.isFinite(total) ? total : null,
    per_page: items.length,
    page: Number(result.criteria?.page ?? 0),
    has_next: hasNext,
    vacancies: items,
  };
}

export function parseVacancyPage(html, { page = "vacancy" } = {}) {
  const state = extractState(html, { page });
  const full = state.vacancyView?.vacancyFull?.vacancy;
  if (!full || !full.vacancyId) {
    throw new MarkupError(`${page}: нет vacancyView.vacancyFull.vacancy`);
  }
  const salary = parseSalary(full.compensation);
  const area = normalizeArea(full.area);
  const replay = {
    id: String(full.vacancyId),
    name: String(full.name ?? "").trim(),
    employer: String(full.company?.visibleName ?? full.company?.name ?? "").trim() || null,
    area: area.name,
    area_id: area.id,
    published_at: full.publicationTimeIso ?? full.publicationTime ?? null,
    experience: EXPERIENCE_VALUES.has(full.workExperience) ? full.workExperience : null,
    employment: full.employmentForm ?? null,
    work_formats: unwrap(full.workFormats).filter((v) => typeof v === "string"),
    roles: unwrap(full.professionalRoleIds).map(Number).filter(Number.isFinite),
    salary_from: salary.from,
    salary_to: salary.to,
    salary_currency: salary.currency,
    salary_gross: salary.gross,
    skills: asArray(full.keySkills).map((s) => String(s).trim()).filter(Boolean),
    snippet: null,
    description: typeof full.description === "string" ? full.description : null,
  };
  return replay;
}

// HTML описания → плоский текст. Нужен, чтобы искать упоминания технологий
// в теле вакансии, где keySkills не заполнены.
export function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, " • ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(quot|apos|lt|gt|amp|nbsp);/g, (m) => HTML_ENTITIES[m] ?? " ")
    .replace(/\r/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
