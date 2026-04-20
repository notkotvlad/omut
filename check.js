const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const scripts = html.match(/<script>[\s\S]*?<\/script>/g) || [];
const inlineScripts = scripts.filter(s => \!s.includes('src='));
const code = inlineScripts.map(s => s.replace(/<\/?script[^>]*>/g, '')).join('\n');
try {
  new Function(code);
  console.log('✓ JS-синтаксис корректен');
} catch (e) {
  console.log('✗ Синтаксическая ошибка:', e.message);
  process.exit(1);
}
