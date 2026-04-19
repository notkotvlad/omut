import { haversine, nearest } from './src/lib/haversine.js';
import { parseKazhydrometFacts } from './src/lib/kazhydromet-facts.js';
import { parseSynopCsv } from './src/lib/ogimet.js';
import stationsData from './src/data/stations.js';

// 1. haversine
const d = haversine(43.9114, 77.1203, 43.232, 76.937); // Капчагай ↔ Алматы АМЦ
console.log('Капчагай→Алматы АМЦ:', d.toFixed(1), 'км (ожидаем ~80)');

// 2. nearest
const hit = nearest(43.9114, 77.1203, stationsData.stations.filter(s => s.verified));
console.log('Ближайшая станция к Капчагаю:', hit.item.name, '—', hit.distanceKm.toFixed(1), 'км');

// 3. Kazhydromet facts parser — синтетический HTML
const html = `
<html><body><div class="forecastPage-days">
  <div class="forecastPage-day">
    <div class="forecastPage-day__date">17.04.2026</div>
    <div class="forecastPage-day__info">
      <div class="forecastPage-day__column">Ночью:<br>+5+10, на севере +2 °C<br>юго-восточный<br>Скорость ветра:<br>3-8 м/с</div>
      <div class="forecastPage-day__column">День:<br>+18+23<br>западный<br>Скорость ветра:<br>9-14 м/с</div>
    </div>
  </div>
</div></body></html>`;
const p = parseKazhydrometFacts(html, { station_name: 'Тест' });
console.log('Парсер Казгидромета:', JSON.stringify(p.current, null, 2));
console.log('  forecast_daily.length =', p.forecast_daily.length);
console.log('  день:', p.forecast_daily[0]?.day);

// 4. OGIMET synop parser — синтетическая CSV
const csv = `36870,202604171200,,AAXX 17124 36870 32970 62808 10105 20098 30221 40011 60001 83070`;
const s = parseSynopCsv(csv, 36870);
console.log('OGIMET SYNOP decoded:', JSON.stringify(s.latest, null, 2));
