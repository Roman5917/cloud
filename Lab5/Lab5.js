'use strict';

const assert = require('node:assert/strict');

class TimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TimeoutError';
    }
}

function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal && signal.aborted) {
            reject(new Error('Операцію скасовано'));
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Операцію скасовано'));
        };
        const timer = setTimeout(() => {
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
}

function withTimeout(fn, timeoutMs) {
    if (typeof fn !== 'function') throw new TypeError('fn має бути функцією');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError('timeoutMs має бути додатним числом');
    }

    const controller = new AbortController();
    let timer;
    const task = Promise.resolve().then(() => fn(controller.signal));
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new TimeoutError('Перевищено час очікування: ' + timeoutMs + ' мс'));
        }, timeoutMs);
    });
    return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}

async function retryWithDeadline(fn, { maxAttempts, totalTimeoutMs, pauseMs }) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new RangeError('maxAttempts має бути додатним цілим числом');
    }
    if (!Number.isFinite(totalTimeoutMs) || totalTimeoutMs <= 0 ||
        !Number.isFinite(pauseMs) || pauseMs < 0) {
        throw new RangeError('Некоректні значення часу');
    }

    const deadline = Date.now() + totalTimeoutMs;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            throw new TimeoutError('Перевищено загальний ліміт ' + totalTimeoutMs + ' мс');
        }
        try {
            return await withTimeout((signal) => fn(attempt, signal), remaining);
        } catch (error) {
            if (Date.now() >= deadline) {
                throw new TimeoutError('Перевищено загальний ліміт ' + totalTimeoutMs + ' мс');
            }
            if (attempt === maxAttempts) throw error;
            await delay(Math.min(pauseMs, Math.max(0, deadline - Date.now())));
        }
    }
}

const heading = (title) => console.log('\n' + title + '\n' + '-'.repeat(53));

async function testSuccess() {
    heading('ТЕСТ 1. Успішне завершення раніше тайм-ауту');
    const started = Date.now();
    const result = await withTimeout(async (signal) => {
        await delay(70, signal);
        return 'Дані отримано';
    }, 250);
    assert.equal(result, 'Дані отримано');
    console.log('Тайм-аут:  250 мс');
    console.log('Результат: ' + result);
    console.log('Час:       ' + (Date.now() - started) + ' мс');
    console.log('Перевірка: PASS — операція завершилась вчасно');
}

async function testTimeoutAndCancellation() {
    heading('ТЕСТ 2. Перевищення часу, відміна побічних ефектів');
    let changes = 0;
    let capturedSignal;
    const started = Date.now();
    let error;
    try {
        await withTimeout(async (signal) => {
            capturedSignal = signal;
            await delay(280, signal);
            signal.throwIfAborted();
            changes++;
        }, 90);
    } catch (caught) {
        error = caught;
    }
    assert.ok(error instanceof TimeoutError);
    assert.equal(changes, 0);
    console.log('Тайм-аут:             90 мс');
    console.log('Запланована робота:   280 мс');
    console.log('Отримана помилка:     ' + error.name);
    console.log('Минуло:              ' + (Date.now() - started) + ' мс');
    console.log('Сигнал скасування:   ' + capturedSignal.aborted);
    await delay(300);
    assert.equal(changes, 0);
    console.log('Побічні ефекти:       ' + changes + ' (перевірено також через 300 мс)');
    console.log('Перевірка: PASS — роботу скасовано, змін немає');
}

async function testRetrySuccess() {
    heading('ТЕСТ 3. Retry: друга спроба успішна');
    const started = Date.now();
    const result = await retryWithDeadline(async (attempt, signal) => {
        console.log('Спроба ' + attempt + ': початок');
        await delay(65, signal);
        if (attempt === 1) throw new Error('Тимчасова помилка');
        return 'Успіх із спроби ' + attempt;
    }, { maxAttempts: 3, totalTimeoutMs: 500, pauseMs: 40 });
    assert.equal(result, 'Успіх із спроби 2');
    assert.ok(Date.now() - started <= 500);
    console.log('Результат: ' + result);
    console.log('Загальний час: ' + (Date.now() - started) + ' мс із 500 мс');
    console.log('Перевірка: PASS — Retry з єдиним лімітом часу');
}

async function testRetryDeadline() {
    heading('ТЕСТ 4. Retry: загальний ліміт не множиться');
    const started = Date.now();
    let attempts = 0;
    let error;
    try {
        await retryWithDeadline(async (attempt, signal) => {
            attempts++;
            console.log('Спроба ' + attempt + ': очікування 140 мс');
            await delay(140, signal);
            throw new Error('Тимчасова помилка');
        }, { maxAttempts: 5, totalTimeoutMs: 420, pauseMs: 35 });
    } catch (caught) {
        error = caught;
    }
    const elapsed = Date.now() - started;
    assert.ok(error instanceof TimeoutError);
    assert.ok(attempts >= 2 && attempts <= 3);
    assert.ok(elapsed >= 400 && elapsed < 650);
    console.log('Кількість спроб: ' + attempts + ' (максимум 5)');
    console.log('Витрачено:       ' + elapsed + ' мс');
    console.log('Загальний ліміт: 420 мс');
    console.log('Помилка:         ' + error.name);
    console.log('Перевірка: PASS — ліміт спільний для всіх спроб');
}

async function main() {
    const group = process.argv[2] || 'all';
    if (!['all', 'basic', 'retry'].includes(group)) {
        throw new Error('Група: all | basic | retry');
    }
    if (group === 'all' || group === 'basic') {
        await testSuccess();
        await testTimeoutAndCancellation();
    }
    if (group === 'all' || group === 'retry') {
        await testRetrySuccess();
        await testRetryDeadline();
    }
    console.log('\nУСІ ВИБРАНІ ТЕСТИ ПРОЙДЕНО');
}

if (require.main === module) {
    main().catch((error) => {
        console.error('ТЕСТ НЕ ПРОЙДЕНО:', error);
        process.exitCode = 1;
    });
}

module.exports = { withTimeout, TimeoutError, retryWithDeadline };
