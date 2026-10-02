"use strict";

/*
 * Binance Spot USDT Momentum Scanner
 * Version 1.0.5
 *
 * Conditions:
 *
 * 1. Binance Spot only
 * 2. USDT pairs only
 * 3. Optional 1D condition
 * 4. Optional 1H condition
 * 5. User-selectable color for each of the latest 4 completed 1H candles
 * 6. Minimum last green 1H percentage
 * 7. Minimum 24H quote volume
 * 8. Results sorted by 24H percentage when 1D is enabled
 * 9. Results sorted by volume when 1D is disabled
 */

const BINANCE_API = "https://api.binance.com/api/v3";

const VERSION = "1.0.5";

let isScanning = false;
let stopRequested = false;

let scanResults = [];

let elapsedTimer = null;
let scanStartTime = 0;


/* =========================================================
   DOM
========================================================= */

const $ = (id) => document.getElementById(id);

const startBtn = $("startBtn");
const stopBtn = $("stopBtn");
const exportBtn = $("exportBtn");

const enableDaily = $("enableDaily");
const enableHourly = $("enableHourly");

const dailyMin = $("dailyMin");
const volumeMin = $("volumeMin");
const hourlyMin = $("hourlyMin");
const maxResults = $("maxResults");

const patternCandle4 = $("patternCandle4");
const patternCandle3 = $("patternCandle3");
const patternCandle2 = $("patternCandle2");
const patternCandle1 = $("patternCandle1");

const patternSection = $("hourlyPatternSection");
const patternPreview = $("patternPreview");
const hourlyMinNote = $("hourlyMinNote");

const connectionStatus = $("connectionStatus");

const scanStatus = $("scanStatus");
const progressBar = $("progressBar");

const totalPairsEl = $("totalPairs");
const volumeCandidatesEl = $("volumeCandidates");
const matchedCountEl = $("matchedCount");
const elapsedTimeEl = $("elapsedTime");
const resultCountEl = $("resultCount");

const resultsHead = $("resultsHead");
const resultsBody = $("resultsBody");
const resultsDescription = $("resultsDescription");


/* =========================================================
   INITIALIZATION
========================================================= */

document.addEventListener("DOMContentLoaded", () => {

  updateConditionControls();
  updatePatternPreview();

  enableDaily.addEventListener("change", updateConditionControls);
  enableHourly.addEventListener("change", updateConditionControls);

  patternCandle4.addEventListener("change", updatePatternPreview);
  patternCandle3.addEventListener("change", updatePatternPreview);
  patternCandle2.addEventListener("change", updatePatternPreview);
  patternCandle1.addEventListener("change", updatePatternPreview);

  startBtn.addEventListener("click", startScan);
  stopBtn.addEventListener("click", stopScan);
  exportBtn.addEventListener("click", exportCSV);

});


/* =========================================================
   UI HELPERS
========================================================= */

function setStatus(text, type = "idle") {

  connectionStatus.textContent = text;

  connectionStatus.className = `status ${type}`;
}


function setProgress(value) {

  const safeValue = Math.max(
    0,
    Math.min(100, Number(value) || 0)
  );

  progressBar.style.width = `${safeValue}%`;
}


function setScanStatus(text) {
  scanStatus.textContent = text;
}


function formatNumber(value) {

  if (!Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0
  }).format(value);
}


function formatPercent(value) {

  if (!Number.isFinite(value)) {
    return "—";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}


function formatVolume(value) {

  if (!Number.isFinite(value)) {
    return "—";
  }

  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }

  return value.toFixed(0);
}


function formatElapsed(seconds) {

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}m ${remainingSeconds}s`;
}


function escapeHTML(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================================
   CONDITIONS
========================================================= */

function updateConditionControls() {

  dailyMin.disabled = !enableDaily.checked;

  patternSection.classList.toggle(
    "disabled",
    !enableHourly.checked
  );

  hourlyMin.disabled = !enableHourly.checked;

  updateHourlyMinimumState();

  updateTableHeader();

  updatePatternPreview();
}


function updateHourlyMinimumState() {

  const lastSelection = patternCandle1.value;

  if (!enableHourly.checked) {

    hourlyMinNote.textContent =
      "1H conditions are disabled.";

    return;
  }

  if (lastSelection === "red") {

    hourlyMin.disabled = true;

    hourlyMinNote.textContent =
      "Last candle is fixed to Red, so the green-candle minimum is not applied.";

    return;
  }

  hourlyMin.disabled = false;

  if (lastSelection === "green") {

    hourlyMinNote.textContent =
      "The minimum 1H % will be applied to the last completed candle.";

  } else {

    hourlyMinNote.textContent =
      "If the actual last candle is green, the minimum 1H % will be applied.";
  }
}


function updatePatternPreview() {

  const values = [
    patternCandle4.value,
    patternCandle3.value,
    patternCandle2.value,
    patternCandle1.value
  ];

  const icons = values.map((value) => {

    if (value === "red") {
      return "🔴";
    }

    if (value === "green") {
      return "🟢";
    }

    return "⚪";
  });

  patternPreview.textContent = icons.join(" → ");

  updateHourlyMinimumState();
}


function getSelectedPattern() {

  return [
    patternCandle4.value,
    patternCandle3.value,
    patternCandle2.value,
    patternCandle1.value
  ];
}


function patternLabel(value) {

  if (value === "red") {
    return "🔴 Red";
  }

  if (value === "green") {
    return "🟢 Green";
  }

  return "⚪ Any";
}


/* =========================================================
   BINANCE API
========================================================= */

async function binanceFetch(endpoint, params = {}) {

  const query = new URLSearchParams(params);

  const url =
    `${BINANCE_API}${endpoint}?${query.toString()}`;

  const response = await fetch(url);

  if (!response.ok) {

    throw new Error(
      `Binance API error ${response.status}`
    );
  }

  return response.json();
}


/* =========================================================
   SPOT SYMBOL VERIFICATION
========================================================= */

function containsSpotPermission(symbolInfo) {

  const values = [];

  if (Array.isArray(symbolInfo.permissions)) {
    values.push(...symbolInfo.permissions);
  }

  if (Array.isArray(symbolInfo.permissionSets)) {

    for (const set of symbolInfo.permissionSets) {

      if (Array.isArray(set)) {
        values.push(...set);
      }
    }
  }

  if (Array.isArray(symbolInfo.allowedPermissions)) {
    values.push(...symbolInfo.allowedPermissions);
  }

  return values.some(
    (permission) =>
      String(permission).toUpperCase() === "SPOT"
  );
}


function isVerifiedSpotSymbol(symbolInfo) {

  if (!symbolInfo) {
    return false;
  }

  if (symbolInfo.status !== "TRADING") {
    return false;
  }

  if (symbolInfo.quoteAsset !== "USDT") {
    return false;
  }

  /*
   * Binance has changed permission fields over time.
   * Positive verification is required.
   */

  if (symbolInfo.isSpotTradingAllowed === true) {
    return true;
  }

  if (symbolInfo.spotTradingAllowed === true) {
    return true;
  }

  if (containsSpotPermission(symbolInfo)) {
    return true;
  }

  return false;
}


async function getSpotSymbols() {

  const exchangeInfo =
    await binanceFetch("/exchangeInfo");

  return exchangeInfo.symbols.filter(
    isVerifiedSpotSymbol
  );
}


/* =========================================================
   24H TICKERS
========================================================= */

async function getAll24hTickers() {

  return binanceFetch("/ticker/24hr");
}


/* =========================================================
   KLINES
========================================================= */

async function getKlines(
  symbol,
  interval,
  limit = 10
) {

  return binanceFetch("/klines", {
    symbol,
    interval,
    limit
  });
}


/* =========================================================
   COMPLETED KLINES
========================================================= */

function getCompletedKlines(klines) {

  const now = Date.now();

  return klines.filter(
    (candle) =>
      Number(candle[6]) < now
  );
}


/* =========================================================
   DAILY ANALYSIS
========================================================= */

async function analyzeDailyCandle(symbol) {

  const klines = await getKlines(
    symbol,
    "1d",
    3
  );

  const completed =
    getCompletedKlines(klines);

  if (completed.length === 0) {
    return null;
  }

  const candle =
    completed[completed.length - 1];

  const open = Number(candle[1]);
  const close = Number(candle[4]);

  if (!Number.isFinite(open) || open <= 0) {
    return null;
  }

  const change =
    ((close - open) / open) * 100;

  return {
    change,
    green: close > open
  };
}


/* =========================================================
   HOURLY ANALYSIS
========================================================= */

async function analyzeHourlyCandle(
  symbol,
  selectedPattern
) {

  /*
   * Fetch enough candles to guarantee that
   * we can get the latest 4 COMPLETED candles.
   */

  const klines = await getKlines(
    symbol,
    "1h",
    8
  );

  const completed =
    getCompletedKlines(klines);

  if (completed.length < 4) {
    return null;
  }

  const candles =
    completed.slice(-4);

  const analyzed = candles.map((candle) => {

    const open = Number(candle[1]);
    const close = Number(candle[4]);

    if (!Number.isFinite(open) || open <= 0) {
      return null;
    }

    const change =
      ((close - open) / open) * 100;

    return {
      open,
      close,
      change,
      red: close < open,
      green: close > open,
      timestamp: Number(candle[0]),
      closeTime: Number(candle[6])
    };

  });

  if (analyzed.some((item) => item === null)) {
    return null;
  }

  /*
   * Match each selected position.
   *
   * selectedPattern order:
   *
   * [4th Last, 3rd Last, 2nd Last, Last]
   */

  for (let i = 0; i < 4; i++) {

    const required =
      selectedPattern[i];

    const actual =
      analyzed[i];

    if (required === "red" && !actual.red) {
      return null;
    }

    if (required === "green" && !actual.green) {
      return null;
    }

    /*
     * Any = automatically passes.
     */
  }

  /*
   * Minimum Last Green 1H %
   *
   * Apply it only when the actual latest candle
   * is green.
   *
   * If the selected last candle is Red, there is
   * no green last candle to which this condition
   * can logically apply.
   */

  const lastCandle =
    analyzed[3];

  if (lastCandle.green) {

    const minimum =
      Number(hourlyMin.value);

    if (
      Number.isFinite(minimum) &&
      lastCandle.change < minimum
    ) {
      return null;
    }
  }

  return {
    candles: analyzed,
    pattern: selectedPattern,
    lastChange: lastCandle.change,
    lastGreen: lastCandle.green
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

  const results = [];

  let nextIndex = 0;
  let completed = 0;

  async function runner() {

    while (true) {

      if (stopRequested) {
        return;
      }

      const index = nextIndex++;

      if (index >= items.length) {
        return;
      }

      const item = items[index];

      try {

        const result =
          await worker(item);

        if (result !== null && result !== undefined) {
          results.push(result);
        }

      } catch (error) {

        console.warn(
          "Worker failed:",
          item?.symbol || item,
          error
        );

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

  const workerCount =
    Math.min(
      Math.max(1, concurrency),
      items.length
    );

  const runners =
    Array.from(
      { length: workerCount },
      () => runner()
    );

  await Promise.all(runners);

  return results;
}


/* =========================================================
   VOLUME CANDIDATES
========================================================= */

function buildVolumeCandidates(
  symbols,
  tickers
) {

  const symbolMap =
    new Map(
      symbols.map(
        (symbol) => [symbol.symbol, symbol]
      )
    );

  const minimumVolume =
    Number(volumeMin.value);

  const candidates = [];

  for (const ticker of tickers) {

    const symbolInfo =
      symbolMap.get(ticker.symbol);

    if (!symbolInfo) {
      continue;
    }

    const quoteVolume =
      Number(ticker.quoteVolume);

    if (
      !Number.isFinite(quoteVolume) ||
      quoteVolume < minimumVolume
    ) {
      continue;
    }

    const priceChangePercent =
      Number(ticker.priceChangePercent);

    candidates.push({
      symbol: ticker.symbol,
      quoteVolume,
      priceChangePercent,
      symbolInfo
    });
  }

  return candidates;
}


/* =========================================================
   DAILY SCAN
========================================================= */

async function scanDailyCandidates(
  candidates
) {

  /*
   * If 1D is disabled, DO NOT make any 1D API calls.
   */

  if (!enableDaily.checked) {
    return candidates;
  }

  const minimumDaily =
    Number(dailyMin.value);

  setScanStatus(
    `Checking 1D condition for ${candidates.length} candidates...`
  );

  const analyzed =
    await runWithConcurrency(
      candidates,

      async (candidate) => {

        const daily =
          await analyzeDailyCandle(
            candidate.symbol
          );

        if (!daily) {
          return null;
        }

        /*
         * Current daily candle must be green.
         */

        if (!daily.green) {
          return null;
        }

        if (
          Number.isFinite(minimumDaily) &&
          daily.change < minimumDaily
        ) {
          return null;
        }

        return {
          ...candidate,
          dailyChange: daily.change,
          dailyGreen: daily.green
        };
      },

      8,

      (completed, total) => {

        const percent =
          total > 0
            ? (completed / total) * 100
            : 100;

        setProgress(percent);
        setScanStatus(
          `Checking 1D: ${completed}/${total}`
        );
      }
    );

  return analyzed;
}


/* =========================================================
   HOURLY SCAN
========================================================= */

async function scanHourlyCandidates(
  candidates
) {

  /*
   * If 1H is disabled, DO NOT make any 1H API calls.
   */

  if (!enableHourly.checked) {
    return candidates;
  }

  const selectedPattern =
    getSelectedPattern();

  setScanStatus(
    `Checking 1H pattern for ${candidates.length} candidates...`
  );

  const analyzed =
    await runWithConcurrency(
      candidates,

      async (candidate) => {

        const hourly =
          await analyzeHourlyCandle(
            candidate.symbol,
            selectedPattern
          );

        if (!hourly) {
          return null;
        }

        return {
          ...candidate,
          hourly
        };
      },

      8,

      (completed, total) => {

        const percent =
          total > 0
            ? (completed / total) * 100
            : 100;

        setProgress(percent);

        setScanStatus(
          `Checking 1H: ${completed}/${total}`
        );
      }
    );

  return analyzed;
}


/* =========================================================
   START SCAN
========================================================= */

async function startScan() {

  if (isScanning) {
    return;
  }

  /*
   * Validate settings.
   */

  const volumeMinimum =
    Number(volumeMin.value);

  const dailyMinimum =
    Number(dailyMin.value);

  const hourlyMinimum =
    Number(hourlyMin.value);

  const max =
    Number(maxResults.value);

  if (
    !Number.isFinite(volumeMinimum) ||
    volumeMinimum < 0
  ) {

    alert("Please enter a valid minimum volume.");
    return;
  }

  if (
    enableDaily.checked &&
    (
      !Number.isFinite(dailyMinimum) ||
      dailyMinimum < 0
    )
  ) {

    alert("Please enter a valid minimum 24H change.");
    return;
  }

  if (
    enableHourly.checked &&
    patternCandle1.value !== "red" &&
    (
      !Number.isFinite(hourlyMinimum) ||
      hourlyMinimum < 0
    )
  ) {

    alert("Please enter a valid minimum 1H percentage.");
    return;
  }

  if (
    !Number.isFinite(max) ||
    max < 1
  ) {

    alert("Please enter a valid maximum result count.");
    return;
  }

  isScanning = true;
  stopRequested = false;

  scanResults = [];

  startBtn.disabled = true;
  stopBtn.disabled = false;
  exportBtn.disabled = true;

  setStatus("Scanning", "running");

  setProgress(0);

  totalPairsEl.textContent = "0";
  volumeCandidatesEl.textContent = "0";
  matchedCountEl.textContent = "0";
  resultCountEl.textContent = "0 Results";

  resultsBody.innerHTML = `
    <tr class="empty-row">
      <td colspan="8">
        Scanning...
      </td>
    </tr>
  `;

  scanStartTime = Date.now();

  clearInterval(elapsedTimer);

  elapsedTimer = setInterval(
    updateElapsedTime,
    500
  );

  try {

    setScanStatus(
      "Loading Binance Spot exchange information..."
    );

    const symbols =
      await getSpotSymbols();

    if (stopRequested) {
      finishScan(true);
      return;
    }

    totalPairsEl.textContent =
      formatNumber(symbols.length);

    setScanStatus(
      `Found ${symbols.length} verified Spot USDT pairs. Loading 24H data...`
    );

    const tickers =
      await getAll24hTickers();

    if (stopRequested) {
      finishScan(true);
      return;
    }

    const candidates =
      buildVolumeCandidates(
        symbols,
        tickers
      );

    volumeCandidatesEl.textContent =
      formatNumber(candidates.length);

    /*
     * First stage: 24H volume.
     */

    if (candidates.length === 0) {

      scanResults = [];

      renderResults();

      setScanStatus(
        "No pairs passed the minimum 24H volume condition."
      );

      finishScan(false);
      return;
    }

    /*
     * Second stage: optional 1D.
     */

    let dailyCandidates =
      await scanDailyCandidates(
        candidates
      );

    if (stopRequested) {
      finishScan(true);
      return;
    }

    /*
     * Third stage: optional 1H.
     */

    let finalCandidates =
      await scanHourlyCandidates(
        dailyCandidates
      );

    if (stopRequested) {
      finishScan(true);
      return;
    }

    /*
     * Sort.
     *
     * 1D ON:
     *   Daily percentage descending.
     *
     * 1D OFF:
     *   24H quote volume descending.
     */

    if (enableDaily.checked) {

      finalCandidates.sort(
        (a, b) =>
          (b.dailyChange ?? b.priceChangePercent ?? 0) -
          (a.dailyChange ?? a.priceChangePercent ?? 0)
      );

    } else {

      finalCandidates.sort(
        (a, b) =>
          b.quoteVolume - a.quoteVolume
      );
    }

    scanResults =
      finalCandidates.slice(0, max);

    matchedCountEl.textContent =
      formatNumber(finalCandidates.length);

    renderResults();

    setProgress(100);

    setScanStatus(
      `Scan complete. ${scanResults.length} result${scanResults.length === 1 ? "" : "s"} found.`
    );

    setStatus("Complete", "success");

    resultCountEl.textContent =
      `${scanResults.length} Result${scanResults.length === 1 ? "" : "s"}`;

    exportBtn.disabled =
      scanResults.length === 0;

  } catch (error) {

    console.error(error);

    setStatus("Error", "error");

    setScanStatus(
      `Scan failed: ${error.message}`
    );

    resultsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="8">
          Scan failed. Check your internet connection and Binance API availability.
        </td>
      </tr>
    `;

  } finally {

    if (isScanning) {
      finishScan(false);
    }
  }
}


/* =========================================================
   STOP
========================================================= */

function stopScan() {

  if (!isScanning) {
    return;
  }

  stopRequested = true;

  setScanStatus(
    "Stopping scan..."
  );

  stopBtn.disabled = true;
}


/* =========================================================
   FINISH
========================================================= */

function finishScan(wasStopped) {

  isScanning = false;

  clearInterval(elapsedTimer);
  elapsedTimer = null;

  startBtn.disabled = false;
  stopBtn.disabled = true;

  if (wasStopped) {

    setStatus("Stopped", "idle");

    setScanStatus(
      "Scan stopped by user."
    );
  }

  updateElapsedTime();
}


/* =========================================================
   ELAPSED
========================================================= */

function updateElapsedTime() {

  if (!scanStartTime) {
    elapsedTimeEl.textContent = "0s";
    return;
  }

  const seconds =
    Math.floor(
      (Date.now() - scanStartTime) / 1000
    );

  elapsedTimeEl.textContent =
    formatElapsed(seconds);
}


/* =========================================================
   TABLE HEADER
========================================================= */

function updateTableHeader() {

  let html = `
    <tr>
      <th>#</th>
      <th>Symbol</th>
  `;

  if (enableDaily.checked) {

    html += `
      <th>1D %</th>
    `;

  } else {

    html += `
      <th>24H %</th>
    `;
  }

  html += `
      <th>24H Volume</th>
  `;

  if (enableHourly.checked) {

    html += `
      <th>1H -4</th>
      <th>1H -3</th>
      <th>1H -2</th>
      <th>1H Last</th>
    `;
  }

  html += `
    </tr>
  `;

  resultsHead.innerHTML = html;
}


/* =========================================================
   RESULT TABLE
========================================================= */

function renderResults() {

  updateTableHeader();

  if (!scanResults.length) {

    const columns =
      enableHourly.checked ? 8 : 4;

    resultsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="${columns}">
          No matching pairs found.
        </td>
      </tr>
    `;

    resultsDescription.textContent =
      buildResultsDescription();

    return;
  }

  resultsBody.innerHTML =
    scanResults
      .map((result, index) => {

        const dailyValue =
          enableDaily.checked
            ? result.dailyChange
            : result.priceChangePercent;

        const dailyClass =
          dailyValue >= 0
            ? "green"
            : "red";

        let hourlyHTML = "";

        if (
          enableHourly.checked &&
          result.hourly
        ) {

          hourlyHTML =
            result.hourly.candles
              .map((candle) => {

                const isGreen =
                  candle.green;

                const icon =
                  isGreen
                    ? "🟢"
                    : "🔴";

                const cssClass =
                  isGreen
                    ? "green"
                    : "red";

                return `
                  <td class="${cssClass}">
                    ${icon} ${formatPercent(candle.change)}
                  </td>
                `;
              })
              .join("");
        }

        return `
          <tr>

            <td>${index + 1}</td>

            <td class="symbol">
              ${escapeHTML(result.symbol)}
            </td>

            <td class="${dailyClass}">
              ${formatPercent(dailyValue)}
            </td>

            <td class="volume">
              ${formatVolume(result.quoteVolume)}
            </td>

            ${hourlyHTML}

          </tr>
        `;

      })
      .join("");

  resultsDescription.textContent =
    buildResultsDescription();
}


function buildResultsDescription() {

  const parts = [];

  if (enableDaily.checked) {

    parts.push(
      `1D 🟢 ≥ ${Number(dailyMin.value).toFixed(1)}%`
    );

  } else {

    parts.push(
      "1D disabled"
    );
  }

  parts.push(
    `Volume ≥ ${formatVolume(Number(volumeMin.value))}`
  );

  if (enableHourly.checked) {

    const pattern =
      getSelectedPattern()
        .map((value) => {

          if (value === "red") {
            return "🔴";
          }

          if (value === "green") {
            return "🟢";
          }

          return "⚪";
        })
        .join(" → ");

    parts.push(
      `1H ${pattern}`
    );

  } else {

    parts.push(
      "1H disabled"
    );
  }

  return parts.join(" • ");
}


/* =========================================================
   CSV
========================================================= */

function csvEscape(value) {

  const text =
    String(value ?? "");

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {

    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}


function exportCSV() {

  if (!scanResults.length) {
    return;
  }

  const rows = [];

  const header = [
    "Rank",
    "Symbol",
    enableDaily.checked
      ? "1D Change %"
      : "24H Change %",
    "24H Quote Volume"
  ];

  if (enableHourly.checked) {

    header.push(
      "1H -4",
      "1H -3",
      "1H -2",
      "1H Last"
    );
  }

  rows.push(header);

  scanResults.forEach(
    (result, index) => {

      const dailyValue =
        enableDaily.checked
          ? result.dailyChange
          : result.priceChangePercent;

      const row = [
        index + 1,
        result.symbol,
        Number(dailyValue).toFixed(4),
        Number(result.quoteVolume).toFixed(2)
      ];

      if (
        enableHourly.checked &&
        result.hourly
      ) {

        result.hourly.candles.forEach(
          (candle) => {

            row.push(
              Number(candle.change).toFixed(4)
            );
          }
        );
      }

      rows.push(row);
    }
  );

  const csv =
    rows
      .map(
        (row) =>
          row.map(csvEscape).join(",")
      )
      .join("\n");

  const blob =
    new Blob(
      [csv],
      {
        type: "text/csv;charset=utf-8;"
      }
    );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;

  const timestamp =
    new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replaceAll(".", "-");

  link.download =
    `binance-momentum-scan-${timestamp}.csv`;

  document.body.appendChild(link);

  link.click();

  link.remove();

  URL.revokeObjectURL(url);
}


/* =========================================================
   FINAL INITIAL UI
========================================================= */

updateTableHeader();
updatePatternPreview();