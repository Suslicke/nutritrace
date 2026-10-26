/**
 * server/lib/fork-evening-text.js — fork (Suslicke/nutritrace): the evening summary's math and
 * text (fork-evening.js). Pure module (no db) so tests can load it.
 */

/** {calories, proteins} eaten: each item's nutrition is for one portion, times quantity. */
export function dayTotals(items) {
  const t = { calories: 0, proteins: 0 };
  for (const i of items || []) for (const k of Object.keys(t)) t[k] += (Number(i.nutrition?.[k]) || 0) * (Number(i.quantity) || 1);
  return t;
}

/** The push text, or null when there is no calorie goal or nothing was logged. */
export function eveningText(eaten, goal) {
  if (!goal.calories || !eaten.calories) return null;
  const left = Math.round(goal.calories - eaten.calories);
  const lines = [left >= 0
    ? `Съедено ${Math.round(eaten.calories)} из ${Math.round(goal.calories)} ккал — осталось ${left}.`
    : `Съедено ${Math.round(eaten.calories)} ккал — на ${-left} больше цели ${Math.round(goal.calories)}.`];
  if (goal.proteins) {
    const miss = Math.round(goal.proteins - eaten.proteins);
    lines.push(miss > 0 ? `Белка ${Math.round(eaten.proteins)} из ${Math.round(goal.proteins)} г — не хватает ${miss} г.`
      : `Белок ${Math.round(eaten.proteins)} г — норма есть 💪`);
  }
  return lines.join('\n');
}
