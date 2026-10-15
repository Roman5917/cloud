'use strict';

const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Future {
  constructor(executor) {
    this.state = 'pending';
    this.promise = new Promise((resolve, reject) => {
      const fulfill = (value) => {
        if (this.state !== 'pending') return;
        this.state = 'fulfilled';
        resolve(value);
      };
      const rejectOnce = (error) => {
        if (this.state !== 'pending') return;
        this.state = 'rejected';
        reject(error);
      };
      try { executor(fulfill, rejectOnce); } catch (error) { rejectOnce(error); }
    });
  }

  then(onValue, onError) { return Future.fromPromise(this.promise.then(onValue, onError)); }
  catch(onError) { return Future.fromPromise(this.promise.catch(onError)); }
  onError(onError) { return this.catch(onError); }

  get(timeout) {
    if (timeout === undefined) return this.promise;
    if (!Number.isFinite(timeout) || timeout < 0) throw new RangeError('timeout має бути невідʼємним');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout після ${timeout} мс`)), timeout);
      this.promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }
  await(timeout) { return this.get(timeout); }

  static fromPromise(promise) {
    return new Future((resolve, reject) => Promise.resolve(promise).then(resolve, reject));
  }
  static submit(fn) {
    return Future.fromPromise(Promise.resolve().then(fn));
  }
  static all(futures) {
    return Future.fromPromise(Promise.all(futures.map((f) => f.get())));
  }
  static race(futures) {
    return Future.fromPromise(Promise.race(futures.map((f) => f.get())));
  }
}

const submit = (fn) => Future.submit(fn);

async function main() {

  console.log('\nТЕСТ 1. Успішне значення, then та стан');
  const future = submit(async () => { await delay(20); return 21; });
  const transformed = future.then((x) => x * 2);
  assert.equal(future.state, 'pending');
  assert.equal(await transformed.get(), 42);
  assert.equal(await future.await(), 21);
  assert.equal(future.state, 'fulfilled');
  console.log('submit → 21; then(x * 2) → 42; стан: fulfilled');
  console.log('PASS: значення отримано та оброблено через then.');

  console.log('\nТЕСТ 2. Помилка та catch');
  const rejected = submit(async () => { throw new Error('Збій обчислення'); });
  const recovered = rejected.catch((e) => `Перехоплено: ${e.message}`);
  assert.equal(await recovered.get(), 'Перехоплено: Збій обчислення');
  assert.equal(rejected.state, 'rejected');
  await assert.rejects(() => rejected.get(), /Збій обчислення/);
  console.log('rejected → catch → Перехоплено: Збій обчислення');
  console.log('PASS: помилку передано та перехоплено.');

  console.log('\nТЕСТ 3. all очікує всі значення');
  const started = performance.now();
  const together = Future.all([
    submit(async () => { await delay(20); return 'Швидкий'; }),
    submit(async () => { await delay(65); return 'Повільний'; })
  ]);
  const values = await together.get();
  const elapsed = performance.now() - started;
  assert.deepEqual(values, ['Швидкий', 'Повільний']);
  assert(elapsed >= 50);
  console.log(`all → [${values.join(', ')}]; час: ${elapsed.toFixed(0)} мс`);
  console.log('PASS: all завершився після повільнішого Future.');

  console.log('\nТЕСТ 4. race повертає перший завершений');
  const winner = await Future.race([
    submit(async () => { await delay(60); return 'Повільний'; }),
    submit(async () => { await delay(10); return 'Швидкий'; })
  ]).get();
  assert.equal(winner, 'Швидкий');
  console.log('race →', winner);
  console.log('PASS: повернуто перший завершений Future.');

  console.log('\nТЕСТ 5. Тайм-аут get(timeout)');
  const slow = submit(async () => { await delay(65); return 'Готово'; });
  await assert.rejects(() => slow.get(10), /Timeout/);
  console.log('get(10) → Timeout; Future залишається активним.');
  assert.equal(await slow.get(100), 'Готово');
  assert.equal(slow.state, 'fulfilled');
  console.log('Наступний get(100) → Готово; стан: fulfilled');
  console.log('PASS: тайм-аут очікування не скасував обчислення.');

  console.log('\nТЕСТ 6. Неможливість повторного встановлення результату');
  const once = new Future((resolve, reject) => { resolve('Перший'); reject(new Error('Другий')); resolve('Третій'); });
  assert.equal(await once.get(), 'Перший');
  assert.equal(once.state, 'fulfilled');
  console.log('resolve(Перший), reject(Другий), resolve(Третій) → Перший');
  console.log('PASS: Future переходить у кінцевий стан лише один раз.');

}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = { Future, submit };
