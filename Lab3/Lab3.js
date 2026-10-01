const assert = require('assert');

class Retry {
    constructor(maxAttempts, strategy = 'constant', retryOn = []) {
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
            throw new Error('maxAttempts must be a positive integer');
        }

        if (!['constant', 'exponential', 'exponentialJitter'].includes(strategy)) {
            throw new Error('Unknown retry strategy');
        }

        if (!Array.isArray(retryOn)) {
            throw new TypeError('retryOn must be an array');
        }

        this.maxAttempts = maxAttempts;
        this.strategy = strategy;
        this.retryOn = retryOn;
        this.baseDelayMs = 100;
    }

    async execute(fn) {
        if (typeof fn !== 'function') {
            throw new TypeError('fn must be a function');
        }

        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            try {
                const result = await fn();
                console.log(`Attempt ${attempt}: ${this.describeSuccess(result)}`);
                return result;
            } catch (error) {
                console.log(`Attempt ${attempt}: ${this.describeError(error)}`);

                if (!this.isRetryable(error)) {
                    console.log('Retry: no, error is not in retryOn');
                    throw error;
                }

                if (attempt === this.maxAttempts) {
                    console.log('Retry: no, maxAttempts reached');
                    throw error;
                }

                const delay = this.getDelayMs(attempt);
                console.log(`Retry: yes, next attempt in ${delay} ms`);
                await this.sleep(delay);
            }
        }
    }

    isRetryable(error) {
        if (this.retryOn.length === 0) {
            return true;
        }

        const values = [
            error.code,
            error.status,
            error.statusCode,
            error.name,
            error.message
        ];

        return this.retryOn.some(retryValue => values.includes(retryValue));
    }

    getDelayMs(attempt) {
        if (this.strategy === 'constant') {
            return this.baseDelayMs;
        }

        const exponentialDelay = this.baseDelayMs * 2 ** (attempt - 1);

        if (this.strategy === 'exponential') {
            return exponentialDelay;
        }

        return Math.floor(Math.random() * exponentialDelay);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    describeSuccess(result) {
        if (result && typeof result.status === 'number') {
            const message = result.message || result.data || 'Success';
            return `HTTP ${result.status} ${message}`;
        }

        return `success: ${String(result)}`;
    }

    describeError(error) {
        const status = error.status ?? error.statusCode;

        if (typeof status === 'number') {
            return `HTTP ${status} ${error.message}`;
        }

        if (error.code !== undefined) {
            return `${error.code} ${error.message}`;
        }

        return `${error.name}: ${error.message}`;
    }
}

class TestRetry extends Retry {
    constructor(maxAttempts, strategy, retryOn) {
        super(maxAttempts, strategy, retryOn);
        this.delays = [];
    }

    async sleep(ms) {
        this.delays.push(ms);
    }

    get totalDelayMs() {
        return this.delays.reduce((sum, delay) => sum + delay, 0);
    }
}

function createHttpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function printSummary(result) {
    console.log(`Result: ${result}`);
    console.log();
}

async function runTests() {
    console.log('Test 1: success on the first attempt');
    {
        const retry = new TestRetry(4, 'constant', [503]);
        let attempts = 0;

        const result = await retry.execute(async () => {
            attempts++;
            return { status: 200, message: 'OK' };
        });

        assert.strictEqual(result.status, 200);
        assert.strictEqual(attempts, 1);
        assert.strictEqual(retry.totalDelayMs, 0);
        printSummary('passed');
    }

    console.log('Test 2: temporary HTTP 503, then success');
    {
        const retry = new TestRetry(5, 'constant', [503]);
        let attempts = 0;

        const result = await retry.execute(async () => {
            attempts++;

            if (attempts < 3) {
                throw createHttpError(503, 'Service Unavailable');
            }

            return { status: 200, message: 'OK' };
        });

        assert.strictEqual(result.status, 200);
        assert.strictEqual(attempts, 3);
        assert.deepStrictEqual(retry.delays, [100, 100]);
        printSummary('passed');
    }

    console.log('Test 3: stop after maxAttempts');
    {
        const retry = new TestRetry(4, 'exponential', [503]);
        let attempts = 0;

        await assert.rejects(
            () => retry.execute(async () => {
                attempts++;
                throw createHttpError(503, 'Service Unavailable');
            }),
            error => error.status === 503
        );

        assert.strictEqual(attempts, 4);
        assert.deepStrictEqual(retry.delays, [100, 200, 400]);
        assert.strictEqual(retry.totalDelayMs, 700);
        printSummary(`passed, total delay ${retry.totalDelayMs} ms`);
    }

    console.log('Test 4: non-retryable HTTP 400');
    {
        const retry = new TestRetry(5, 'constant', [503, 'ETIMEDOUT']);
        let attempts = 0;

        await assert.rejects(
            () => retry.execute(async () => {
                attempts++;
                throw createHttpError(400, 'Bad Request');
            }),
            error => error.status === 400
        );

        assert.strictEqual(attempts, 1);
        assert.strictEqual(retry.totalDelayMs, 0);
        printSummary('passed, retry was not performed');
    }

    console.log('Test 5: delay strategies');
    {
        const constant = new Retry(2, 'constant');
        const exponential = new Retry(2, 'exponential');
        const jitter = new Retry(2, 'exponentialJitter');

        assert.strictEqual(constant.getDelayMs(3), 100);
        assert.strictEqual(exponential.getDelayMs(1), 100);
        assert.strictEqual(exponential.getDelayMs(2), 200);
        assert.strictEqual(exponential.getDelayMs(3), 400);

        const originalRandom = Math.random;
        Math.random = () => 0.5;

        try {
            assert.strictEqual(jitter.getDelayMs(3), 200);
        } finally {
            Math.random = originalRandom;
        }

        console.log('constant: 100 ms');
        console.log('exponential: 100, 200, 400 ms');
        console.log('exponentialJitter: random delay from 0 to the exponential limit');
        printSummary('passed');
    }

    console.log('All tests passed successfully.');
}

if (require.main === module) {
    runTests().catch(error => {
        console.error(`Test failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = Retry;
