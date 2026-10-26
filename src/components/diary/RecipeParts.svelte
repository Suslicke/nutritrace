<!-- Fork (Suslicke/nutritrace): what a recipe row in the diary is made of, scaled to the amount
     eaten. Opens on a tap on the row (routes/Diary.svelte); read only, "Изменить" opens the editor. -->
<script>
  import { recipeParts } from '../../lib/trace-extra.js';
  import { NtApi } from '../../lib/api.js';
  export let item;
  export let onEdit = () => {};

  // The diary keeps only a reference to the recipe (stores/diary.js drops items[] on write), so the
  // products come from the saved recipe. ponytail: a recipe edited later shows its current products.
  let parts = null, failed = false;
  $: load(item);
  async function load(it) {
    parts = null; failed = false;
    try {
      const items = it.items?.length ? it.items : (await NtApi.getMeal(it.food_server_id ?? it.id))?.items;
      parts = recipeParts({ ...it, items: items || [] });
      failed = !parts.length;
    } catch { failed = true; }
  }
  $: max = Math.max(1, ...(parts || []).map(p => p.kcal));
</script>

<div class="parts">
  {#if failed}<div class="mac">Состав недоступен: рецепт удалён или скрыт.</div>
  {:else if !parts}<div class="mac">Загружаю состав…</div>{/if}
  {#each parts || [] as p}
    <div class="part">
      <div class="row">
        <span class="nm truncate">{p.name}</span>
        <span class="amt">{p.amount} {p.unit}</span>
        <b class="kc">{p.kcal} ккал</b>
      </div>
      <div class="bar"><span style="width:{(p.kcal / max) * 100}%"></span></div>
      <div class="mac">Б {p.protein} · Ж {p.fat} · У {p.carbs} г</div>
    </div>
  {/each}
  <div class="foot">
    <span>{(parts || []).length} {parts?.length === 1 ? 'продукт' : parts?.length < 5 ? 'продукта' : 'продуктов'} · ваша порция</span>
    <button class="btn btn-secondary btn-sm" on:click={onEdit}>Изменить порцию</button>
  </div>
</div>

<style>
  .parts { margin: 0 12px 8px 56px; padding: 8px 10px; border-radius: 12px; background: var(--surface-2); }
  .part + .part { margin-top: 8px; }
  .row { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
  .nm { flex: 1; min-width: 0; color: var(--text-1); }
  .amt { color: var(--text-3, var(--text-2)); font-size: 12px; }
  .kc { font-size: 12px; color: var(--text-1); }
  .bar { height: 3px; border-radius: 2px; background: var(--surface-3, rgba(127,127,127,.15)); margin-top: 3px; }
  .bar span { display: block; height: 100%; border-radius: 2px; background: var(--accent, #e57373); }
  .mac { font-size: 11px; color: var(--text-3, var(--text-2)); margin-top: 2px; }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px;
    font-size: 12px; color: var(--text-2); }
</style>
