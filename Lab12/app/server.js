const http = require('http');
const { createClient } = require('redis');

const PORT = 8080;
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const STARTUP_DELAY_MS = parseInt(process.env.STARTUP_DELAY_MS || '0', 10);

const client = createClient({ url: REDIS_URL });
client.on('error', (err) => console.error('[app] Redis error:', err.message));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`[app] Підключення до Redis: ${REDIS_URL}`);
  await client.connect();
  console.log('[app] Підключення до Redis встановлено');

  // Імітація повільного старту (завантаження конфігурації, міграції тощо).
  // Поки триває затримка, порт 8080 не слухається, тому healthcheck
  // має статус "starting" / невдалі спроби.
  if (STARTUP_DELAY_MS > 0) {
    console.log(`[app] Ініціалізація... очікування ${STARTUP_DELAY_MS} мс`);
    await sleep(STARTUP_DELAY_MS);
    console.log('[app] Ініціалізацію завершено');
  }

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      try {
        await client.ping();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        console.log('[app] healthcheck: GET /health -> 200 OK');
      } catch (err) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'unhealthy', error: err.message }));
        console.error(`[app] healthcheck: GET /health -> 503 (${err.message})`);
      }
      return;
    }

    try {
      const visits = await client.incr('visits');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Привіт від Docker Compose! Кількість відвідувань: ${visits}\n`);
      console.log(`[app] ${req.method} ${req.url} -> 200 (visits=${visits})`);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Помилка: Redis недоступний\n');
      console.error(`[app] ${req.method} ${req.url} -> 500 (${err.message})`);
    }
  });

  server.listen(PORT, '0.0.0.0', () =>
    console.log(`[app] Сервер слухає на порту ${PORT}`)
  );
}

main().catch((err) => {
  console.error('[app] Критична помилка:', err.message);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('[app] Отримано SIGTERM, завершення роботи');
  try { await client.quit(); } catch (_) {}
  process.exit(0);
});
