const API = "https://api.binance.com";

let stopped = false;
let results = [];

const $ = (id) => document.getElementById(id);

async function getJSON(path, params = {}) {
  const url = new URL(API + path);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    try {
      const error = await response.json();
      if (error.msg) message += `: ${error.msg}`;
    } catch (_) {}

    throw new Error(message);
  }

  return response.json();
}

/*
========================================================
STRICT BINANCE SPOT FILTER
========================================================

A symbol is accepted ONLY when:

1. status = TRADING
2. quoteAsset = USDT
3. Binance explicitly reports SPOT permission

If Spot permission is missing, the symbol is rejected.
There is NO fallback.
*/

function isExplicitSpot(symbol) {
  // Older Binance exchangeInfo format
  if (
    Array.isArray(symbol.permissions) &&
    symbol.permissions.includes("SPOT")
  ) {
    return true;
  }

  // Current/alternate format
  if (
    Array.isArray(symbol.permissionsSets) &&
    symbol.permissionsSets.some(
      (set) => Array.isArray(set) && set.includes("SPOT")
    )
  ) {
    return true;
  }

  // Legacy alternate spelling
  if (
    Array.isArray(symbol.permissionSets) &&
    symbol.permissionSets.some(
      (set) => Array.isArray(set) && set.includes("SPOT")
    )
  ) {
    return true;
  }

  // IMPORTANT:
  // Missing Spot permission = REJECT
  return false;
}

/*
========================================================
GET ONLY BINANCE SPOT USDT PAIRS
========================================================
*/

async function getSpotUSDT() {
  const exchangeInfo = await getJSON("/api/v3/exchangeInfo");

  const allSymbols = exchangeInfo.symbols || [];

  let tradingCount = 0;
  let usdtCount = 0;
  let spotCount = 0;

  const symbols = [];

  for (const symbol of allSymbols) {
    // Must be actively trading
    if (symbol.status !== "TRADING") {
      continue;
    }

    tradingCount++;

    // Must have USDT as quote asset
    if (symbol.quoteAsset !== "USDT") {
      continue;
    }

    usdtCount++;

    // MUST explicitly be Spot
    if (!isExplicitSpot(symbol)) {
      continue;
    }

    spotCount++;

    symbols.push(symbol.symbol);
  }

  return {
    symbols,
    stats: {
      total: allSymbols.length,
      trading: tradingCount,
      usdt: usdtCount,
      spot: spotCount
    }
  };
}

/*
========================================================
24H TICKER
========================================================
*/

async function getTickerMap() {
  const tickers = await getJSON("/api/v3/ticker/24hr");

  const map = new Map();

  for (const ticker of tickers) {
    map.set(
      ticker.symbol,
      Number(ticker.quoteVolume || 0)
    );
  }

  return map;
}

/*
========================================================
CANDLE HELPERS
========================================================
*/

function removeIncompleteCandles(candles) {
  const now = Date.now();

  return candles.filter(
    (candle) => Number(candle[6]) <= now
  );
}

function candleIsGreen(candle) {
  return Number(candle[4]) > Number(candle[1]);
}

function candleIsRed(candle) {
  return Number(candle[4]) < Number(candle[1]);
}

function candlePercentage(candle) {
  const open = Number(candle[1]);
  const close = Number(candle[4]);

  if (!open) return 0;

  return ((close - open) / open) * 100;
}

/*
========================================================
GET CANDLES
========================================================
*/

async function getCandles(symbol, interval, limit) {
  const candles = await getJSON(
    "/api/v3/klines",
    {
      symbol,
      interval,
      limit
    }
  );

  return removeIncompleteCandles(candles);
}

/*
========================================================
PROGRESS
========================================================
*/

function setProgress(percent, message) {
  const bar = $("bar");

  if (bar) {
    bar.style.width = `${Math.max(
      0,
      Math.min(100, percent)
    )}%`;
  }

  const progress = $("progress");

  if (progress) {
    progress.textContent = message;
  }
}

/*
========================================================
FORMAT
========================================================
*/

function formatPercent(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatVolume(value) {
  if (value >= 1e9) {
    return `$${(value / 1e9).toFixed(2)}B`;
  }

  if (value >= 1e6) {
    return `$${(value / 1e6).toFixed(2)}M`;
  }

  if (value >= 1e3) {
    return `$${(value / 1e3).toFixed(1)}K`;
  }

  return `$${value.toFixed(0)}`;
}

/*
========================================================
MAIN SCANNER
========================================================
*/

async function scan() {
  stopped = false;

  $("scan").disabled = true;
  $("stop").disabled = false;
  $("export").disabled = true;

  $("status").textContent = "Scanning…";

  try {
    const dailyMinimum =
      Number($("dailyMin").value);

    const volumeMinimum =
      Number($("volumeMin").value);

    const hourlyMinimum =
      Number($("hourMin").value);

    const maximumResults =
      Math.max(
        1,
        Math.min(
          100,
          Number($("maxResults").value) || 20
        )
      );

    /*
    --------------------------------------------
    STEP 1
    Get STRICT Spot USDT universe
    --------------------------------------------
    */

    const [
      spotData,
      tickerMap
    ] = await Promise.all([
      getSpotUSDT(),
      getTickerMap()
    ]);

    const symbols = spotData.symbols;
    const stats = spotData.stats;

    $("all").textContent = stats.total;
    $("spot").textContent = stats.spot;

    setProgress(
      0,
      `Strict Spot filter: ${stats.spot} active Binance Spot USDT pairs found.`
    );

    /*
    --------------------------------------------
    STEP 2
    DAILY FILTER
    --------------------------------------------
    */

    const dailyCandidates = [];

    let completed = 0;

    const queue = [...symbols];

    async function dailyWorker() {
      while (queue.length && !stopped) {
        const symbol = queue.shift();

        try {
          const candles =
            await getCandles(
              symbol,
              "1d",
              2
            );

          if (!candles.length) {
            continue;
          }

          const latest =
            candles[candles.length - 1];

          const dailyChange =
            candlePercentage(latest);

          const volume =
            tickerMap.get(symbol) || 0;

          /*
          Daily conditions:

          GREEN candle
          +
          >= configured percentage
          +
          >= configured volume
          */

          if (
            candleIsGreen(latest) &&
            dailyChange >= dailyMinimum &&
            volume >= volumeMinimum
          ) {
            dailyCandidates.push({
              symbol,
              daily: dailyChange,
              volume
            });
          }

        } catch (error) {
          console.warn(
            `Daily error: ${symbol}`,
            error
          );
        }

        completed++;

        if (
          completed % 5 === 0 ||
          completed === symbols.length
        ) {
          setProgress(
            (completed / symbols.length) * 100,
            `1D scan: ${completed}/${symbols.length} • Daily qualified: ${dailyCandidates.length}`
          );
        }
      }
    }

    /*
    Use multiple workers to speed up scanning
    */

    await Promise.all(
      Array.from(
        { length: 6 },
        dailyWorker
      )
    );

    $("daily").textContent =
      dailyCandidates.length;

    if (stopped) {
      $("status").textContent = "Stopped";
      return;
    }

    /*
    --------------------------------------------
    STEP 3
    1H PATTERN

    RED
    RED
    GREEN

    These are the latest COMPLETED
    1H candles.
    --------------------------------------------
    */

    const matches = [];

    completed = 0;

    const hourlyQueue =
      [...dailyCandidates];

    async function hourlyWorker() {
      while (
        hourlyQueue.length &&
        !stopped
      ) {
        const candidate =
          hourlyQueue.shift();

        try {
          const candles =
            await getCandles(
              candidate.symbol,
              "1h",
              5
            );

          if (candles.length < 3) {
            continue;
          }

          const red2 =
            candles[candles.length - 3];

          const red1 =
            candles[candles.length - 2];

          const green =
            candles[candles.length - 1];

          const red2Change =
            candlePercentage(red2);

          const red1Change =
            candlePercentage(red1);

          const greenChange =
            candlePercentage(green);

          /*
          EXACT PATTERN:

          🔴 RED
          🔴 RED
          🟢 GREEN
          */

          if (
            candleIsRed(red2) &&
            candleIsRed(red1) &&
            candleIsGreen(green) &&
            greenChange >= hourlyMinimum
          ) {
            matches.push({
              symbol: candidate.symbol,
              daily: candidate.daily,
              h2: red2Change,
              h1: red1Change,
              h0: greenChange,
              volume: candidate.volume
            });
          }

        } catch (error) {
          console.warn(
            `1H error: ${candidate.symbol}`,
            error
          );
        }

        completed++;

        if (
          completed % 2 === 0 ||
          completed === dailyCandidates.length
        ) {
          setProgress(
            (completed /
              Math.max(
                1,
                dailyCandidates.length
              )) * 100,
            `1H scan: ${completed}/${dailyCandidates.length} • Exact matches: ${matches.length}`
          );
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: 6 },
        hourlyWorker
      )
    );

    /*
    --------------------------------------------
    SORT
    --------------------------------------------
    */

    matches.sort(
      (a, b) =>
        b.daily - a.daily
    );

    results =
      matches.slice(
        0,
        maximumResults
      );

    /*
    --------------------------------------------
    RENDER
    --------------------------------------------
    */

    renderResults();

    $("matches").textContent =
      results.length;

    $("status").textContent =
      `${results.length} match${
        results.length === 1
          ? ""
          : "es"
      }`;

    setProgress(
      100,
      `Finished: ${stats.spot} strict Spot USDT pairs → ${dailyCandidates.length} daily qualified → ${matches.length} exact matches.`
    );

  } catch (error) {

    console.error(error);

    $("status").textContent =
      "Error";

    $("progress").textContent =
      error.message;

  } finally {

    $("scan").disabled = false;
    $("stop").disabled = true;
  }
}

/*
========================================================
RENDER RESULTS
========================================================
*/

function renderResults() {

  const rows =
    $("rows");

  if (!results.length) {

    rows.innerHTML = `
      <tr>
        <td colspan="9" class="empty">
          No Binance Spot USDT pair currently
          matches all conditions.
        </td>
      </tr>
    `;

    return;
  }

  rows.innerHTML =
    results
      .map(
        (r, index) => `
<tr>

<td>
  ${index + 1}
</td>

<td>
  <span class="coin">
    ${r.symbol}
  </span>
</td>

<td>
  <span class="spot">
    ✓ SPOT
  </span>
</td>

<td class="green">
  ${formatPercent(r.daily)}
</td>

<td class="red">
  ${formatPercent(r.h2)}
</td>

<td class="red">
  ${formatPercent(r.h1)}
</td>

<td class="green">
  ${formatPercent(r.h0)}
</td>

<td>
  ${formatVolume(r.volume)}
</td>

<td>
  <a
    class="chart"
    target="_blank"
    rel="noopener"
    href="https://www.binance.com/en/trade/${r.symbol}?type=spot"
  >
    Open ↗
  </a>
</td>

</tr>
`
      )
      .join("");

  $("export").disabled = false;
}

/*
========================================================
CSV EXPORT
========================================================
*/

function exportCSV() {

  if (!results.length) {
    return;
  }

  const data = [
    [
      "Rank",
      "Symbol",
      "Market",
      "1D %",
      "1H -2 %",
      "1H -1 %",
      "1H Last %",
      "24H Quote Volume"
    ]
  ];

  results.forEach(
    (r, index) => {

      data.push([
        index + 1,
        r.symbol,
        "BINANCE SPOT",
        r.daily.toFixed(4),
        r.h2.toFixed(4),
        r.h1.toFixed(4),
        r.h0.toFixed(4),
        r.volume.toFixed(2)
      ]);

    }
  );

  const csv =
    data
      .map(
        row =>
          row
            .map(
              value =>
                `"${String(value)
                  .replaceAll('"', '""')}"`
            )
            .join(",")
      )
      .join("\n");

  const blob =
    new Blob(
      [csv],
      { type: "text/csv" }
    );

  const link =
    document.createElement("a");

  link.href =
    URL.createObjectURL(blob);

  link.download =
    "binance-spot-scanner.csv";

  link.click();
}

/*
========================================================
BUTTONS
========================================================
*/

$("scan").onclick = scan;

$("stop").onclick = () => {
  stopped = true;
  $("status").textContent =
    "Stopping…";
};

$("export").onclick =
  exportCSV;