<!-- Fork (Suslicke/nutritrace): above Trace's input — the day's ring (calories, P/F/C) and the most
     used dishes as one-tap chips that open a dish card straight away (no AI call). -->
<script>
  import { onMount } from 'svelte';
  import { diaryTotals, currentDate } from '../../stores/diary.js';
  import { goals } from '../../stores/settings.js';
  import { dayTargets } from '../../lib/goal-resolver.js';
  import { dishDraft, quickDishes, recipeDraft, mealSlot } from '../../lib/trace-extra.js';

  export let hideChips = false;

  let dishes = [];
  const load = () => quickDishes().then(d => (dishes = d)).catch(() => {});
  onMount(load);
  $: if ($dishDraft?.saved) load();  // the order follows what was just eaten

  // ponytail: the stored goal; Dynamic/Adaptive calorie goals show their base value here
  $: t = $diaryTotals || {};
  $: g = dayTargets($goals, $currentDate);
  $: kcal = Math.round(t.calories || 0);
  $: left = g.calories ? Math.round(g.calories - kcal) : null;
  $: pct = g.calories ? Math.min(kcal / g.calories, 1) : 0;
  $: today = new Date().toLocaleDateString('sv');
  const R = 15, C = 2 * Math.PI * R;
  const m = (v, goal) => `${Math.round(v || 0)}${goal ? '/' + Math.round(goal) : ''}`;
  const short = (s) => (s.length > 28 ? s.slice(0, 26) + '…' : s);
</script>

<div class="dock">
  <div class="ring-row">
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r={R} class="bg" />
      <circle cx="18" cy="18" r={R} class="fg" class:over={left < 0} stroke-dasharray={C}
        stroke-dashoffset={C * (1 - pct)} transform="rotate(-90 18 18)" />
    </svg>
    <div class="txt">
      <div>
        <b>{kcal}{#if g.calories} / {Math.round(g.calories)}{/if} ккал</b>
        {#if left != null}<span class="left" class:over={left < 0}>{left >= 0 ? `· осталось ${left}` : `· +${-left} сверх`}</span>{/if}
        {#if $currentDate !== today}<span class="day">· {$currentDate}</span>{/if}
      </div>
      <div class="mac">Б {m(t.proteins, g.proteins)} · Ж {m(t.fat, g.fat)} · У {m(t.carbohydrates, g.carbohydrates)} г</div>
    </div>
  </div>
  {#if !hideChips && dishes.length}
    <div class="chips">
      {#each dishes as d (d.id)}
        <button class="chip" title={d.name} on:click={() => dishDraft.set(recipeDraft(d, mealSlot()))}>{short(d.name)}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dock { padding: 6px 12px 0; border-top: 1px solid var(--border, rgba(127,127,127,.2)); }
  .ring-row { display: flex; align-items: center; gap: 10px; }
  .bg { fill: none; stroke: var(--surface-3, rgba(127,127,127,.2)); stroke-width: 4; }
  .fg { fill: none; stroke: var(--primary, #4caf50); stroke-width: 4; stroke-linecap: round; transition: stroke-dashoffset .4s ease; }
  .fg.over { stroke: var(--danger, #e53935); }
  .txt { font-size: 13px; color: var(--text-1); line-height: 1.3; min-width: 0; }
  .left, .day, .mac { color: var(--text-2); }
  .left.over { color: var(--danger, #e53935); }
  .mac { font-size: 12px; }
  .chips { display: flex; gap: 6px; overflow-x: auto; padding: 6px 0 2px; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .chip { flex: none; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border-strong, rgba(127,127,127,.35));
    background: var(--surface-2); color: var(--text-2); font: inherit; font-size: 12px; cursor: pointer; }
  .chip:active { transform: scale(.97); }
  @media (prefers-reduced-motion: reduce) { .fg { transition: none; } }
</style>
