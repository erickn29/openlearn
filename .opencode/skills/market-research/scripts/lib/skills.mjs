// Нормализация названий навыков.
//
// hh.ru пишет навыки как придётся: «MS SQL», «MSSQL», «Postgres», «k8s».
// Без канонизации частоты расползаются на десятки почти одинаковых строк,
// а отчёт начинает врать. Канон берём из справочника hh (`/suggests/skill_set`),
// где это возможно, остальное — из списка алиасов ниже.

const SKILL_ALIASES = [
  ["SQL", ["sql"]],
  ["MS SQL", ["mssql", "ms sql", "ms sql server", "microsoft sql server", "sql server", "sqlserver"]],
  ["PostgreSQL", ["postgresql", "postgres", "psql", "postgre"]],
  ["MySQL", ["mysql"]],
  ["Oracle", ["oracle", "oracle db", "pl/sql", "plsql"]],
  ["ClickHouse", ["clickhouse"]],
  ["Python", ["python", "питон"]],
  ["pandas", ["pandas"]],
  ["NumPy", ["numpy"]],
  ["Spark", ["spark", "apache spark", "pyspark"]],
  ["Hadoop", ["hadoop", "hive", "cloudera"]],
  ["Kafka", ["kafka", "apache kafka"]],
  ["Airflow", ["airflow", "apache airflow"]],
  ["Docker", ["docker", "docker-compose", "docker compose", "докер"]],
  ["Kubernetes", ["kubernetes", "k8s", "кубернетес"]],
  ["Git", ["git", "гит"]],
  ["GitLab CI", ["gitlab ci", "gitlab", "gitlab-ci"]],
  ["CI/CD", ["ci/cd", "cicd", "ci cd"]],
  ["Linux", ["linux", "bash", "unix", "shell"]],
  ["Java", ["java"]],
  ["JavaScript", ["javascript", "js", "node.js", "nodejs", "node js"]],
  ["TypeScript", ["typescript", "ts"]],
  ["Go", ["go", "golang"]],
  ["C#", ["c#", "csharp", "c sharp", ".net", "dotnet"]],
  ["C++", ["c++", "cpp"]],
  ["Excel", ["excel", "ms excel", "microsoft excel"]],
  ["Power BI", ["power bi", "powerbi", "microsoft power bi"]],
  ["Tableau", ["tableau"]],
  ["Superset", ["superset", "apache superset"]],
  ["DAX", ["dax"]],
  ["Power Query", ["power query"]],
  ["R", ["r", "r language", "язык r"]],
  ["Machine Learning", ["machine learning", "ml", "машинное обучение"]],
  ["Deep Learning", ["deep learning", "нейронные сети"]],
  ["NLP", ["nlp", "natural language processing"]],
  ["TensorFlow", ["tensorflow", "tf"]],
  ["PyTorch", ["pytorch", "torch"]],
  ["scikit-learn", ["scikit-learn", "sklearn"]],
  ["REST API", ["rest api", "rest", "restapi"]],
  ["gRPC", ["grpc"]],
  ["Redis", ["redis"]],
  ["RabbitMQ", ["rabbitmq"]],
  ["Nginx", ["nginx"]],
  ["Terraform", ["terraform"]],
  ["Ansible", ["ansible"]],
  ["Prometheus", ["prometheus"]],
  ["Grafana", ["grafana"]],
  ["Jira", ["jira"]],
  ["Confluence", ["confluence"]],
  ["1С", ["1с", "1c", "1c:предприятие"]],
  ["A/B тестирование", ["a/b", "a/b testing", "a/b тестирование", "ab тестирование"]],
];

const CANON = new Map();
for (const [name, aliases] of SKILL_ALIASES) {
  for (const alias of aliases) CANON.set(normalizeKey(alias), name);
}

// Ключ для сравнения: нижний регистр, ё → е, схлопнутые пробелы и дефисы.
// Пунктуация сохраняется там, где она часть названия (C++, C#, .NET).
export function normalizeKey(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"']/g, "")
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/\s*[-–—/]\s*/g, (m) => (m.includes("/") ? "/" : "-"))
    .replace(/^[-/]+|[-/]+$/g, "")
    .trim();
}

// Приводит навык вакансии к канону. Неизвестное оставляем как есть, но с
// выправленным регистром и пробелами: лучше показать «Grafana Cloud»,
// чем потерять его из отчёта.
export function canonicalSkill(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const key = normalizeKey(text);
  if (!key) return null;
  return CANON.get(key) ?? tidy(text);
}

function tidy(text) {
  const collapsed = text.replace(/[\s\u00a0]+/g, " ").trim();
  if (collapsed.length <= 4) return collapsed;
  // Аббревиатуры и брендовые написания не трогаем: их регистр значим.
  if (/^[A-Z0-9+#./-]+$/.test(collapsed)) return collapsed;
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
}

// Считает частоты навыков. База доли — вакансии, у которых навыки вообще
// заполнены, а не все собранные: иначе «SQL встречается в 40%» вместо 89%.
export function aggregateSkills(vacancies, { top = 25 } = {}) {
  const counts = new Map();
  let base = 0;
  for (const vacancy of vacancies) {
    const skills = (vacancy.skills ?? []).map(canonicalSkill).filter(Boolean);
    if (skills.length === 0) continue;
    base += 1;
    for (const skill of new Set(skills)) {
      counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
  }
  const items = [...counts.entries()]
    .map(([name, count]) => ({ name, count, share: base > 0 ? round(count / base, 3) : 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"));
  const total = items.length;
  const ranked = items.slice(0, top);
  // share_zero: навык есть в справочнике, но не встретился. Полезно знать,
  // какие «обязательные» умения рынок на самом деле не упоминает.
  return { skills: ranked, base, total, share_base_key: "vacancies_with_skills" };
}

export function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// Алиасы, которые слишком коротки и совпадут со случайным словом в тексте
// («go», «r», «js», «ml»). Для сканирования свободного текста их не берём:
// в keySkills они приходят как есть и там контекст уже задан.
const SCAN_UNSAFE = new Set(["go", "r", "js", "ts", "ml", "tf", "ab", "ci cd", "rest"]);

const SCAN_PATTERNS = (() => {
  const patterns = [];
  for (const [name, aliases] of SKILL_ALIASES) {
    for (const alias of aliases) {
      const key = normalizeKey(alias);
      if (!key || SCAN_UNSAFE.has(key) || key.length < 3) continue;
      // Экранируем всё, кроме пробелов: пробелы внутри названия допускают
      // дефис или перенос, hh пишет «MS SQL», «MS-SQL» и «MS  SQL».
      const body = key
        .split(" ")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[\\s-]+");
      patterns.push({ name, re: new RegExp(`(?<![\\p{L}\\d])${body}(?![\\p{L}\\d])`, "giu") });
    }
  }
  return patterns;
})();

// Ищет известные технологии в свободном тексте требований. Только канонические
// названия из словаря: произвольные слова не выдумываем, иначе отчёт поплывёт.
// Возвращает канонические названия в порядке первого упоминания.
export function scanText(text) {
  const source = String(text ?? "");
  if (!source) return [];
  const hits = [];
  for (const { name, re } of SCAN_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(source)) hits.push(name);
  }
  return [...new Set(hits)];
}
