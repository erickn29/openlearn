---
name: subject-setup
description: Создаёт структуру нового предмета: план, диагностику, прогресс и дашборд. Используй при запуске новой темы обучения.
---

# Настройка предмета

Один предмет живёт в `subjects/<slug>/`. Правила slug: строчная латиница, цифры, дефисы (`computer-networks`).

## Структура

```text
subjects/<slug>/
├── plan.md
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

## Шаги

1. Выбери slug из темы пользователя и переиспользуй его во всех следующих сессиях.
2. Изучи 2–3 актуальных источника (RFC, официальная документация, университетский курс).
3. Напиши `plan.md`: 10–15 уроков с темой, ключевыми понятиями и практическим результатом.
4. Напиши `diagnostic.md`: 5–7 вопросов от базовых к прикладным.
5. Инициализируй прогресс:

```sh
node .opencode/skills/gamify-progress/scripts/progress.mjs init \
  --progress subjects/<slug>/progress.json \
  --subject "<отображаемое имя>" --slug <slug> --total <число уроков>
```

6. Отрисуй пустой дашборд:

```sh
node .opencode/skills/gamify-progress/scripts/progress.mjs render \
  --progress subjects/<slug>/progress.json \
  --out subjects/<slug>/dashboard.html
```

## Правила

- Не создавай уроки до того, как получены ответы на диагностику.
- `plan.md` — договор об учебной программе; меняй его только по согласию ученика.
- В `diagnostic.md` не должно быть ответов; ответы — в отдельном файле.
- Ссылки на источники указывай в `plan.md`, а не только в файлах уроков.
