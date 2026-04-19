// Лёгкие HTML-утилиты без подключения cheerio (cheerio компилируется в большой бандл и
// иногда отказывается работать в Workers-окружении из-за Node API). Для наших сценариев
// достаточно точечных RegExp-ов.

export function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/**
 * Найти все блоки, соответствующие тегу <div class="cls"> … </div>,
 * возвращая ВНУТРЕННИЙ HTML. Поддерживает вложенность через простой счётчик.
 */
export function findBlocks(html, className) {
  const results = [];
  const openRe = new RegExp(`<(\\w+)[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'gi');
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const start = m.index + m[0].length;
    // Ищем соответствующий закрывающий тег с учётом вложенности
    let depth = 1;
    const reTag = new RegExp(`</?${tag}\\b`, 'gi');
    reTag.lastIndex = start;
    let end = -1;
    let tm;
    while ((tm = reTag.exec(html)) !== null) {
      if (tm[0][1] === '/') {
        depth -= 1;
        if (depth === 0) { end = tm.index; break; }
      } else {
        depth += 1;
      }
    }
    if (end > 0) results.push(html.slice(start, end));
  }
  return results;
}

/** Извлечь содержимое первого тега с указанным классом. */
export function firstBlock(html, className) {
  const blocks = findBlocks(html, className);
  return blocks[0] || null;
}

/** Плоский текст с сохранением переводов строк между блоками. */
export function blockText(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|td|th)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
