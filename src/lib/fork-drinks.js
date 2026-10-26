/**
 * src/lib/fork-drinks.js — fork (Suslicke/nutritrace): a drink logged as food also counts toward the
 * water goal. stores/diary.js adds a water log tagged `from: <item uuid>` next to the item and
 * drops it with the item. Pure module so tests can load it.
 */
const WORDS = 'вода|воды|воду|кофе|чай|чая|сок|сока|морс|компот|кефир|молоко|ряженка|айран|лимонад|кола|напиток|смузи|какао|' +
  'американо|латте|капучино|эспрессо|раф|water|coffee|latte|tea|juice|milk|soda|drink|smoothie';
// whole words only: «Кофейный торт» is not a drink
const DRINK = new RegExp(`(^|[^\\p{L}])(${WORDS})([^\\p{L}]|$)`, 'iu');
const MIN_ML = 50;  // ponytail: a splash of milk or a spoon of oil/sauce doesn't count

/** Millilitres of water this diary item adds: anything in ml / l, or a drink by name in grams. */
export function drinkMl(item) {
  if (!item || item.type === 'quick_calories') return 0;
  const unit = String(item.unit || '').toLowerCase();
  const amount = (Number(item.portion) || 0) * (Number(item.quantity) || 1);
  const ml = unit === 'ml' ? amount : unit === 'l' ? amount * 1000 : unit === 'g' && DRINK.test(String(item.name || '')) ? amount : 0;
  return ml >= MIN_ML ? Math.round(ml) : 0;
}
