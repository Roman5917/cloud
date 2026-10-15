'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

function hash(text) {
  return BigInt('0x' + createHash('sha256').update(String(text)).digest('hex').slice(0, 16));
}

class Sharding {
  constructor(shards, virtualNodes = 256) {
    if (!Array.isArray(shards) || !shards.length || new Set(shards).size !== shards.length) {
      throw new Error('Потрібен непорожній список унікальних шардів');
    }
    if (!Number.isInteger(virtualNodes) || virtualNodes < 1) throw new Error('Некоректна кількість віртуальних вузлів');
    this.virtualNodes = virtualNodes;
    this.nodes = new Map(shards.map((id) => [id, new Map()]));
    this.rebuildRing();
  }

  rebuildRing() {
    this.ring = [];
    for (const id of this.nodes.keys()) {
      for (let i = 0; i < this.virtualNodes; i++) this.ring.push({ position: hash(`${id}#${i}`), id });
    }
    this.ring.sort((a, b) => a.position < b.position ? -1 : a.position > b.position ? 1 : 0);
  }

  shardFor(key) {
    const target = hash(key);
    let left = 0;
    let right = this.ring.length;
    while (left < right) {
      const mid = (left + right) >> 1;
      if (this.ring[mid].position < target) left = mid + 1;
      else right = mid;
    }
    return this.ring[left % this.ring.length].id;
  }

  put(key, value) { this.nodes.get(this.shardFor(key)).set(String(key), value); }
  get(key) { return this.nodes.get(this.shardFor(key)).get(String(key)); }
  distribution() { return Object.fromEntries([...this.nodes].map(([id, values]) => [id, values.size])); }
  snapshot() {
    const data = new Map();
    for (const shard of this.nodes.values()) for (const [key, value] of shard) data.set(key, value);
    return data;
  }
  rebalance() {
    const data = this.snapshot();
    for (const shard of this.nodes.values()) shard.clear();
    this.rebuildRing();
    for (const [key, value] of data) this.put(key, value);
  }
  addShard(id) {
    if (this.nodes.has(id)) throw new Error('Шард уже існує');
    this.nodes.set(id, new Map());
    this.rebalance();
  }
  removeShard(id) {
    if (!this.nodes.has(id)) throw new Error('Шард не знайдено');
    if (this.nodes.size === 1) throw new Error('Неможливо видалити останній шард');
    const data = this.snapshot();
    this.nodes.delete(id);
    this.rebuildRing();
    for (const shard of this.nodes.values()) shard.clear();
    for (const [key, value] of data) this.put(key, value);
  }
}

function printDistribution(distribution) {
  for (const [name, count] of Object.entries(distribution)) console.log(`  ${name}: ${count} ключів`);
}

async function main() {
  const storage = new Sharding(['S1', 'S2', 'S3', 'S4']);
  // Відтворюваний набір псевдовипадкових ключів (LCG із фіксованим seed).
  let seed = 123456789;
  const keys = Array.from({ length: 5000 }, (_, i) => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return `key_${seed.toString(16)}_${i}`;
  });
  for (const [i, key] of keys.entries()) storage.put(key, `value_${i}`);

  console.log('\nТЕСТ 1. put/get для 5000 ключів');
  for (const [i, key] of keys.entries()) assert.equal(storage.get(key), `value_${i}`);
  console.log('Записано 5000, правильно прочитано 5000.');
  console.log('PASS: усі значення доступні за ключами.');

  console.log('\nТЕСТ 2. Статистичний розподіл 5000 псевдовипадкових ключів');
  const before = storage.distribution();
  printDistribution(before);
  const expected = keys.length / 4;
  const maxDeviation = Math.max(...Object.values(before).map((count) => Math.abs(count - expected) / expected));
  console.log(`Найбільше відхилення від 1250: ${(maxDeviation * 100).toFixed(1)}%`);
  assert(maxDeviation < 0.2, 'Відхилення повинно бути менше 20%');
  console.log('PASS: найбільше відхилення менше 20%.');

  console.log('\nТЕСТ 3. Додавання шарда S5');
  const originalOwners = keys.map((key) => storage.shardFor(key));
  storage.addShard('S5');
  const movedOnAdd = keys.filter((key, i) => storage.shardFor(key) !== originalOwners[i]).length;
  const shareAdd = movedOnAdd / keys.length;
  printDistribution(storage.distribution());
  console.log(`Переміщено: ${movedOnAdd} із 5000 (${(shareAdd * 100).toFixed(1)}%)`);
  assert(shareAdd > 0 && shareAdd < 0.4);
  for (const [i, key] of keys.entries()) assert.equal(storage.get(key), `value_${i}`);
  console.log('PASS: менше 40% перемаплено, усі дані доступні.');

  console.log('\nТЕСТ 4. Видалення шарда S5');
  const fiveOwners = keys.map((key) => storage.shardFor(key));
  storage.removeShard('S5');
  const movedOnRemove = keys.filter((key, i) => storage.shardFor(key) !== fiveOwners[i]).length;
  console.log(`Переміщено: ${movedOnRemove} із 5000 (${(movedOnRemove / 50).toFixed(1)}%)`);
  assert(movedOnRemove / keys.length < 0.4);
  assert.deepEqual(storage.distribution(), before);
  for (const [i, key] of keys.entries()) assert.equal(storage.get(key), `value_${i}`);
  console.log('PASS: після видалення всі значення збережено, розподіл відновлено.');

}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
module.exports = { Sharding };
