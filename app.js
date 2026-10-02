"use strict";


/* =========================================================
   BINANCE MOMENTUM SCANNER
   Version: 1.0.5
   ========================================================= */


const APP_VERSION = "1.0.5";

const BINANCE_API =
  "https://api.binance.com/api/v3";


/* =========================================================
   DOM
   ========================================================= */

const enableDaily =
  document.getElementById("enableDaily");

const enableHourly =
  document.getElementById("enableHourly");

const dailyMin =
  document.getElementById("dailyMin");

const volumeMin =
  document.getElementById("volumeMin");

const hourlyMin =
  document.getElementById("hourlyMin");

const hourlyMinNote =
  document.getElementById("hourlyMinNote");

const maxResults =
  document.getElementById("maxResults");

const patternSection =
  document.getElementById("hourlyPatternSection");

const patternCandle4 =
  document.getElementById("patternCandle4");

const patternCandle3 =
  document.getElementById("patternCandle3");

const patternCandle2 =
  document.getElementById("patternCandle2");

const patternCandle1 =
  document.getElementById("patternCandle1");

const patternPreview =
  document.getElementById("patternPreview");

const startBtn =
  document.getElementById("startBtn");

const stopBtn =
  document.getElementById("stopBtn");

const exportBtn =
  document.getElementById("exportBtn");

const statusText =
  document.getElementById("statusText");

const statusDetail =
  document.getElementById("statusDetail");

const progressFill =
  document.getElementById("progressFill");

const progressPercent =
  document.getElementById("progressPercent");

const statSpotPairs =
  document.getElementById("statSpotPairs");

const statVolumeCandidates =
  document.getElementById("statVolumeCandidates");

const statMatched =
  document.getElementById("statMatched");

const statElapsed =
  document.getElementById("statElapsed");

const resultsHead =
  document.getElementById("resultsHead");

const resultsBody =
  document.getElementById("resultsBody");

const resultSummary =
  document.getElementById("resultSummary");


/* =========================================================
   STATE
   ========================================================= */

let isScanning = false;

let stopRequested = false;

let scanResults = [];

let scanStartTime = null;

let elapsedTimer = null;


/* =========================================================
   HELPERS
   ========================================================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}


function formatPercent(value) {

  if (!Number.isFinite(value)) {
    return "—";
  }

  const sign =
    value > 0
      ? "+"
      : "";

  return `${sign}${value.toFixed(2)}%`;
}


function formatVolume(value) {

  if (!Number.isFinite(value)) {
    return "—";
  }

  if (value >= 1_000_000_000) {
    return (
      (value / 1_000_000_000)
        .toFixed(2)
        .replace(/\.00$/, "") +
      "B"
    );
  }

  if (value >= 1_000_000) {
    return (
      (value / 1_000_000)
        .toFixed(2)
        .replace(/\.00$/, "") +
      "M"
    );
  }

  if (value >= 1_000) {
    return (
      (value / 1_000)
        .toFixed(2)
        .replace(/\.00$/, "") +
      "K"
    );
  }

  return value.toFixed(0);
}


function percentClass(value) {

  if (!Number.isFinite(value)) {
    return "neutral";
  }

  if (value > 0) {
    return "positive";
  }

  if (value < 0) {
    return "negative";
  }

  return "neutral";
}


function candleDirection(candle) {

  if (!candle) {
    return "neutral";
  }

  if (candle.green) {
    return "green";
  }

  if (candle.red) {
    return "red";
  }

  return "neutral";
}


function candleIcon(candle) {

  if (!candle) {
    return "⚪";
  }

  if (candle.green) {
    return "🟢";
  }

  if (candle.red) {
    return "🔴";
  }

  return "⚪";
}


function candleText(candle) {

  if (!candle) {
    return "—";
  }

  return formatPercent(candle.change);
}


/* =========================================================
   UI
   ========================================================= */

function setProgress(percent) {

  const safe = clamp(
    Number(percent) || 0,
    0,
    100
  );

  progressFill.style.width =
    `${safe}%`;

  progressPercent.textContent =
    `${Math.round(safe)}%`;
}


function setStatus(
  title,
  detail = ""
) {

  statusText.textContent = title;

  statusDetail.textContent = detail;
}


function updateElapsed() {

  if (!scanStartTime) {
    statElapsed.textContent = "0s";
    return;
  }

  const seconds =
    Math.floor(
      (Date.now() - scanStartTime) /
      1000
    );

  if (seconds < 60) {
    statElapsed.textContent =
      `${seconds}s`;
  } else {

    const minutes =
      Math.floor(seconds / 60);

    const remaining =
      seconds % 60;

    statElapsed.textContent =
      `${minutes}m ${remaining}s`;
  }
}


function startElapsedTimer() {

  stopElapsedTimer();

  elapsedTimer =
    setInterval(
      updateElapsed,
      500
    );
}


function stopElapsedTimer() {

  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}


/* =========================================================
   PATTERN UI
   ========================================================= */

function getSelectedPattern() {

  return [
    patternCandle4.value,
    patternCandle3.value,
    patternCandle2.value,
    patternCandle1.value
  ];
}


function patternEmoji(value) {

  if (value === "red") {
    return "🔴";
  }

  if (value === "green") {
    return "🟢";
  }

  return "⚪";
}


function updatePatternPreview() {

  const pattern =
    getSelectedPattern();

  patternPreview.textContent =
    pattern
      .map(patternEmoji)
      .join(" → ");
}


function updateHourlyUI() {

  const enabled =
    enableHourly.checked;

  if (enabled) {

    patternSection.classList.remove(
      "disabled-section"
    );

    hourlyMin.disabled = false;

    hourlyMinNote.textContent =
      "Applied only when the actual last completed 1H candle is green.";

  } else {

    patternSection.classList.add(
      "disabled-section"
    );

    hourlyMin.disabled = true;

    hourlyMinNote.textContent =
      "1H condition is disabled.";
  }

  updatePatternPreview();
}


enableHourly.addEventListener(
  "change",
  updateHourlyUI
);


patternCandle4.addEventListener(
  "change",
  updatePatternPreview
);

patternCandle3.addEventListener(
  "change",
  updatePatternPreview
);

patternCandle2.addEventListener(
  "change",
  updatePatternPreview
);

patternCandle1.addEventListener(
  "change",
  updatePatternPreview
);


/* =========================================================
   BINANCE REQUEST
   ========================================================= */

async function binanceRequest(
  endpoint,
  params = {},
  retries = 3
) {

  const url =
    new URL(
      `${BINANCE_API}/${endpoint}`
    );

  Object.entries(params)
    .forEach(([key, value]) => {
      url.searchParams.set(
        key,
        value
      );
    });


  let lastError = null;


  for (
    let attempt = 0;
    attempt < retries;
    attempt++
  ) {

    try {

      const response =
        await fetch(
          url.toString(),
          {
            method: "GET",
            cache: "no-store"
          }
        );


      if (!response.ok) {

        const text =
          await response.text();

        throw new Error(
          `HTTP ${response.status}: ${text}`
        );
      }


      return await response.json();

    } catch (error) {

      lastError = error;

      if (
        attempt <
        retries - 1
      ) {

        await sleep(
          500 * (attempt + 1)
        );
      }
    }
  }


  throw lastError ||
    new Error(
      "Binance request failed."
    );
}


/* =========================================================
   SPOT VERIFICATION
   ========================================================= */

function containsSpotPermission(
  symbolInfo
) {

  const values = [];


  if (
    Array.isArray(
      symbolInfo.permissions
    )
  ) {

    values.push(
      ...symbolInfo.permissions
    );
  }


  if (
    Array.isArray(
      symbolInfo.permissionSets
    )
  ) {

    for (
      const set
      of symbolInfo.permissionSets
    ) {

      if (
        Array.isArray(set)
      ) {

        values.push(...set);
      }
    }
  }


  if (
    Array.isArray(
      symbolInfo.allowedPermissions
    )
  ) {

    values.push(
      ...symbolInfo.allowedPermissions
    );
  }


  return values.some(
    permission =>
      String(permission)
        .toUpperCase() ===
      "SPOT"
  );
}


function isVerifiedSpotSymbol(
  symbolInfo
) {

  if (!symbolInfo) {
    return false;
  }


  if (
    symbolInfo.status !==
    "TRADING"
  ) {
    return false;
  }


  if (
    symbolInfo.quoteAsset !==
    "USDT"
  ) {
    return false;
  }


  if (
    symbolInfo.isSpotTradingAllowed ===
    true
  ) {

    return true;
  }


  if (
    symbolInfo.spotTradingAllowed ===
    true
  ) {

    return true;
  }


  if (
    containsSpotPermission(
      symbolInfo
    )
  ) {

    return true;
  }


  return false;
}


/* =========================================================
   GET SPOT SYMBOLS
   ========================================================= */

async function getSpotSymbols() {

  const data =
    await binanceRequest(
      "exchangeInfo"
    );


  if (
    !data ||
    !Array.isArray(data.symbols)
  ) {

    throw new Error(
      "Invalid exchangeInfo response."
    );
  }


  const symbols =
    data.symbols
      .filter(
        isVerifiedSpotSymbol
      )
      .map(symbol => ({
        symbol: symbol.symbol,
        baseAsset:
          symbol.baseAsset,
        quoteAsset:
          symbol.quoteAsset
      }));


  return symbols;
}


/* =========================================================
   24H TICKERS
   ========================================================= */

async function getAll24hTickers() {

  const data =
    await binanceRequest(
      "ticker/24hr"
    );


  if (!Array.isArray(data)) {

    throw new Error(
      "Invalid 24H ticker response."
    );
  }


  return data;
}


/* =========================================================
   KLINES
   ========================================================= */

async function getKlines(
  symbol,
  interval,
  limit = 8
) {

  return await binanceRequest(
    "klines",
    {
      symbol,
      interval,
      limit
    }
  );
}


/* =========================================================
   COMPLETED KLINES
   ========================================================= */

function getCompletedKlines(
  klines
) {

  const now =
    Date.now();


  return klines.filter(
    candle =>
      Number(candle[6]) <
      now
  );
}


/* =========================================================
   DAILY ANALYSIS
   ========================================================= */

async function analyzeDailyCandle(
  symbol
) {

  const klines =
    await getKlines(
      symbol,
      "1d",
      3
    );


  const completed =
    getCompletedKlines(
      klines
    );


  if (
    completed.length < 1
  ) {

    return null;
  }


  const candle =
    completed[
      completed.length - 1
    ];


  const open =
    Number(candle[1]);

  const close =
    Number(candle[4]);


  if (
    !Number.isFinite(open) ||
    open <= 0 ||
    !Number.isFinite(close)
  ) {

    return null;
  }


  const change =
    ((close - open) / open) *
    100;


  return {
    open,
    close,
    change,

    green:
      close > open,

    red:
      close < open,

    timestamp:
      Number(candle[0]),

    closeTime:
      Number(candle[6])
  };
}


/* =========================================================
   1H ANALYSIS
   ========================================================= */

async function analyzeHourlyCandle(
  symbol,
  selectedPattern
) {

  const klines =
    await getKlines(
      symbol,
      "1h",
      8
    );


  const completed =
    getCompletedKlines(
      klines
    );


  if (
    completed.length < 4
  ) {

    return null;
  }


  /*
    Exactly the latest four
    completed 1H candles.
  */

  const candles =
    completed.slice(-4);


  const analyzed =
    candles.map(
      candle => {

        const open =
          Number(candle[1]);

        const close =
          Number(candle[4]);


        if (
          !Number.isFinite(open) ||
          open <= 0 ||
          !Number.isFinite(close)
        ) {

          return null;
        }


        const change =
          ((close - open) /
            open) *
          100;


        return {

          open,

          close,

          change,

          red:
            close < open,

          green:
            close > open,

          timestamp:
            Number(candle[0]),

          closeTime:
            Number(candle[6])
        };
      }
    );


  if (
    analyzed.some(
      item => item === null
    )
  ) {

    return null;
  }


  /*
    Check user-selected
    pattern.
  */

  for (
    let i = 0;
    i < 4;
    i++
  ) {

    const required =
      selectedPattern[i];

    const actual =
      analyzed[i];


    if (
      required === "red" &&
      !actual.red
    ) {

      return null;
    }


    if (
      required === "green" &&
      !actual.green
    ) {

      return null;
    }

    /*
      "any" means no
      direction restriction.
    */
  }


  const lastCandle =
    analyzed[3];


  /*
    Minimum percentage is
    applied only if the
    actual last candle is green.
  */

  if (
    lastCandle.green
  ) {

    const minimum =
      Number(
        hourlyMin.value
      );


    if (
      Number.isFinite(
        minimum
      ) &&
      lastCandle.change <
      minimum
    ) {

      return null;
    }
  }


  return {

    candles:
      analyzed,

    pattern:
      selectedPattern,

    lastChange:
      lastCandle.change,

    lastGreen:
      lastCandle.green
  };
}


/* =========================================================
   15M ANALYSIS
   DISPLAY ONLY
   ========================================================= */

async function analyze15mCandles(
  symbol
) {

  const klines =
    await getKlines(
      symbol,
      "15m",
      8
    );


  const completed =
    getCompletedKlines(
      klines
    );


  if (
    completed.length < 4
  ) {

    return null;
  }


  /*
    Latest four completed
    15 minute candles.
  */

  const candles =
    completed.slice(-4);


  const analyzed =
    candles.map(
      candle => {

        const open =
          Number(candle[1]);

        const close =
          Number(candle[4]);


        if (
          !Number.isFinite(open) ||
          open <= 0 ||
          !Number.isFinite(close)
        ) {

          return null;
        }


        const change =
          ((close - open) /
            open) *
          100;


        return {

          open,

          close,

          change,

          red:
            close < open,

          green:
            close > open,

          timestamp:
            Number(candle[0]),

          closeTime:
            Number(candle[6])
        };
      }
    );


  if (
    analyzed.some(
      item => item === null
    )
  ) {

    return null;
  }


  return {
    candles:
      analyzed
  };
}


/* =========================================================
   CONCURRENCY
   ========================================================= */

async function runWithConcurrency(
  items,
  worker,
  concurrency,
  onProgress
) {

  const results =
    new Array(
      items.length
    );


  let nextIndex = 0;

  let completed = 0;


  async function runner() {

    while (true) {

      if (stopRequested) {
        return;
      }


      const index =
        nextIndex++;


      if (
        index >=
        items.length
      ) {

        return;
      }


      try {

        results[index] =
          await worker(
            items[index],
            index
          );

      } catch (error) {

        console.warn(
          "Worker error:",
          error
        );

        results[index] =
          null;
      }


      completed++;


      if (onProgress) {

        onProgress(
          completed,
          items.length
        );
      }
    }
  }


  const workers = [];


  const count =
    Math.min(
      concurrency,
      Math.max(
        items.length,
        1
      )
    );


  for (
    let i = 0;
    i < count;
    i++
  ) {

    workers.push(
      runner()
    );
  }


  await Promise.all(
    workers
  );


  return results;
}


/* =========================================================
   BUILD VOLUME CANDIDATES
   ========================================================= */

function buildVolumeCandidates(
  spotSymbols,
  tickers
) {

  const minVolume =
    Number(
      volumeMin.value
    );


  const tickerMap =
    new Map();


  for (
    const ticker
    of tickers
  ) {

    tickerMap.set(
      ticker.symbol,
      ticker
    );
  }


  const candidates = [];


  for (
    const symbolInfo
    of spotSymbols
  ) {

    const ticker =
      tickerMap.get(
        symbolInfo.symbol
      );


    if (!ticker) {
      continue;
    }


    const quoteVolume =
      Number(
        ticker.quoteVolume
      );


    if (
      !Number.isFinite(
        quoteVolume
      )
    ) {

      continue;
    }


    if (
      quoteVolume <
      minVolume
    ) {

      continue;
    }


    const priceChange =
      Number(
        ticker.priceChangePercent
      );


    candidates.push({

      symbol:
        symbolInfo.symbol,

      quoteVolume,

      tickerPriceChange:
        priceChange

    });
  }


  return candidates;
}


/* =========================================================
   DAILY FILTER
   ========================================================= */

async function scanDailyCandidates(
  candidates
) {

  if (
    !enableDaily.checked
  ) {

    /*
      No 1D API calls when
      disabled.
    */

    return candidates.map(
      item => ({
        ...item,
        daily: null
      })
    );
  }


  const minimum =
    Number(
      dailyMin.value
    );


  setStatus(
    "Checking 1D candles",
    `Analyzing ${candidates.length} volume-qualified pairs...`
  );


  const analyzed =
    await runWithConcurrency(
      candidates,

      async item => {

        const daily =
          await analyzeDailyCandle(
            item.symbol
          );


        if (!daily) {
          return null;
        }


        if (
          !daily.green
        ) {

          return null;
        }


        if (
          Number.isFinite(
            minimum
          ) &&
          daily.change <
          minimum
        ) {

          return null;
        }


        return {
          ...item,
          daily
        };
      },

      8,

      (completed, total) => {

        const percent =
          total > 0
            ? (completed / total) *
              40
            : 40;


        setProgress(
          percent
        );


        setStatus(
          "Checking 1D candles",
          `${completed} / ${total} analyzed`
        );
      }
    );


  return analyzed.filter(
    Boolean
  );
}


/* =========================================================
   HOURLY + 15M
   ========================================================= */

async function scanHourlyCandidates(
  candidates
) {

  const pattern =
    getSelectedPattern();


  /*
    1H disabled:
    still fetch 15M because
    15M is display-only.
  */

  if (
    !enableHourly.checked
  ) {

    setStatus(
      "Loading 15M candles",
      `Preparing display data for ${candidates.length} pairs...`
    );


    const analyzed =
      await runWithConcurrency(
        candidates,

        async item => {

          const fifteen =
            await analyze15mCandles(
              item.symbol
            );


          return {
            ...item,

            hourly: null,

            fifteen
          };
        },

        8,

        (completed, total) => {

          const percent =
            total > 0
              ? (completed / total) *
                100
              : 100;


          setProgress(
            percent
          );


          setStatus(
            "Loading 15M candles",
            `${completed} / ${total} analyzed`
          );
        }
      );


    return analyzed.filter(
      Boolean
    );
  }


  /*
    1H enabled:
    first filter using 1H,
    then fetch 15M only for
    matched 1H candidates.
  */

  setStatus(
    "Checking 1H patterns",
    `Analyzing ${candidates.length} candidates...`
  );


  const hourlyAnalyzed =
    await runWithConcurrency(
      candidates,

      async item => {

        const hourly =
          await analyzeHourlyCandle(
            item.symbol,
            pattern
          );


        if (!hourly) {
          return null;
        }


        return {
          ...item,
          hourly
        };
      },

      8,

      (completed, total) => {

        const percent =
          total > 0
            ? (completed / total) *
              50
            : 50;


        setProgress(
          percent
        );


        setStatus(
          "Checking 1H patterns",
          `${completed} / ${total} analyzed`
        );
      }
    );


  const hourlyMatches =
    hourlyAnalyzed.filter(
      Boolean
    );


  if (
    stopRequested
  ) {

    return [];
  }


  /*
    Sort before 15M so we
    only request 15M for
    candidates that can appear.
  */

  hourlyMatches.sort(
    (a, b) => {

      const aValue =
        Number.isFinite(
          a.daily?.change
        )
          ? a.daily.change
          : a.tickerPriceChange;


      const bValue =
        Number.isFinite(
          b.daily?.change
        )
          ? b.daily.change
          : b.tickerPriceChange;


      if (
        Number.isFinite(aValue) &&
        Number.isFinite(bValue)
      ) {

        return bValue - aValue;
      }


      return (
        b.quoteVolume -
        a.quoteVolume
      );
    }
  );


  setStatus(
    "Loading 15M candles",
    `Fetching display data for ${hourlyMatches.length} matches...`
  );


  const with15m =
    await runWithConcurrency(
      hourlyMatches,

      async item => {

        const fifteen =
          await analyze15mCandles(
            item.symbol
          );


        return {
          ...item,
          fifteen
        };
      },

      8,

      (completed, total) => {

        const percent =
          total > 0
            ? 50 +
              (completed / total) *
                50
            : 100;


        setProgress(
          percent
        );


        setStatus(
          "Loading 15M candles",
          `${completed} / ${total} analyzed`
        );
      }
    );


  return with15m.filter(
    Boolean
  );
}


/* =========================================================
   TABLE HEADER
   ========================================================= */

function updateTableHeader() {

  let html = `
    <tr>
      <th>#</th>
      <th>Symbol</th>
      <th>${enableDaily.checked ? "1D %" : "24H %"}</th>
      <th>24H Volume</th>
  `;


  if (
    enableHourly.checked
  ) {

    html += `
      <th>1H -4</th>
      <th>1H -3</th>
      <th>1H -2</th>
      <th>1H Last</th>
    `;
  }


  /*
    15M is always shown.
  */

  html += `
      <th>15M -4</th>
      <th>15M -3</th>
      <th>15M -2</th>
      <th>15M Last</th>
    </tr>
  `;


  resultsHead.innerHTML =
    html;
}


/* =========================================================
   RENDER CANDLE
   ========================================================= */

function renderCandle(
  candle
) {

  if (!candle) {

    return `
      <td class="neutral">
        —
      </td>
    `;
  }


  const cls =
    percentClass(
      candle.change
    );


  return `
    <td class="candle-cell ${cls}">
      <span class="candle-icon">
        ${candleIcon(candle)}
      </span>
      ${candleText(candle)}
    </td>
  `;
}


/* =========================================================
   RENDER RESULTS
   ========================================================= */

function renderResults(
  results
) {

  updateTableHeader();


  if (
    !results ||
    results.length === 0
  ) {

    const colspan =
      enableHourly.checked
        ? 12
        : 8;


    resultsBody.innerHTML = `
      <tr>
        <td
          colspan="${colspan}"
          class="empty-state"
        >
          No matching symbols found.
        </td>
      </tr>
    `;


    resultSummary.textContent =
      "No matching symbols found.";

    return;
  }


  const rows =
    results.map(
      (item, index) => {

        const dailyChange =
          enableDaily.checked &&
          item.daily
            ? item.daily.change
            : item.tickerPriceChange;


        const dailyClass =
          percentClass(
            dailyChange
          );


        let html = `
          <tr>

            <td>
              ${index + 1}
            </td>

            <td class="symbol">
              ${item.symbol}
            </td>

            <td class="${dailyClass}">
              ${formatPercent(dailyChange)}
            </td>

            <td>
              ${formatVolume(
                item.quoteVolume
              )}
            </td>
        `;


        /*
          1H columns.
        */

        if (
          enableHourly.checked
        ) {

          const candles =
            item.hourly?.candles ||
            [];


          html +=
            renderCandle(
              candles[0]
            );

          html +=
            renderCandle(
              candles[1]
            );

          html +=
            renderCandle(
              candles[2]
            );

          html +=
            renderCandle(
              candles[3]
            );
        }


        /*
          15M columns.
        */

        const fifteen =
          item.fifteen?.candles ||
          [];


        html +=
          renderCandle(
            fifteen[0]
          );

        html +=
          renderCandle(
            fifteen[1]
          );

        html +=
          renderCandle(
            fifteen[2]
          );

        html +=
          renderCandle(
            fifteen[3]
          );


        html += `
          </tr>
        `;


        return html;
      }
    );


  resultsBody.innerHTML =
    rows.join("");


  resultSummary.textContent =
    `${results.length} matching pair${results.length === 1 ? "" : "s"} found.`;
}


/* =========================================================
   SORT RESULTS
   ========================================================= */

function sortResults(
  results
) {

  return results.sort(
    (a, b) => {

      const aValue =
        enableDaily.checked &&
        Number.isFinite(
          a.daily?.change
        )
          ? a.daily.change
          : a.tickerPriceChange;


      const bValue =
        enableDaily.checked &&
        Number.isFinite(
          b.daily?.change
        )
          ? b.daily.change
          : b.tickerPriceChange;


      if (
        Number.isFinite(aValue) &&
        Number.isFinite(bValue)
      ) {

        return bValue - aValue;
      }


      return (
        b.quoteVolume -
        a.quoteVolume
      );
    }
  );
}


/* =========================================================
   START SCAN
   ========================================================= */

async function startScan() {

  if (isScanning) {
    return;
  }


  isScanning = true;

  stopRequested = false;

  scanResults = [];

  scanStartTime =
    Date.now();


  startElapsedTimer();


  startBtn.disabled = true;

  stopBtn.disabled = false;

  exportBtn.disabled = true;


  setProgress(0);


  statSpotPairs.textContent =
    "0";

  statVolumeCandidates.textContent =
    "0";

  statMatched.textContent =
    "0";


  resultSummary.textContent =
    "Scanning...";


  resultsBody.innerHTML = `
    <tr>
      <td
        colspan="${enableHourly.checked ? 12 : 8}"
        class="empty-state"
      >
        Scanning Binance Spot markets...
      </td>
    </tr>
  `;


  updateTableHeader();


  try {

    /* -----------------------------------------
       STEP 1
       ----------------------------------------- */

    setStatus(
      "Loading Binance Spot markets",
      "Verifying USDT Spot trading pairs..."
    );


    const spotSymbols =
      await getSpotSymbols();


    if (stopRequested) {
      finishScan(true);
      return;
    }


    statSpotPairs.textContent =
      spotSymbols.length.toLocaleString();


    setProgress(5);


    /* -----------------------------------------
       STEP 2
       ----------------------------------------- */

    setStatus(
      "Loading 24H market data",
      "Getting Binance 24H ticker information..."
    );


    const tickers =
      await getAll24hTickers();


    if (stopRequested) {
      finishScan(true);
      return;
    }


    const candidates =
      buildVolumeCandidates(
        spotSymbols,
        tickers
      );


    statVolumeCandidates.textContent =
      candidates.length.toLocaleString();


    setProgress(10);


    /* -----------------------------------------
       STEP 3
       ----------------------------------------- */

    const dailyCandidates =
      await scanDailyCandidates(
        candidates
      );


    if (stopRequested) {
      finishScan(true);
      return;
    }


    /* -----------------------------------------
       STEP 4
       ----------------------------------------- */

    const finalCandidates =
      await scanHourlyCandidates(
        dailyCandidates
      );


    if (stopRequested) {
      finishScan(true);
      return;
    }


    /* -----------------------------------------
       STEP 5
       ----------------------------------------- */

    scanResults =
      sortResults(
        finalCandidates
      );


    const limit =
      clamp(
        parseInt(
          maxResults.value,
          10
        ) || 50,
        1,
        500
      );


    scanResults =
      scanResults.slice(
        0,
        limit
      );


    statMatched.textContent =
      scanResults.length.toLocaleString();


    setProgress(100);


    renderResults(
      scanResults
    );


    finishScan(false);

  } catch (error) {

    console.error(error);


    setStatus(
      "Scan failed",
      error?.message ||
        "An unexpected error occurred."
    );


    resultSummary.textContent =
      "Scan failed. Check the browser console for details.";


    resultsBody.innerHTML = `
      <tr>
        <td
          colspan="${enableHourly.checked ? 12 : 8}"
          class="empty-state"
        >
          ${escapeHtml(
            error?.message ||
            "Unable to complete scan."
          )}
        </td>
      </tr>
    `;


    finishScan(true);
  }
}


/* =========================================================
   FINISH SCAN
   ========================================================= */

function finishScan(
  stopped = false
) {

  isScanning = false;

  stopElapsedTimer();

  updateElapsed();


  startBtn.disabled = false;

  stopBtn.disabled = true;


  exportBtn.disabled =
    scanResults.length === 0;


  if (stopped) {

    setStatus(
      "Scan stopped",
      "The scan was stopped by the user."
    );

    return;
  }


  setStatus(
    "Scanning complete",
    `${scanResults.length} result${scanResults.length === 1 ? "" : "s"} found.`
  );
}


/* =========================================================
   STOP SCAN
   ========================================================= */

function stopScan() {

  if (!isScanning) {
    return;
  }


  stopRequested = true;


  setStatus(
    "Stopping scan",
    "Waiting for active requests to finish..."
  );


  stopBtn.disabled = true;
}


/* =========================================================
   HTML ESCAPE
   ========================================================= */

function escapeHtml(
  value
) {

  return String(value)
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}


/* =========================================================
   CSV
   ========================================================= */

function csvEscape(
  value
) {

  const stringValue =
    String(
      value ?? ""
    );


  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {

    return `"${stringValue.replace(
      /"/g,
      '""'
    )}"`;
  }


  return stringValue;
}


function candleCsvValue(
  candle
) {

  if (!candle) {
    return "";
  }


  const direction =
    candle.green
      ? "Green"
      : candle.red
        ? "Red"
        : "Neutral";


  return `${direction} ${formatPercent(
    candle.change
  )}`;
}


function exportCSV() {

  if (
    !scanResults.length
  ) {

    return;
  }


  const headers = [
    "Rank",
    "Symbol",
    enableDaily.checked
      ? "1D Change %"
      : "24H Change %",
    "24H Quote Volume"
  ];


  if (
    enableHourly.checked
  ) {

    headers.push(
      "1H -4",
      "1H -3",
      "1H -2",
      "1H Last"
    );
  }


  headers.push(
    "15M -4",
    "15M -3",
    "15M -2",
    "15M Last"
  );


  const rows = [
    headers
  ];


  for (
    let i = 0;
    i < scanResults.length;
    i++
  ) {

    const item =
      scanResults[i];


    const dailyChange =
      enableDaily.checked &&
      item.daily
        ? item.daily.change
        : item.tickerPriceChange;


    const row = [

      i + 1,

      item.symbol,

      formatPercent(
        dailyChange
      ),

      item.quoteVolume

    ];


    if (
      enableHourly.checked
    ) {

      const candles =
        item.hourly?.candles ||
        [];


      row.push(
        candleCsvValue(
          candles[0]
        )
      );

      row.push(
        candleCsvValue(
          candles[1]
        )
      );

      row.push(
        candleCsvValue(
          candles[2]
        )
      );

      row.push(
        candleCsvValue(
          candles[3]
        )
      );
    }


    const fifteen =
      item.fifteen?.candles ||
      [];


    row.push(
      candleCsvValue(
        fifteen[0]
      )
    );

    row.push(
      candleCsvValue(
        fifteen[1]
      )
    );

    row.push(
      candleCsvValue(
        fifteen[2]
      )
    );

    row.push(
      candleCsvValue(
        fifteen[3]
      ));


    rows.push(row);
  }


  const csv =
    rows
      .map(
        row =>
          row
            .map(csvEscape)
            .join(",")
      )
      .join("\n");


  const blob =
    new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8;"
      }
    );


  const url =
    URL.createObjectURL(
      blob
    );


  const link =
    document.createElement(
      "a"
    );


  const date =
    new Date()
      .toISOString()
      .slice(0, 10);


  link.href = url;

  link.download =
    `binance-momentum-scan-${date}.csv`;


  document.body.appendChild(
    link
  );

  link.click();

  link.remove();


  URL.revokeObjectURL(
    url
  );
}


/* =========================================================
   EVENTS
   ========================================================= */

startBtn.addEventListener(
  "click",
  startScan
);


stopBtn.addEventListener(
  "click",
  stopScan
);


exportBtn.addEventListener(
  "click",
  exportCSV
);


/* =========================================================
   INITIALIZE
   ========================================================= */

updateHourlyUI();

updatePatternPreview();

updateTableHeader();

setProgress(0);

setStatus(
  "Ready to scan",
  "Configure the scanner and press Start Scan."
);