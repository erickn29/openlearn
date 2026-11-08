// Аккуратный HTTP-клиент для hh.ru.
//
// Три таймаута, все настраиваемые:
//   --timeout     на один запрос (по умолчанию 20 с);
//   --pause       пауза между запросами, 800–1500 мс, берётся случайно из
//                 диапазона, чтобы не долбить сайт ровным ритмом;
//   --max-seconds общий бюджет на сбор. Если вышли — сбор останавливается и
//                 сохраняет то, что успели, с флагом truncated.
//
// 429/5xx повторяем с нарастающей паузой. 403 и капчу не повторяем:
// это не «не повезло», а сигнал остановиться.

export class NetworkError extends Error {
  constructor(message, { status = null, code = "network" } = {}) {
    super(message);
    this.name = "NetworkError";
    this.status = status;
    this.code = code;
  }
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)));

export function randomPause(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.round(Math.random() * (hi - lo));
}

export function createClient({
  userAgent,
  timeout = 20000,
  pauseMin = 800,
  pauseMax = 1500,
  retries = 2,
  maxSeconds = 0,
  log = () => {},
} = {}) {
  const startedAt = Date.now();
  let lastRequestAt = 0;

  function budgetLeft() {
    if (!maxSeconds) return Infinity;
    return maxSeconds * 1000 - (Date.now() - startedAt);
  }

  // Держим минимальный интервал между запросами в диапазоне 800–1500 мс.
  async function throttle() {
    const wait = lastRequestAt === 0 ? 0 : randomPause(pauseMin, pauseMax) - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
  }

  async function once(url) {
    await throttle();
    lastRequestAt = Date.now();

    const left = budgetLeft();
    if (left <= 0) throw new NetworkError("исчерпан бюджет времени на сбор", { code: "budget" });
    const limit = Math.min(timeout, left);

    let response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          "Accept-Language": "ru-RU,ru;q=0.9",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(limit),
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new NetworkError(
        timedOut ? `таймаут ${Math.round(limit / 1000)} с: ${url}` : `сеть: ${error.message}`,
        { code: timedOut ? "timeout" : "network" },
      );
    }

    if (response.status === 404) {
      throw new NetworkError(`404: ${url}`, { status: 404, code: "not_found" });
    }
    if (response.status === 403) {
      throw new NetworkError(`403 — hh требует авторизацию или капчу: ${url}`, { status: 403, code: "forbidden" });
    }
    if (response.status === 429) {
      throw new NetworkError(`429 — слишком много запросов: ${url}`, { status: 429, code: "rate_limit" });
    }
    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}: ${url}`, { status: response.status, code: "http" });
    }

    const html = await response.text();
    // hh отдаёт страницу-заглушку «VPN мешает работе сайта» с 200 и без данных.
    if (html.includes("vpncheeck")) {
      throw new NetworkError(`hh заблокировал доступ (VPN/гео): ${url}`, { code: "blocked" });
    }
    return { html, status: response.status, url: response.url };
  }

  async function get(url) {
    let attempt = 0;
    let lastError;
    while (attempt <= retries) {
      try {
        return await once(url);
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
        lastError = error;
        const retryable = error.code === "timeout" || error.code === "network" || error.code === "http" || error.code === "rate_limit";
        if (!retryable || attempt === retries) throw error;
        const backoff = randomPause(pauseMin, pauseMax) * (attempt + 1);
        log(`  повтор ${attempt + 1}/${retries} через ${backoff} мс: ${error.code}`);
        await sleep(backoff);
        attempt += 1;
      }
    }
    throw lastError;
  }

  return { get, budgetLeft, elapsed: () => Date.now() - startedAt };
}
