const assert = require('assert');

class Debounce {
    constructor(delayMs, options = {}) {
        if (!Number.isFinite(delayMs) || delayMs < 0) {
            throw new Error('delayMs must be a non-negative number');
        }

        this.delayMs = delayMs;
        this.defaultLeading = options.leading ?? false;
        this.defaultTrailing = options.trailing ?? true;

        this.timers = new Set();
        this.disposed = false;
    }

    debounce(fn, options = {}) {
        if (typeof fn !== 'function') {
            throw new TypeError('fn must be a function');
        }

        const leading = options.leading ?? this.defaultLeading;
        const trailing = options.trailing ?? this.defaultTrailing;

        let timer = null;
        let lastArgs = null;
        let lastThis = null;
        let trailingPending = false;

        const clearCurrentTimer = () => {
            if (timer !== null) {
                clearTimeout(timer);
                this.timers.delete(timer);
                timer = null;
            }
        };

        const owner = this;

        function wrapped(...args) {
            if (owner.disposed) {
                return;
            }

            const firstCall = timer === null;

            lastArgs = args;
            lastThis = this;

            if (leading && firstCall) {
                fn.apply(lastThis, lastArgs);
                trailingPending = false;
            } else if (trailing) {
                trailingPending = true;
            }

            clearCurrentTimer();

            timer = setTimeout(() => {
                const finishedTimer = timer;

                timer = null;
                owner.timers.delete(finishedTimer);

                if (owner.disposed) {
                    return;
                }

                if (trailing && trailingPending) {
                    fn.apply(lastThis, lastArgs);
                }

                trailingPending = false;
                lastArgs = null;
                lastThis = null;
            }, owner.delayMs);

            owner.timers.add(timer);
        }

        wrapped.cancel = () => {
            clearCurrentTimer();

            trailingPending = false;
            lastArgs = null;
            lastThis = null;
        };

        return wrapped;
    }

    dispose() {
        for (const timer of this.timers) {
            clearTimeout(timer);
        }

        this.timers.clear();
        this.disposed = true;
    }
}


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


async function runTests() {
    console.log('DEBOUNCE TESTING');
    console.log('');


    console.log('TEST 1');
    console.log('Rapid calls with trailing enabled');
    console.log('Delay: 80 ms');

    {
        const debounce = new Debounce(80);
        const calls = [];

        const wrapped = debounce.debounce((value) => {
            calls.push(value);
            console.log('Function executed with value:', value);
        });

        console.log('Calling function with value 1');
        wrapped(1);

        await sleep(20);

        console.log('Calling function with value 2 after 20 ms');
        wrapped(2);

        await sleep(20);

        console.log('Calling function with value 3 after another 20 ms');
        wrapped(3);

        console.log('Waiting for debounce delay');

        await sleep(120);

        assert.deepStrictEqual(calls, [3]);

        console.log('Expected result: [3]');
        console.log('Actual result:', calls);
        console.log('Test 1 passed');

        debounce.dispose();
    }


    console.log('');
    console.log('----------------------------------------');
    console.log('');


    console.log('TEST 2');
    console.log('Leading enabled, trailing disabled');
    console.log('Delay: 80 ms');

    {
        const debounce = new Debounce(80, {
            leading: true,
            trailing: false
        });

        const calls = [];

        const wrapped = debounce.debounce((value) => {
            calls.push(value);
            console.log('Function executed with value:', value);
        });

        console.log('Calling function with value A');
        wrapped('A');

        await sleep(20);

        console.log('Calling function with value B after 20 ms');
        wrapped('B');

        await sleep(20);

        console.log('Calling function with value C after another 20 ms');
        wrapped('C');

        await sleep(120);

        console.log('Pause finished');
        console.log('Calling function with value D');
        wrapped('D');

        assert.deepStrictEqual(calls, ['A', 'D']);

        console.log('Expected result: [A, D]');
        console.log('Actual result:', calls);
        console.log('Test 2 passed');

        debounce.dispose();
    }


    console.log('');
    console.log('----------------------------------------');
    console.log('');


    console.log('TEST 3');
    console.log('Leading and trailing enabled');
    console.log('Delay: 80 ms');

    {
        const debounce = new Debounce(80, {
            leading: true,
            trailing: true
        });

        const calls = [];

        const wrapped = debounce.debounce((value) => {
            calls.push(value);
            console.log('Function executed with value:', value);
        });

        console.log('Calling function with value 10');
        wrapped(10);

        await sleep(20);

        console.log('Calling function with value 20');
        wrapped(20);

        await sleep(20);

        console.log('Calling function with value 30');
        wrapped(30);

        console.log('Waiting for debounce delay');

        await sleep(120);

        assert.deepStrictEqual(calls, [10, 30]);

        console.log('Expected result: [10, 30]');
        console.log('Actual result:', calls);
        console.log('Test 3 passed');

        debounce.dispose();
    }


    console.log('');
    console.log('----------------------------------------');
    console.log('');


    console.log('TEST 4');
    console.log('Leading and trailing disabled');

    {
        const debounce = new Debounce(60, {
            leading: false,
            trailing: false
        });

        let count = 0;

        const wrapped = debounce.debounce(() => {
            count++;
            console.log('Function executed');
        });

        console.log('First call');
        wrapped();

        console.log('Second call');
        wrapped();

        await sleep(100);

        assert.strictEqual(count, 0);

        console.log('Expected function executions: 0');
        console.log('Actual function executions:', count);
        console.log('Test 4 passed');

        debounce.dispose();
    }


    console.log('');
    console.log('----------------------------------------');
    console.log('');


    console.log('TEST 5');
    console.log('Timer cancellation using dispose');
    console.log('Delay: 100 ms');

    {
        const debounce = new Debounce(100);

        let count = 0;

        const wrapped = debounce.debounce(() => {
            count++;
            console.log('Function executed');
        });

        console.log('Calling debounced function');
        wrapped();

        await sleep(30);

        console.log('Calling dispose after 30 ms');
        debounce.dispose();

        console.log('Waiting longer than debounce delay');

        await sleep(120);

        assert.strictEqual(count, 0);

        console.log('Expected function executions: 0');
        console.log('Actual function executions:', count);
        console.log('Timer was successfully cancelled');
        console.log('Test 5 passed');
    }


    console.log('');
    console.log('----------------------------------------');
    console.log('');
    console.log('ALL TESTS PASSED');
}


if (require.main === module) {
    runTests().catch(error => {
        console.error('TEST FAILED');
        console.error(error);
        process.exit(1);
    });
}


module.exports = Debounce;