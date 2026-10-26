/** Fork (Suslicke/nutritrace): the evening summary push text. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayTotals, eveningText } from '../server/lib/fork-evening-text.js';

test('totals multiply nutrition by quantity', () => {
  assert.deepEqual(dayTotals([{ nutrition: { calories: 100, proteins: 5 }, quantity: 2 }, { nutrition: { calories: 50 } }]),
    { calories: 250, proteins: 10 });
});

test('left, over, protein lines; nothing without a goal or a log', () => {
  assert.equal(eveningText({ calories: 1450, proteins: 80 }, { calories: 2000, proteins: 120 }),
    'Съедено 1450 из 2000 ккал — осталось 550.\nБелка 80 из 120 г — не хватает 40 г.');
  assert.match(eveningText({ calories: 2300, proteins: 130 }, { calories: 2000, proteins: 120 }), /на 300 больше.*\n.*норма есть/s);
  assert.equal(eveningText({ calories: 500, proteins: 0 }, { calories: null }), null);
  assert.equal(eveningText({ calories: 0, proteins: 0 }, { calories: 2000 }), null);
});
