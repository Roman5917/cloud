'use strict';

const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function* fanIn(inputs) {
  if (!Array.isArray(inputs) || !inputs.every((s) => s && typeof s[Symbol.asyncIterator] === 'function')) {
    throw new TypeError('inputs мають бути масивом async-потоків');
  }

  const queue = [];
  let active = inputs.length;
  let wake = null;
  const notify = () => { if (wake) { const resolve = wake; wake = null; resolve(); } };

  const pumps = inputs.map(async (stream, source) => {
    try {
      for await (const value of stream) {
        queue.push({ ok: true, source: source + 1, value });
        notify();
      }
    } catch (error) {
      queue.push({ ok: false, source: source + 1, error: error.message });
      notify();
    } finally {
      active -= 1;
      notify();
    }
  });

  while (active > 0 || queue.length > 0) {
    if (queue.length > 0) {
      yield queue.shift();
    } else {
      await new Promise((resolve) => { wake = resolve; });
    }
  }
  await Promise.all(pumps);
}

async function* stream(name, values, interval, failAfter = false) {
  for (const value of values) {
    await delay(interval);
    yield `${name}${value}`;
  }
  if (failAfter) throw new Error(`Помилка джерела ${name}`);
}

async function collect(inputs) {
  const items = [];
  for await (const item of fanIn(inputs)) items.push(item);
  return items;
}

async function main() {

  console.log('\nТЕСТ 1. Злиття двох потоків');
  const two = await collect([stream('A', [1, 2, 3], 35), stream('B', [1, 2], 15)]);
  console.log('Загальний потік:', two.map((x) => x.value).join(' → '));
  assert.equal(two.length, 5);
  assert.deepEqual(two.filter((x) => x.source === 1).map((x) => x.value), ['A1', 'A2', 'A3']);
  assert.deepEqual(two.filter((x) => x.source === 2).map((x) => x.value), ['B1', 'B2']);
  assert(two.findIndex((x) => x.value === 'B1') < two.findIndex((x) => x.value === 'A1'), 'Швидкий вхід не повинен чекати повільний');
  console.log('PASS: усі 5 значень отримано; порядок усередині потоків збережено.');

  console.log('\nТЕСТ 2. Три входи, закриття після останнього');
  const three = await collect([stream('X', [1, 2], 20), stream('Y', [1], 5), stream('Z', [1, 2], 30)]);
  console.log('Загальний потік:', three.map((x) => x.value).join(' → '));
  assert.deepEqual(three.filter((x) => x.source === 1).map((x) => x.value), ['X1', 'X2']);
  assert.deepEqual(three.filter((x) => x.source === 2).map((x) => x.value), ['Y1']);
  assert.deepEqual(three.filter((x) => x.source === 3).map((x) => x.value), ['Z1', 'Z2']);
  assert.equal(three.length, 5);
  console.log('PASS: 3 входи завершені, вихідний потік закрився після 5-го значення.');

  console.log('\nТЕСТ 3. Помилка одного входу не зупиняє інші');
  const withError = await collect([stream('A', [1], 10, true), stream('B', [1, 2, 3], 20)]);
  console.log('Результати:', withError.map((x) => x.ok ? x.value : `ERROR(${x.error})`).join(' → '));
  assert.equal(withError.filter((x) => !x.ok).length, 1);
  assert.deepEqual(withError.filter((x) => x.ok && x.source === 2).map((x) => x.value), ['B1', 'B2', 'B3']);
  assert.equal(withError.length, 5);
  console.log('PASS: помилку передано як Result, B1–B3 надійшли повністю.');

  console.log('\nТЕСТ 4. Порожній перелік входів');
  assert.deepEqual(await collect([]), []);
  console.log('PASS: вихід одразу завершився.');

}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = { fanIn };
