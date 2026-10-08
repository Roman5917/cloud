'use strict';

const assert = require('node:assert/strict');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Throttle {
    constructor(rate, intervalMs = 1000) {
        if (!Number.isInteger(rate) || rate <= 0) {
            throw new RangeError('rate має бути додатним цілим числом');
        }
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
            throw new RangeError('intervalMs має бути додатним числом');
        }
        this.rate = rate;
        this.intervalMs = intervalMs;
    }

    throttle(fn, options = {}) {
        if (typeof fn !== 'function') {
            throw new TypeError('fn має бути функцією');
        }

        const { leading = true, trailing = false, mode = 'drop' } = options;
        if (typeof leading !== 'boolean' || typeof trailing !== 'boolean') {
            throw new TypeError('leading і trailing мають бути boolean');
        }
        if (mode !== 'drop' && mode !== 'queue') {
            throw new RangeError('mode: лише "drop" або "queue"');
        }

        const executions = [];
        const queue = [];
        let lastRequest = null;
        let timer = null;
        let firstAllowedAt = null;

        const removeExpired = (now) => {
            while (executions.length && now - executions[0] >= this.intervalMs) {
                executions.shift();
            }
        };

        const canExecute = (now) => {
            removeExpired(now);
            return now >= firstAllowedAt && executions.length < this.rate;
        };

        const execute = (request) => {
            executions.push(Date.now());
            fn(...request);
        };

        const hasPending = () => mode === 'queue' ? queue.length > 0 : lastRequest !== null;

        const schedule = () => {
            if (timer !== null || !hasPending()) return;
            const now = Date.now();
            removeExpired(now);
            const nextSlot = executions.length >= this.rate
                ? executions[0] + this.intervalMs + 2
                : now;
            const nextTime = Math.max(firstAllowedAt, nextSlot);
            timer = setTimeout(processPending, Math.max(1, nextTime - now));
        };

        const processPending = () => {
            timer = null;
            while (hasPending() && canExecute(Date.now())) {
                if (mode === 'queue') {
                    execute(queue.shift());
                } else {
                    const request = lastRequest;
                    lastRequest = null;
                    execute(request);
                }
            }
            schedule();
        };

        return (...args) => {
            const now = Date.now();
            if (firstAllowedAt === null) {
                firstAllowedAt = leading ? now : now + this.intervalMs;
            }

            if (mode === 'queue') {
                if (queue.length === 0 && canExecute(now)) {
                    execute(args);
                    return 'виконано';
                }
                queue.push(args);
                schedule();
                return 'у черзі';
            }

            if (lastRequest === null && canExecute(now)) {
                execute(args);
                return 'виконано';
            }
            if (trailing) {
                lastRequest = args; // Залишається лише останній відкладений виклик.
                schedule();
                return 'відкладено';
            }
            return 'відкинуто';
        };
    }
}

const divider = (title) => console.log('\n' + title + '\n' + '-'.repeat(53));

async function testWindowLimit() {
    divider('ТЕСТ 1. Ліміт 3 виклики/с, 10 швидких запитів');
    const executed = [];
    const limit = new Throttle(3, 1000);
    const handler = limit.throttle((id) => executed.push(id), {
        leading: true, trailing: false, mode: 'drop'
    });
    const statuses = [];
    for (let id = 1; id <= 10; id++) statuses.push(handler(id));

    const dropped = statuses.filter((status) => status === 'відкинуто').length;
    assert.deepEqual(executed, [1, 2, 3]);
    assert.equal(dropped, 7);
    console.log('Надіслано запитів: 10 за один короткий проміжок (< 1 с)');
    console.log('Виконано номери:  ' + executed.join(', '));
    console.log('Відкинуто:        ' + dropped);
    console.log('Результат: PASS — не більше 3 викликів за 1 с');
}

async function testLeadingTrailing() {
    divider('ТЕСТ 2. leading=true, trailing=true, mode=drop');
    const executed = [];
    const handler = new Throttle(3).throttle((id) => executed.push(id), {
        leading: true, trailing: true, mode: 'drop'
    });
    for (let id = 1; id <= 6; id++) handler(id);
    assert.deepEqual(executed, [1, 2, 3]);
    console.log('Одразу виконано:  ' + executed.join(', '));
    console.log('Запити 4–6:      відкладено, збережено останній (6)');
    await wait(1100);
    assert.deepEqual(executed, [1, 2, 3, 6]);
    console.log('Після 1 секунди: ' + executed.join(', '));
    console.log('Результат: PASS — перші виклики + останній відкладений');

    divider('ТЕСТ 3. leading=false, trailing=true, mode=drop');
    const delayed = [];
    const delayedHandler = new Throttle(3).throttle((id) => delayed.push(id), {
        leading: false, trailing: true, mode: 'drop'
    });
    for (let id = 1; id <= 4; id++) delayedHandler(id);
    assert.equal(delayed.length, 0);
    console.log('Одразу виконано:  0 (leading вимкнено)');
    await wait(1100);
    assert.deepEqual(delayed, [4]);
    console.log('Після 1 секунди: ' + delayed.join(', '));
    console.log('Результат: PASS — виконується останній запит');
}

async function testQueue() {
    divider('ТЕСТ 4. Черга FIFO, ліміт 3 виклики/с');
    const executed = [];
    const start = Date.now();
    const handler = new Throttle(3).throttle((id) => {
        const time = Date.now() - start;
        executed.push({ id, time });
        console.log('Виконано запит ' + id + ' на ' + time + ' мс');
    }, { leading: true, trailing: true, mode: 'queue' });

    for (let id = 1; id <= 8; id++) handler(id);
    console.log('У чергу поставлено 5 запитів, очікуємо виконання...');
    await wait(2200);
    assert.deepEqual(executed.map((item) => item.id), [1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 3; i < executed.length; i++) {
        assert.ok(executed[i].time - executed[i - 3].time >= 1000,
            'Порушено обмеження 3 виклики у будь-які 1000 мс');
    }
    console.log('Порядок: ' + executed.map((item) => item.id).join(' → '));
    console.log('Результат: PASS — порядок FIFO і ліміт збережено');
}

async function main() {
    const group = process.argv[2] || 'all';
    const allowed = ['all', 'limit', 'modes', 'queue'];
    if (!allowed.includes(group)) throw new Error('Група: all | limit | modes | queue');
    if (group === 'all' || group === 'limit') await testWindowLimit();
    if (group === 'all' || group === 'modes') await testLeadingTrailing();
    if (group === 'all' || group === 'queue') await testQueue();
    console.log('\nУСІ ВИБРАНІ ТЕСТИ ПРОЙДЕНО');
}

if (require.main === module) {
    main().catch((error) => {
        console.error('ТЕСТ НЕ ПРОЙДЕНО:', error);
        process.exitCode = 1;
    });
}

module.exports = { Throttle };
