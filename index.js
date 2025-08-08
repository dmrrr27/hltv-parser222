// index.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());

// ===== Настройки =====
const CFG = {
  // Вариант 1: фиксированный URL (как у вас)
  USE_FIXED_URL: true,
  FIXED_URL: 'https://www.hltv.org/stats/players?startDate=2025-05-08&endDate=2025-08-08&maps=de_ancient&rankingFilter=Top30&side=TERRORIST',

  // Вариант 2: скользящее окно последних N дней
  DAYS_BACK: 92,
  MAPS: 'de_ancient',
  RANKING_FILTER: 'Top30',
  SIDE: 'TERRORIST',

  TIMEOUT_MS: 45000,
  HEADLESS: 'new', // true | 'new' для современных версий Puppeteer
  TIMEZONE: 'Europe/Bucharest',
  OUT_FILE: path.join('data', 'hltv_players.csv')
};

function buildUrl() {
  if (CFG.USE_FIXED_URL) return CFG.FIXED_URL;
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - CFG.DAYS_BACK);
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const base = 'https://www.hltv.org/stats/players';
  const qs = new URLSearchParams({
    startDate: fmt(start),
    endDate: fmt(end),
    maps: CFG.MAPS,
    rankingFilter: CFG.RANKING_FILTER,
    side: CFG.SIDE
  }).toString();
  return `${base}?${qs}`;
}

async function scrapeToCSV() {
  const url = buildUrl();
  console.log('Fetching:', url);

  const browser = await puppeteer.launch({
    headless: CFG.HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--lang=en-US,en;q=0.9,ru;q=0.8'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.emulateTimezone(CFG.TIMEZONE);
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
      'Referer': 'https://www.hltv.org/stats'
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CFG.TIMEOUT_MS });

    // Небольшая задержка, чтобы пройти антибот/динамику
    await page.waitForTimeout(1500);

    // Ждём таблицу
    await page.waitForSelector('table', { timeout: 30000 });

    const payload = await page.evaluate(() => {
      function findPlayersTable() {
        const tables = Array.from(document.querySelectorAll('table'));
        return tables.find(tb => {
          const ths = Array.from(tb.querySelectorAll('thead th')).map(th => th.innerText.trim().toLowerCase());
          const header = ths.join(' ');
          return header.includes('player') && (header.includes('rating') || header.includes('k/d'));
        }) || tables[0];
      }

      const t = findPlayersTable();
      if (!t) return { headers: [], rows: [] };

      const headers = Array.from(t.querySelectorAll('thead th')).map(th => th.innerText.trim());
      // Вставим Player URL сразу после Player
      let playerIdx = headers.findIndex(h => /player/i.test(h));
      if (playerIdx === -1) playerIdx = 0;
      const finalHeaders = headers.slice();
      finalHeaders.splice(playerIdx + 1, 0, 'Player URL');

      const rows = Array.from(t.querySelectorAll('tbody tr')).map(tr => {
        const tds = Array.from(tr.querySelectorAll('td'));
        const texts = tds.map(td => td.innerText.trim());
        const linkA = tds.find(td => td.querySelector('a[href*="/player/"]'))?.querySelector('a[href*="/player/"]');
        const playerUrl = linkA ? linkA.href : '';
        const row = texts.slice();
        row.splice(playerIdx + 1, 0, playerUrl);
        return row;
      });

      return { headers: finalHeaders, rows };
    });

    if (!payload.headers.length || !payload.rows.length) {
      throw new Error('Не удалось извлечь таблицу: пустые заголовки/строки.');
    }

    // Генерируем CSV
    const csv = toCSV([payload.headers, ...payload.rows]);
    fs.mkdirSync(path.dirname(CFG.OUT_FILE), { recursive: true });
    fs.writeFileSync(CFG.OUT_FILE, csv, 'utf8');
    console.log('Saved:', CFG.OUT_FILE, 'rows:', payload.rows.length);
  } finally {
    await browser.close();
  }
}

function toCSV(matrix) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    const needQuotes = /[",\n\r]/.test(s);
    const out = s.replace(/"/g, '""');
    return needQuotes ? `"${out}"` : out;
  };
  return matrix.map(row => row.map(esc).join(',')).join('\n') + '\n';
}

if (require.main === module) {
  scrapeToCSV().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}
