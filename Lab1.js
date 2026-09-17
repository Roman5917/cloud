/*1.1 Circuit Breaker (Розмикач ланцюжка)
Ідея: запобігти каскадним відмовам при збоях віддалених сервісів, швидко «відсікати» несправний шлях виклику.
Вимоги до реалізації (мінімальний API):
- Стейт машина: Closed → Open → HalfOpen → (Closed|Open).
- Параметри: failureThreshold, halfOpenMaxCalls, openStateDuration, timeoutPerCall.
- Методи:

- call(fn) — виконує операцію з тайм-аутом; рахує успіхи/збої; керує переходами між станами.
- state() — поточний стан.
Що протестувати:
- Перехід у Open після N послідовних фейлів/тайм-аутів.
- Блокування викликів у Open до закінчення openStateDuration.
- Поведінка HalfOpen: обмежена кількість пробних викликів; повернення в Closed при успіхах або в Open при фейлі.
- Врахування тайм-ауту окремого виклику.
- Моки: залежність fn має керовано падати/висіти/успішно повертати.*/ */


class CircuitBreaker {
    constructor(
        failureThreshold,
        halfOpenMaxCalls,
        openStateDuration,
        timeoutPerCall
    ) {
        this.failureThreshold = failureThreshold;
        this.halfOpenMaxCalls = halfOpenMaxCalls;
        this.openStateDuration = openStateDuration;
        this.timeoutPerCall = timeoutPerCall;

        this.currentState = "Closed";

        this.failureCount = 0;
        this.openedAt = null;

        this.halfOpenCalls = 0;
        this.halfOpenSuccesses = 0;
    }

    state() {
        return this.currentState;
    }

    async call(fn) {


        if (this.currentState === "Open") {

            const timePassed = Date.now() - this.openedAt;

            if (timePassed < this.openStateDuration) {
                throw new Error("Circuit is Open");
            }
            this.currentState = "HalfOpen";
            this.halfOpenCalls = 0;
            this.halfOpenSuccesses = 0;
        }


        if (this.currentState === "HalfOpen") {

            if (this.halfOpenCalls >= this.halfOpenMaxCalls) {
                throw new Error("HalfOpen call limit reached");
            }

            this.halfOpenCalls++;
        }


        try {


            const result = await Promise.race([

                fn(),

                new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error("Timeout"));
                    }, this.timeoutPerCall);
                })

            ]);

            if (this.currentState === "Closed") {

                this.failureCount = 0;
            }


            if (this.currentState === "HalfOpen") {

                this.halfOpenSuccesses++;


                if (
                    this.halfOpenSuccesses >=
                    this.halfOpenMaxCalls
                ) {
                    this.currentState = "Closed";

                    this.failureCount = 0;
                    this.halfOpenCalls = 0;
                    this.halfOpenSuccesses = 0;
                }
            }


            return result;

        } catch (error) {


            if (this.currentState === "Closed") {

                this.failureCount++;

                if (
                    this.failureCount >=
                    this.failureThreshold
                ) {
                    this.currentState = "Open";
                    this.openedAt = Date.now();
                }
            }




            else if (this.currentState === "HalfOpen") {


                this.currentState = "Open";
                this.openedAt = Date.now();

                this.halfOpenCalls = 0;
                this.halfOpenSuccesses = 0;
            }


            throw error;
        }
    }
}
const breaker = new CircuitBreaker(3, 2, 5000, 2000);


async function successService() {
    return "Server works";
}


async function failureService() {
    throw new Error("Server error");
}


async function hangingService() {

    return new Promise((resolve) => {

        setTimeout(() => {
            resolve("Very slow response");
        }, 10000);

    });
}



function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}



async function main() {

    console.log("Початковий стан:");
    console.log(breaker.state());


    for (let i = 1; i <= 3; i++) {

        try {

            await breaker.call(failureService);

        } catch (error) {

            console.log(
                `Помилка ${i}:`,
                error.message
            );

        }
    }


    console.log(
        "Стан після 3 помилок:",
        breaker.state()
    );



    try {

        await breaker.call(successService);

    } catch (error) {

        console.log(
            "Виклик заблоковано:",
            error.message
        );
    }


    console.log("Чекаємо 5 секунд...");

    await sleep(5000);

    try {

        const result =
            await breaker.call(successService);

        console.log(
            "Перша перевірка:",
            result
        );

    } catch (error) {

        console.log(error.message);
    }


    console.log(
        "Стан:",
        breaker.state()
    );




    try {

        const result =
            await breaker.call(successService);

        console.log(
            "Друга перевірка:",
            result
        );

    } catch (error) {

        console.log(error.message);
    }


    console.log(
        "Кінцевий стан:",
        breaker.state()
    );
}


main();