// Гео-утилиты: расстояние по поверхности Земли + подбор ближайшей точки.

const R = 6371; // км

export function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Вернуть ближайший элемент массива с полями lat/lng.
 * @param {number} lat — широта точки
 * @param {number} lng — долгота точки
 * @param {Array<{lat:number,lng:number}>} list — кандидаты
 * @param {{maxKm?: number, filter?: (item:any)=>boolean}} opts
 * @returns {{ item: any, distanceKm: number } | null}
 */
export function nearest(lat, lng, list, opts = {}) {
  const { maxKm = Infinity, filter } = opts;
  let best = null;
  let bestDist = Infinity;
  for (const it of list) {
    if (typeof it.lat !== 'number' || typeof it.lng !== 'number') continue;
    if (filter && !filter(it)) continue;
    const d = haversine(lat, lng, it.lat, it.lng);
    if (d < bestDist && d <= maxKm) {
      bestDist = d;
      best = it;
    }
  }
  return best ? { item: best, distanceKm: bestDist } : null;
}
