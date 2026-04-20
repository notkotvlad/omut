// Обёртки над Workers KV для кеширования ответов парсеров.

/** Префиксы для разных категорий, чтобы можно было легко инвалидировать одну группу. */
export const PREFIX = {
  nowcast: 'v1:nc:',
  facts: 'v1:ft:',
  hydro: 'v1:hy:',
  synop: 'v1:sy:',
};

/**
 * @template T
 * @param {KVNamespace} kv
 * @param {string} key
 * @param {number} ttlSec — сколько секунд жить записи
 * @param {() => Promise<T>} loader
 * @returns {Promise<{ value: T, cached: boolean, fetched_at: string }>}
 */
export async function cached(kv, key, ttlSec, loader) {
  if (!kv) {
    // если KV не привязан (локальный dev без биндинга) — работаем без кеша
    const value = await loader();
    return { value, cached: false, fetched_at: new Date().toISOString() };
  }
  const raw = await kv.get(key, 'json');
  if (raw && raw.fetched_at && (Date.now() - new Date(raw.fetched_at).getTime()) / 1000 < ttlSec) {
    return { value: raw.value, cached: true, fetched_at: raw.fetched_at };
  }
  const value = await loader();
  const fetched_at = new Date().toISOString();
  // expirationTtl — небольшой запас сверху, чтобы KV сам удалил запись при любой рассинхронизации
  try {
    await kv.put(key, JSON.stringify({ value, fetched_at }), { expirationTtl: Math.max(ttlSec * 2, 120) });
  } catch (_) { /* KV лимиты — не роняем запрос */ }
  return { value, cached: false, fetched_at };
}

/** При падении источника — попробовать отдать ЛЮБУЮ старую запись из KV (stale-while-error). */
export async function stale(kv, key) {
  if (!kv) return null;
  const raw = await kv.get(key, 'json');
  if (!raw || !raw.fetched_at) return null;
  return { value: raw.value, cached: true, fetched_at: raw.fetched_at, stale: true };
}
