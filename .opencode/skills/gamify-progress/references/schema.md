# Структура progress.json

`subjects/<slug>/progress.json` записывается только скриптом `scripts/progress.mjs`.

```json
{
  "subject": "Компьютерные сети",
  "slug": "computer-networks",
  "learner": "you",
  "level": 1,
  "level_title": "Newbie",
  "xp": 80,
  "total_xp": 80,
  "xp_to_next_level": 250,
  "current_lesson": 2,
  "total_lessons": 12,
  "diagnostic_completed": true,
  "streak": {
    "current": 2,
    "longest": 2,
    "last_study_date": "2026-11-07",
    "history": ["2026-11-06", "2026-11-07"]
  },
  "lessons": [
    {
      "id": 1,
      "title": "Модель OSI и TCP/IP",
      "score": 8,
      "xp": 80,
      "completed": "2026-11-07",
      "badges": ["first_packet"]
    }
  ],
  "attempts": [
    { "lesson": 2, "score": 4, "date": "2026-11-07" }
  ],
  "badges": ["first_packet", "signal_acquired", "streak_3"],
  "personal_best": { "score": 8, "xp_in_one_lesson": 80 }
}
```

Примечания:

- `xp` — прогресс внутри текущего уровня; `total_xp` — XP за всё время.
- Порог уровня фиксирован: 250 XP.
- `history` содержит уникальные учебные даты в хронологическом порядке.
- `current_lesson` растёт только после сданного урока (7+).
- `attempts` никогда не дают XP и нужны для `comeback_kid`.
