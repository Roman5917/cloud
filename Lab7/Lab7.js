'use strict'

const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fanOut(process, workers) {
  if (typeof process !== 'function') throw new TypeError('process повинен бути функцією');
  if (!Number.isInteger(workers) || workers < 1) throw new RangeError('workers має бути додатним цілим числом');

  const tasks = [];
  const completed = [];
  const taskWaiters = [];
  let resultWake = null;
  let accepting = true;
  let finished = false;
  let nextId = 1;

  const notifyResults = () => { if (resultWake) { const resolve = resultWake; resultWake = null; resolve(); } };
  const releaseWorkers = () => { while (taskWaiters.length) taskWaiters.shift()(); };

  async function worker(workerId) {
    while (true) {
      if (!tasks.length) {
        if (!accepting) return;
        await new Promise((resolve) => taskWaiters.push(resolve));
        continue;
      }
      const { id, task } = tasks.shift();
      try {
        const value = await process(task);
        completed.push({ ok: true, id, worker: workerId, value });
      } catch (error) {
        completed.push({ ok: false, id, worker: workerId, error: error.message });
      }
      notifyResults();
    }
  }

  const jobs = Array.from({ length: workers }, (_, i) => worker(i + 1));
  let shutdownPromise = null;

  return {
    submit(task) {
      if (!accepting) throw new Error('Після shutdown нові задачі заборонені');
      const id = nextId++;
      tasks.push({ id, task });
      releaseWorkers();
      return id;
    },
    shutdown() {
      if (!shutdownPromise) {
        accepting = false;
        releaseWorkers();
        shutdownPromise = Promise.all(jobs).then(() => {
          finished = true;
          notifyResults();
        });
      }
      return shutdownPromise;
    },
    async *results() {
      while (completed.length || !finished) {
        if (completed.length) yield completed.shift();
        else await new Promise((resolve) => { resultWake = resolve; });
      }
    }
  };
}

async function runBatch(count) {
  const pool = fanOut(async (task) => {
    await delay(80);
    return task * 10;
  }, count);
  for (let i = 1; i <= 6; i++) pool.submit(i);
  const started = performance.now();
  const done = pool.shutdown();
  const output = [];
  for await (const item of pool.results()) output.push(item);
  await done;
  return { ms: performance.now() - started, output };
}

async function main() {

  console.log('\nТЕСТ 1. Порівняння 1 та 3 воркерів (6 задач × 80 мс)');
  const one = await runBatch(1);
  const three = await runBatch(3);
  console.log(`1 воркер: ${one.ms.toFixed(0)} мс; 3 воркери: ${three.ms.toFixed(0)} мс`);
  console.log(`Прискорення: ${(one.ms / three.ms).toFixed(2)} раз(и)`);
  assert(three.ms < one.ms * 0.7, '3 воркери повинні працювати швидше');
  assert.equal(three.output.length, 6);
  console.log('PASS: паралельне виконання швидше за послідовне.');

  console.log('\nТЕСТ 2. Без втрат і подвійної обробки');
  const ids = three.output.map((x) => x.id);
  const values = three.output.map((x) => x.value).sort((a, b) => a - b);
  console.log('ID оброблених задач:', ids.join(', '));
  console.log('Результати (за значенням):', values.join(', '));
  assert.equal(new Set(ids).size, 6);
  assert.deepEqual([...ids].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(values, [10, 20, 30, 40, 50, 60]);
  console.log('PASS: кожна задача оброблена рівно один раз.');

  console.log('\nТЕСТ 3. Graceful shutdown');
  const pool = fanOut(async (x) => { await delay(15); return x + 1; }, 2);
  pool.submit(10); pool.submit(20); pool.submit(30);
  const shutdown = pool.shutdown();
  assert.throws(() => pool.submit(40), /shutdown/);
  const output = [];
  for await (const item of pool.results()) output.push(item);
  await shutdown;
  assert.deepEqual(output.map((x) => x.value).sort((a, b) => a - b), [11, 21, 31]);
  console.log('Оброблено:', output.length, 'із 3; після shutdown нові задачі не приймаються.');
  console.log('PASS: черга завершена, результати видані, воркери зупинилися.');

  console.log('\nТЕСТ 4. Помилка окремої задачі');
  const errors = fanOut(async (x) => { if (x === 2) throw new Error('Тестова помилка'); return x; }, 2);
  [1, 2, 3].forEach((x) => errors.submit(x));
  const done = errors.shutdown();
  const items = [];
  for await (const item of errors.results()) items.push(item);
  await done;
  assert.equal(items.filter((x) => !x.ok).length, 1);
  assert.deepEqual(items.filter((x) => x.ok).map((x) => x.value).sort(), [1, 3]);
  console.log('Успішні задачі: 1, 3; помилка задачі 2 передана у результаті.');
  console.log('PASS: збій задачі не зупинив інших воркерів.');

}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = { fanOut };
