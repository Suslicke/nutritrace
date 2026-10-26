<!-- Fork (Suslicke/nutritrace): the Foods screen's hint — what a food, a recipe and a meal ("набор")
     are for and how they connect. Open until the reader closes it once, then one tap reopens it. -->
<script>
  import { locale } from 'svelte-i18n';
  export let tab = 0;  // Foods.svelte activeTab: 0 foods, 1 meals, 2 recipes

  const KEY = 'fork:foodKindsHintSeen';
  let open = true;
  try { open = !localStorage.getItem(KEY); } catch { /* private mode: stays open */ }
  function toggle() {
    open = !open;
    try { localStorage.setItem(KEY, '1'); } catch { /* not kept */ }
  }

  const T = {
    ru: { title: 'Продукт, рецепт, набор — что для чего?', kinds: [
      { tab: 0, icon: 'restaurant', name: 'Продукт', text: 'Один продукт с КБЖУ: молоко, сахар, хлеб. Из продуктов собираются рецепты и наборы.', diary: 'В дневнике: одна строка, граммы или штуки.' },
      { tab: 2, icon: 'menu_book', name: 'Рецепт (блюдо)', text: 'То, что приготовлено из нескольких продуктов: суп, салат, «мой кофе». Записываете, сколько граммов съели — калории пересчитаются по составу.', diary: 'В дневнике: одна строка с названием. Нажмите на неё — увидите, из чего она состоит.' },
      { tab: 1, icon: 'dinner_dining', name: 'Набор', text: 'Несколько отдельных продуктов, которые вы обычно едите вместе: тост + кофе + яблоко.', diary: 'В дневнике: каждый продукт отдельной строкой, их можно менять по одному.' },
    ], flow: 'Продукты → рецепты и наборы → дневник. Если сомневаетесь — это рецепт.',
      trace: 'Проще всего написать Trace: «съел суп» — он найдёт рецепт или соберёт новый из продуктов.' },
    en: { title: 'Food, recipe, meal — what is what?', kinds: [
      { tab: 0, icon: 'restaurant', name: 'Food', text: 'One product with its nutrition: milk, sugar, bread. Recipes and meals are built from foods.', diary: 'In the diary: one row, in grams or pieces.' },
      { tab: 2, icon: 'menu_book', name: 'Recipe (dish)', text: 'Something cooked from several foods: soup, salad, "my coffee". Log how many grams you ate and the nutrition follows the recipe.', diary: 'In the diary: one row with its name. Tap it to see what it is made of.' },
      { tab: 1, icon: 'dinner_dining', name: 'Meal', text: 'Several separate foods you usually eat together: toast + coffee + an apple.', diary: 'In the diary: each food on its own row, editable one by one.' },
    ], flow: 'Foods → recipes and meals → diary. When unsure, make it a recipe.',
      trace: 'Easiest: tell Trace "had the soup" — it finds the recipe or builds a new one from foods.' },
  };
  $: t = String($locale || '').startsWith('ru') ? T.ru : T.en;
</script>

<div class="kinds" class:open>
  <button class="head" on:click={toggle} aria-expanded={open}>
    <span class="material-symbols-rounded">help</span>
    <span class="ttl">{t.title}</span>
    <span class="material-symbols-rounded chev">{open ? 'expand_less' : 'expand_more'}</span>
  </button>
  {#if open}
    {#each t.kinds as k}
      <div class="kind" class:here={k.tab === tab}>
        <span class="material-symbols-rounded ic">{k.icon}</span>
        <div>
          <b>{k.name}</b>
          <p>{k.text}</p>
          <p class="diary">{k.diary}</p>
        </div>
      </div>
    {/each}
    <p class="flow">{t.flow}</p>
    <p class="trace">{t.trace}</p>
  {/if}
</div>

<style>
  .kinds { margin: 8px var(--page-px, 16px) 4px; border-radius: 14px; background: var(--surface-2); color: var(--text-1); }
  .head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; background: none; border: 0;
    color: var(--text-2); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
  .head .ttl { flex: 1; }
  .open .head { color: var(--text-1); font-weight: 600; }
  .kind { display: flex; gap: 10px; padding: 8px 12px; border-left: 3px solid transparent; }
  .kind.here { border-left-color: var(--accent, #e57373); background: var(--surface-3, rgba(127,127,127,.08)); }
  .ic { color: var(--accent, #e57373); font-size: 20px; margin-top: 2px; }
  .kind b { font-size: 14px; }
  .kind p { margin: 2px 0 0; font-size: 13px; color: var(--text-2); line-height: 1.35; }
  .kind p.diary { color: var(--text-3, var(--text-2)); font-size: 12px; }
  .flow, .trace { margin: 0; padding: 6px 12px; font-size: 12px; color: var(--text-2); }
  .trace { padding-bottom: 12px; }
</style>
