<!-- Fork (Suslicke/nutritrace): propose_dish review cards — one card per product, ✓ / grams / ✎,
     then one Save that builds the meal and logs it (src/lib/trace-extra.js saveDish). -->
<script>
  import { dishDraft, saveDish, itemKcal } from '../../lib/trace-extra.js';
  import { mealNames } from '../../stores/settings.js';
  import TraceFace from './TraceFace.svelte';

  export let ask;  // (text) => send a chat message to Trace

  let fixing = null, fixText = '', busy = false, error = '';
  const names = () => mealNames.get() || ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

  $: d = $dishDraft;
  $: total = d ? d.items.reduce((s, i) => s + itemKcal(i), 0) : 0;
  $: allOk = d && d.items.every(i => i.status === 'ok' && i.grams > 0);

  const touch = () => dishDraft.set(d);
  function accept(i) { d.items[i].status = 'ok'; touch(); }
  function acceptAll() { d.items.forEach(i => { if (i.grams > 0) i.status = 'ok'; }); touch(); }
  function sendFix(i) {
    const it = d.items[i];
    if (!fixText.trim()) return;
    ask(`Исправь в «${d.name}» продукт ${i + 1} «${it.name}» (${it.grams} г, ${it.kcal} ккал/100 г): ${fixText.trim()}`);
    fixing = null; fixText = '';
  }
  async function save() {
    busy = true; error = '';
    try {
      const r = await saveDish(d);
      d.saved = r; touch();
      ask(`Сохранил meal «${d.name}» (id ${r.meal_id}) и записал в ${names()[d.meal ?? 0]}: ${r.kcal} ккал. Состав: ${d.items.map(i => `${i.name} ${i.grams} г`).join(', ')}. Запомни, если это мой обычный рецепт.`);
    } catch (e) { error = e?.message || String(e); }
    busy = false;
  }
</script>

{#if d}
  {#each d.items as it, i}
    <div class="ai-msg">
      <div class="ai-msg-avatar"><TraceFace size={24} /></div>
      <div class="dish-item" class:ok={it.status === 'ok'}>
        <div class="row">
          <span class="nm">{i + 1}. {it.name}</span>
          <span class="src">{it.source}</span>
        </div>
        <div class="row sub">
          {#if d.saved}{it.grams} г{:else}
            <input type="number" min="0" inputmode="decimal" value={it.grams} on:input={e => { it.grams = Number(e.target.value) || 0; touch(); }}> г
          {/if}
          · {itemKcal(it)} ккал <span class="per">({it.kcal} / {it.protein} / {it.fat} / {it.carbs} на 100 г)</span>
        </div>
        {#if !d.saved}
          <div class="row btns">
            {#if it.status === 'ok'}<span class="done">✓ добавлено</span>
            {:else}<button class="btn btn-primary btn-sm" on:click={() => accept(i)}>✓ Добавить</button>{/if}
            <button class="btn btn-secondary btn-sm" on:click={() => { fixing = fixing === i ? null : i; fixText = ''; }}>✎ Исправить</button>
          </div>
          {#if fixing === i}
            <div class="row fix">
              <input placeholder="Что не так? Например: не тот сыр, плавленый" bind:value={fixText}
                on:keydown={e => e.key === 'Enter' && sendFix(i)}>
              <button class="btn btn-primary btn-sm" on:click={() => sendFix(i)}>Отправить</button>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/each}

  <div class="ai-msg">
    <div class="ai-msg-avatar"><TraceFace size={24} /></div>
    <div class="dish-item">
      {#if d.saved}
        <div class="nm">✓ «{d.name}» записан: {d.saved.kcal} ккал</div>
        <div class="row btns"><button class="btn btn-secondary btn-sm" on:click={() => dishDraft.set(null)}>Закрыть</button></div>
      {:else}
        <div class="row"><span class="nm">{d.name}</span><span class="nm">{total} ккал</span></div>
        <div class="row sub">
          <select on:change={e => { d.meal = Number(e.target.value); touch(); }}>
            {#if d.meal == null}<option value="" selected disabled>Приём пищи?</option>{/if}
            {#each names() as mn, mi}<option value={mi} selected={d.meal === mi}>{mn}</option>{/each}
          </select>
          {#if d.date}· {d.date}{/if}
        </div>
        {#if error}<div class="err">{error}</div>{/if}
        <div class="row btns">
          <button class="btn btn-secondary btn-sm" on:click={() => dishDraft.set(null)}>Отмена</button>
          {#if !allOk}<button class="btn btn-secondary btn-sm" on:click={acceptAll}>✓ Все</button>{/if}
          <button class="btn btn-primary btn-sm" disabled={!allOk || busy || d.meal == null} on:click={save}>
            {busy ? 'Сохраняю…' : 'Сохранить и записать'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .dish-item { background: var(--surface-2); color: var(--text-1); border-radius: 14px; padding: 10px 12px;
    width: 100%; font-size: 14px; border: 1px solid transparent; }
  .dish-item.ok { border-color: var(--primary, #4caf50); }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: space-between; }
  .sub { justify-content: flex-start; color: var(--text-2); font-size: 13px; margin-top: 4px; }
  .btns { justify-content: flex-end; margin-top: 8px; }
  .fix { margin-top: 6px; flex-wrap: nowrap; }
  .fix input { flex: 1; min-width: 0; }
  .nm { font-weight: 600; }
  .src, .per { color: var(--text-3, var(--text-2)); font-size: 12px; }
  .done { color: var(--primary, #4caf50); font-size: 13px; }
  .err { color: var(--danger, #e53935); font-size: 13px; margin-top: 6px; }
  input[type=number] { width: 64px; }
</style>
