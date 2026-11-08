---
name: subject-setup
description: Создаёт структуру нового предмета или трека профессии: план, диагностику, прогресс и дашборд. Используй при запуске новой темы обучения.
---

# Настройка предмета

Предмет живёт в `subjects/<slug>/`. Правила slug: строчная латиница, цифры, дефисы (`computer-networks`).

Сначала реши, что нужно ученику:

| Запрос ученика | Что создаём |
| --- | --- |
| «Хочу разобраться в сетях» | один предмет: `subjects/computer-networks/` |
| «Хочу стать python backend» | трек: `tracks/python-backend/` + несколько `subjects/<секция>/` |

Признак трека: ученик называет профессию, а требования вакансий содержат 4+
независимых навыка. Если сомневаешься — спроси прямо.

## Структура предмета

```text
subjects/<slug>/
├── plan.md
├── market.json          # пишет только market.mjs (у секции трека его нет)
├── market.md            # пишет только market.mjs (у секции трека его нет)
├── diagnostic.md
├── diagnostic-answers.md
├── diagnostic-evaluation.json
├── progress.json
├── dashboard.html
└── lessons/
    └── lesson_1/
        ├── theory.md
        ├── tasks.md
        ├── answer-key.md
        ├── answers.md
        └── evaluation.json
```

## Структура трека

```text
tracks/<slug>/
├── track.json           # секции и порядок; пишет progress.mjs
├── track.md             # зачем эти секции; пишет teacher
├── diagnostic.md        # одна на весь трек
├── diagnostic-answers.md
├── diagnostic-evaluation.json
├── market.json          # снапшот на профессию целиком
├── market.md
└── dashboard.html       # агрегат по секциям; пишет progress.mjs
```

## Ветка «один предмет»

1. Выбери slug из темы и переиспользуй его во всех сессиях.
2. Спроси, на какую роль целится ученик, где ищет работу и в каком формате. Это нужно для рынка.
3. Подбери id роли: `market.mjs roles --text "<роль>"`.
4. Собери снапшот и отрисуй отчёт:

```sh
node .opencode/skills/market-research/scripts/market.mjs collect \
  --subject subjects/<slug> --role <id> --area <id> --format <any|remote|hybrid|onsite>
node .opencode/skills/market-research/scripts/market.mjs render --subject subjects/<slug>
```

5. Передай учителю `market.md` и задачу на план: **20–30 атомарных уроков** по 15–25 минут, плюс разделы «Требования рынка → уроки» и «Сознательно вне программы». В таблице плана обязательна колонка «мин».
6. `diagnostic.md`: 5–7 вопросов от базовых к прикладным.
7. Инициализируй прогресс и отрисуй пустой дашборд:

```sh
node .opencode/skills/gamify-progress/scripts/progress.mjs init \
  --progress subjects/<slug>/progress.json \
  --subject "<имя>" --slug <slug> --total <число уроков>
node .opencode/skills/gamify-progress/scripts/progress.mjs render \
  --progress subjects/<slug>/progress.json --out subjects/<slug>/dashboard.html
```

## Ветка «профессия» (трек)

1. Спроси профессию, регион поиска и формат работы.
2. Собери рынок на профессию целиком — снапшот один на трек:

```sh
node .opencode/skills/market-research/scripts/market.mjs collect \
  --subject tracks/<track> --role <id> --area <id> --format <any|remote|hybrid|onsite>
node .opencode/skills/market-research/scripts/market.mjs render --subject tracks/<track>
```

3. Разбей профессию на **4–6 секций** по навыкам из `market.md`. Каждый навык с долей 30% и выше — либо секция, либо «Сознательно вне программы» с причиной.
4. Для каждой секции создай обычный предмет: `plan.md` (**15–25 атомарных уроков**), `progress.json`, `dashboard.html`, `lessons/`. Диагностику не создавай — она общая.
5. `teacher` пишет `tracks/<track>/track.md`: цель, порядок, таблица «навык → секция», что вне программы.
6. `tracks/<track>/diagnostic.md`: 5–7 вопросов по всем секциям сразу.
7. Зарегистрируй секции:

```sh
node .opencode/skills/gamify-progress/scripts/progress.mjs track init \
  --track tracks/<track> --title "<профессия>" --role <hh_id> \
  --section python-core:1 --section git-basics:2 --section fastapi:3:optional
```

8. Отрисуй агрегат:

```sh
node .opencode/skills/gamify-progress/scripts/progress.mjs track render --track tracks/<track>
```

9. Покажи картину целиком: секции, уроки, часы. Не начинай уроки, пока нет `tracks/<track>/diagnostic-answers.md`.
10. После оценки диагностики отметь её в каждой секции:

```sh
node .opencode/skills/gamify-progress/scripts/progress.mjs diagnostic \
  --progress subjects/<slug>/progress.json
```

## Правила

- Не создавай уроки до того, как получены ответы на диагностику. В треке гейт один на все секции.
- `plan.md` — договор об учебной программе; меняй только по согласию ученика.
- В `diagnostic.md` не должно быть ответов; ответы — в отдельном файле.
- Ссылки на источники указывай в `plan.md`, а не только в файлах уроков.
- `market.json`, `market.md`, `track.json` и `dashboard.html` не редактируй руками: их пишут скрипты.
- Навык с долей 30% и выше в `market.md` либо закрыт уроком, либо явно отнесён к «сознательно вне программы» с причиной.
- Один урок — одна тема. Если урок не помещается в 25 минут — делить урок, а не растягивать.
- Если для темы не хватает 25 уроков в секции — делить секцию, а не раздувать уроки.
