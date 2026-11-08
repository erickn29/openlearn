---
description: Показать прогресс и перегенерировать дашборд
agent: study-orchestrator
---

Покажи прогресс по предмету: $ARGUMENTS

1. Определи, что указано в `$ARGUMENTS`: трек (`tracks/<slug>/`) или предмет (`subjects/<slug>/`). Если пусто — возьми единственный или последний изменённый, а если есть и треки, и предметы — спроси.
2. Перегенерируй дашборд:

```sh
# Предмет
node .opencode/skills/gamify-progress/scripts/progress.mjs render \
  --progress subjects/<slug>/progress.json \
  --out subjects/<slug>/dashboard.html

# Трек
node .opencode/skills/gamify-progress/scripts/progress.mjs track render \
  --track tracks/<slug>
```

3. Для трека назови: уровень и XP по сумме секций, сколько секций закрыто, сколько уроков сделано, стрик, что дальше, сколько осталось в часах.
4. Для предмета: уровень, XP, стрик, пройденные уроки, следующую 1–2 темы, новые бейджи. Добавь остаток: «осталось N уроков ≈ X часов» — по колонке «мин» из `plan.md`.
5. Не придумывай XP и бейджи, если файла нет — предложи начать предмет.
