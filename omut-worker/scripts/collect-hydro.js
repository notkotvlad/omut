#!/usr/bin/env node
/**
 * collect-hydro.js — сборщик данных гидропостов Казгидромета
 *
 * Стратегия (в порядке приоритета):
 *   1. REST API  — если Казгидромет отдаёт JSON напрямую (проверяем известные эндпоинты)
 *   2. Puppeteer — рендерит интерактивную карту, перехватывает XHR, собирает данные
 *
 * После сбора: записывает snapshot + историю уровня воды в Cloudflare KV через REST API.
 *
 * Использование:
 *   node scripts/collect-hydro.js
 *
 * Переменные окружения (задать в .env или GitHub Secrets):
 *   CF_ACCOUNT_ID        — Cloudflare Account ID
 *   CF_KV_NAMESPACE_ID   — KV Namespace ID (OMUT_CACHE)
 *   CF_API_TOKEN         — Cloudflare API Token с правами KV:Edit
 *   HYDRO_MAP_URL        — (опц.) URL интерактивной карты, по умолчанию kazhydromet.kz
 *   PUPPETEER_EXECUTABLE — (опц.) путь к Chrome/Chromium, если не дефолтный
 *   DRY_RUN              — "1" чтобы напечатать данные без записи в KV
 */

import 'dotenv/config';
import puppeteer from 'puppeteer';

// ─── Конфиг ───────────────────────────────────────────────────────────────────

const CF_ACCOUNT_ID      = process.env.CF_ACCOUNT_ID;
const CF_KV_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
const CF_API_TOKEN       = process.env.CF_API_TOKEN;
const DRY_RUN            = process.env.DRY_RUN === '1';

// Известные URL для попытки REST-запросов (проверяем по очереди)
const KAZHYDROMET_HYDRO_CANDIDATES = [
  'https://www.kazhydromet.kz/ru/gidrologia',
  'https://www.kazhydromet.kz/api/hydro/stations',
  'https://www.kazhydromet.kz/api/hydro/current',
  'https://ecodata.kz/api/hydro',
];

const HYDRO_MAP_URL = process.env.HYDRO_MAP_URL
  || 'https://www.kazhydromet.kz/ru/gidrologia';

// 9 постов которые нас интересуют — имена точно как на карте Казгидромета
const TARGET_POSTS = [
  { post_id: 'kaskelyen-ustye',          kazhydromet_name: 'Р.Каскелен - устье' },
  { post_id: 'kapchagai-vdhr-kapshagai', kazhydromet_name: 'Вдхр. Капшагайское – г. Капшагай' },
  { post_id: 'kapchagai-vdhr-karashoki', kazhydromet_name: 'Вдхр. Капшагайское – МС Карашокы' },
  { post_id: 'kurti-leninski-most',      kazhydromet_name: 'Р. Курты – база клх. им. Ленина (Ленинский мост)' },
  { post_id: 'ili-kapchagai-uroch',      kazhydromet_name: 'Р. Иле - уроч. Капчагай' },
  { post_id: 'ili-ushzharma',            kazhydromet_name: 'Р. Иле- с. Ушжарма' },
  { post_id: 'ili-suminka-6km',          kazhydromet_name: 'Р. Иле, пр. Суминка - 6 км ниже истока' },
  { post_id: 'ili-nizhe-zhideli-1km',    kazhydromet_name: 'Р. Иле –1 км ниже ответвления рук. Жидели' },
  { post_id: 'ili-zhideli-16km',         kazhydromet_name: 'Р. Иле. рук. Жидели – 16 км ниже истока' },
];

// ─── Утилиты ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[hydro-collect] ${new Date().toISOString()}  ${msg}`); }
function warn(msg) { console.warn(`[hydro-collect] WARN  ${msg}`); }

/**
 * Попытка найти данные поста по имени в любом JSON-объекте (рекурсивно).
 * Возвращает { water_temp, water_level_cm } или null.
 */
function findPostDataInJson(json, targetName) {
  const str = JSON.stringify(json);
  // Ищем строку похожую на имя поста
  if (!str.includes('Каскелен') && !str.includes('Капшагай') && !str.includes('Курты') &&
      !str.includes('Иле') && !str.includes('Жидели') && !str.includes('Суминка')) {
    return null; // явно не наш JSON
  }

  const items = Array.isArray(json) ? json : (json.data || json.features || json.stations || json.posts || []);
  if (!Array.isArray(items)) return null;

  for (const item of items) {
    const name = item.name || item.station_name || item.post_name || item.title || item.label || '';
    if (!nameMatches(name, targetName)) continue;

    return {
      water_temp: nullable(item.water_temp ?? item.temp_water ?? item.temperature ?? item.t_water),
      water_level_cm: nullable(item.water_level ?? item.level ?? item.water_level_cm ?? item.h),
    };
  }
  return null;
}

function nameMatches(found, target) {
  const normalize = s => s.toLowerCase().replace(/[\s\-–—\.]/g, '');
  return normalize(found).includes(normalize(target).slice(0, 10)); // первые 10 символов достаточно
}

function nullable(v) {
  if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// ─── Стратегия 1: REST API ────────────────────────────────────────────────────

async function tryRestApi() {
  log('Стратегия 1: пробуем REST API эндпоинты...');

  for (const url of KAZHYDROMET_HYDRO_CANDIDATES) {
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json, text/javascript, */*',
          'User-Agent': 'OmutHydroCollect/1.0 (+https://github.com/your-repo; not.kot.vlad@gmail.com)',
          'Accept-Language': 'ru,en;q=0.8',
        },
        signal: AbortSignal.timeout(10_000),
      });

      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('json')) {
        log(`  ${url} → HTTP ${res.status} content-type:${ct} — пропускаем`);
        continue;
      }

      const json = await res.json();
      log(`  ${url} → JSON получен (${JSON.stringify(json).length} байт), ищем посты...`);

      const results = [];
      for (const post of TARGET_POSTS) {
        const data = findPostDataInJson(json, post.kazhydromet_name);
        if (data) {
          results.push({ ...post, ...data, source_url: url });
          log(`  ✓ Найден: ${post.post_id}  temp=${data.water_temp}  level=${data.water_level_cm}`);
        }
      }

      if (results.length >= TARGET_POSTS.length * 0.5) {
        log(`Стратегия 1 успешна: ${results.length}/${TARGET_POSTS.length} постов`);
        return results;
      }
    } catch (e) {
      log(`  ${url} → ошибка: ${e.message}`);
    }
  }

  log('Стратегия 1 не дала результата.');
  return null;
}

// ─── Стратегия 2: Puppeteer ───────────────────────────────────────────────────

async function tryPuppeteer() {
  log('Стратегия 2: Puppeteer...');

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE || undefined,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--lang=ru',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ru,en;q=0.8' });
    await page.setUserAgent('OmutHydroCollect/1.0 (+not.kot.vlad@gmail.com) Puppeteer');

    // Перехватываем все JSON ответы в поиске данных гидропостов
    const capturedJsonResponses = [];
    page.on('response', async (response) => {
      try {
        const ct = response.headers()['content-type'] || '';
        if (!ct.includes('json') && !ct.includes('javascript')) return;
        const url = response.url();
        if (url.includes('node_modules') || url.includes('.min.js')) return;

        const text = await response.text().catch(() => '');
        if (text.length < 50 || !text.includes('{')) return;

        // Ищем JSON содержащий ключевые слова гидрологии
        if (/(уровень|level|water|hydro|гидро|temp|temperature|Иле|Курты|Каскелен)/i.test(text)) {
          try {
            const json = JSON.parse(text);
            capturedJsonResponses.push({ url, json });
            log(`  [XHR] Интересный JSON: ${url.slice(0, 80)}`);
          } catch { /* не JSON */ }
        }
      } catch { /* ignore */ }
    });

    log(`  Открываем: ${HYDRO_MAP_URL}`);
    await page.goto(HYDRO_MAP_URL, { waitUntil: 'networkidle2', timeout: 45_000 });

    // Ждём появления карты или таблицы
    await page.waitForSelector(
      'canvas, .leaflet-container, table, .hydro-table, [class*="hydro"], [class*="map"]',
      { timeout: 15_000 }
    ).catch(() => log('  Нет ожидаемого DOM-элемента — продолжаем'));

    // Дополнительная задержка для Shiny / динамических фреймворков
    await new Promise(r => setTimeout(r, 5_000));

    // Извлекаем данные из перехваченных JSON
    const results = [];
    for (const post of TARGET_POSTS) {
      let found = false;
      for (const { url, json } of capturedJsonResponses) {
        const data = findPostDataInJson(json, post.kazhydromet_name);
        if (data && (data.water_temp !== null || data.water_level_cm !== null)) {
          results.push({ ...post, ...data, source_url: url });
          log(`  ✓ XHR: ${post.post_id}  temp=${data.water_temp}  level=${data.water_level_cm}`);
          found = true;
          break;
        }
      }
      if (!found) {
        // Попытка найти в DOM (таблицы, popup'ы)
        const domData = await extractFromDom(page, post.kazhydromet_name);
        if (domData) {
          results.push({ ...post, ...domData, source_url: HYDRO_MAP_URL });
          log(`  ✓ DOM: ${post.post_id}  temp=${domData.water_temp}  level=${domData.water_level_cm}`);
        } else {
          warn(`  ✗ Не найден: ${post.post_id} (${post.kazhydromet_name})`);
        }
      }
    }

    // Если нашли мало — сохраняем все перехваченные JSON для анализа
    if (results.length < TARGET_POSTS.length * 0.3) {
      const debugPath = new URL('../debug-captured-xhr.json', import.meta.url).pathname;
      const fs = await import('fs/promises');
      await fs.writeFile(
        debugPath,
        JSON.stringify(capturedJsonResponses.map(r => ({ url: r.url, sample: JSON.stringify(r.json).slice(0, 500) })), null, 2)
      );
      warn(`Мало данных (${results.length}/${TARGET_POSTS.length}). XHR-дамп сохранён: debug-captured-xhr.json`);
      warn('Проверьте дамп и скорректируйте парсер или добавьте URL в KAZHYDROMET_HYDRO_CANDIDATES.');
    }

    return results;
  } finally {
    await browser.close();
  }
}

/**
 * Ищет данные поста в DOM страницы: таблицы, popups, data-атрибуты.
 */
async function extractFromDom(page, targetName) {
  return page.evaluate((name) => {
    // Ищем ячейки таблицы рядом с именем поста
    const allText = document.querySelectorAll('td, th, .popup-content, [class*="station"], [class*="post"]');
    let targetRow = null;
    for (const el of allText) {
      if (el.textContent.includes(name.slice(0, 8))) {
        targetRow = el.closest('tr') || el.parentElement;
        break;
      }
    }
    if (!targetRow) return null;

    const cells = [...targetRow.querySelectorAll('td')].map(t => t.textContent.trim());
    let water_temp = null;
    let water_level_cm = null;

    for (const cell of cells) {
      // Температура — небольшое число с десятичной частью
      if (/^[\-+]?\d{1,2}(\.\d)?$/.test(cell)) {
        const n = parseFloat(cell);
        if (n >= -5 && n <= 35 && water_temp === null) water_temp = n;
      }
      // Уровень — обычно трёх/четырёхзначное число
      if (/^\d{3,5}$/.test(cell)) {
        water_level_cm = parseInt(cell, 10);
      }
    }

    return (water_temp !== null || water_level_cm !== null)
      ? { water_temp, water_level_cm }
      : null;
  }, targetName);
}

// ─── Cloudflare KV ────────────────────────────────────────────────────────────

async function writeToKV(postId, snapshot) {
  if (DRY_RUN) {
    log(`[DRY_RUN] KV write: hydro:snapshot:${postId} = ${JSON.stringify(snapshot)}`);
    return;
  }

  if (!CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID || !CF_API_TOKEN) {
    throw new Error('CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN не заданы');
  }

  const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/hydro:snapshot:${postId}`;

  const res = await fetch(kvUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    // TTL 48 часов — данные обновляются раз в сутки, держим с запасом
    body: JSON.stringify(snapshot),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KV PUT failed ${res.status}: ${text.slice(0, 200)}`);
  }
  log(`  → KV snapshot записан: hydro:snapshot:${postId}`);
}

/**
 * Дописывает запись в историю уровня воды.
 * KV хранит JSON-массив последних 90 точек (~ 3 месяца при ежедневном сборе).
 */
async function appendToLevelHistory(postId, levelCm, measuredAt) {
  if (levelCm === null) return;

  const histKey = `hydro:level-history:${postId}`;
  const kvBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}`;
  const headers = { 'Authorization': `Bearer ${CF_API_TOKEN}` };

  if (DRY_RUN) {
    log(`[DRY_RUN] KV append history: ${histKey}  ${measuredAt}=${levelCm}cm`);
    return;
  }

  // Читаем существующую историю
  let history = [];
  try {
    const getRes = await fetch(`${kvBase}/values/${histKey}`, { headers });
    if (getRes.ok) {
      history = await getRes.json();
    }
  } catch { /* нет истории — начинаем с нуля */ }

  // Добавляем новую точку
  history.push({ t: measuredAt, level_cm: levelCm });

  // Оставляем последние 90 точек
  if (history.length > 90) history = history.slice(-90);

  const putRes = await fetch(`${kvBase}/values/${histKey}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(history),
  });

  if (!putRes.ok) {
    warn(`  → KV history PUT failed ${putRes.status} для ${postId}`);
  } else {
    log(`  → KV история уровня обновлена: ${histKey} (${history.length} точек)`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('=== Запуск сборщика гидропостов ===');
  if (DRY_RUN) log('(DRY_RUN mode — в KV не пишем)');

  // Сначала пробуем REST, потом Puppeteer
  let results = await tryRestApi();
  if (!results || results.length === 0) {
    results = await tryPuppeteer();
  }

  if (!results || results.length === 0) {
    warn('Нет данных ни от REST, ни от Puppeteer. Завершаем без записи.');
    process.exit(1);
  }

  const measuredAt = new Date().toISOString();
  let written = 0;

  for (const r of results) {
    const snapshot = {
      post_id:         r.post_id,
      post_name:       r.kazhydromet_name,
      water_body:      r.water_body || null,
      water_temp:      r.water_temp   ?? null,
      water_level_cm:  r.water_level_cm ?? null,
      measured_at:     measuredAt,
      source:          'kazhydromet',
      source_url:      r.source_url || null,
    };

    try {
      await writeToKV(r.post_id, snapshot);
      await appendToLevelHistory(r.post_id, snapshot.water_level_cm, measuredAt);
      written++;
    } catch (e) {
      warn(`Ошибка записи KV для ${r.post_id}: ${e.message}`);
    }
  }

  log(`=== Готово: ${written}/${results.length} постов записано в KV ===`);
}

main().catch(e => {
  console.error('[hydro-collect] FATAL:', e);
  process.exit(1);
});
