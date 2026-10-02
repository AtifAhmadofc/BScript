"use strict";

/*
 * Binance Spot USDT Momentum Scanner
 * Version: 1.0.3
 *
 * Modes:
 *
 * 1D ON + 1H ON
 *   -> 1D condition + 24H volume + selected 1H pattern
 *
 * 1D ON + 1H OFF
 *   -> 1D condition + 24H volume
 *   -> NO 1H API calls
 *
 * 1D OFF + 1H ON
 *   -> 24H volume + selected 1H pattern
 *   -> NO 1D API calls
 *
 * 1D OFF + 1H OFF
 *   -> 24H volume only
 *   -> NO 1D or 1H API calls
 *
 * Hourly patterns:
 *
 * 3 candles:
 *   RED -> RED -> GREEN
 *
 * 4 candles:
 *   RED -> RED -> RED -> GREEN
 *
 * Only COMPLETED 1H candles are used.
 */

const VERSION = "1.0.3";

const API_BASE =
  "https://api.binance.com";

const ENDPOINTS = {

  exchangeInfo:
    `${API_BASE}/api/v3/exchangeInfo`,

  ticker24h:
    `${API_BASE}/api/v3/ticker/24hr`,

  klines:
    `${API_BASE}/api/v3/klines`,

};


const CONCURRENCY = 7;


let isScanning = false;

let abortController = null;

let lastResults = [];


/* -------------------------------------------------------
   DOM
------------------------------------------------------- */

const $ = (id) =>
  document.getElementById(id);


const enableDaily =
  $("enableDaily");

const enableHourly =
  $("enableHourly");

const dailyMinInput =
  $("dailyMin");

const volumeMinInput =
  $("volumeMin");

const hourlyMinInput =
  $("hourlyMin");

const hourlyPattern =
  $("hourlyPattern");

const maxResultsInput =
  $("maxResults");


const scanBtn =
  $("scanBtn");

const stopBtn =
  $("stopBtn");

const exportBtn =
  $("exportBtn");


const statusTitle =
  $("statusTitle");

const statusText =
  $("statusText");

const statusBadge =
  $("statusBadge");


const progressBar =
  $("progressBar");

const progressText =
  $("progressText");


const statSymbols =
  $("statSymbols");

const statSpot =
  $("statSpot");

const statDaily =
  $("statDaily");

const statMatches =
  $("statMatches");


const resultsHead =
  $("resultsHead");

const resultsBody =
  $("resultsBody");

const resultsSubtitle =
  $("resultsSubtitle");


/* -------------------------------------------------------
   Utilities
------------------------------------------------------- */

function formatNumber(value) {

  return new Intl.NumberFormat(
    "en-US"
  ).format(value);

}


function formatPercent(value) {

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "—";
  }

  return `${
    n >= 0 ? "+" : ""
  }${n.toFixed(2)}%`;

}


function formatVolume(value) {

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return "—";
  }

  if (n >= 1_000_000_000) {

    return `$${(
      n / 1_000_000_000
    ).toFixed(2)}B`;

  }


  if (n >= 1_000_000) {

    return `$${(
      n / 1_000_000
    ).toFixed(2)}M`;

  }


  if (n >= 1_000) {

    return `$${(
      n / 1_000
    ).toFixed(1)}K`;

  }


  return `$${n.toFixed(0)}`;

}


function escapeHtml(value) {

  return String(value)

    .replaceAll(
      "&",
      "&amp;"
    )

    .replaceAll(
      "<",
      "&lt;"
    )

    .replaceAll(
      ">",
      "&gt;"
    )

    .replaceAll(
      '"',
      "&quot;"
    )

    .replaceAll(
      "'",
      "&#039;"
    );

}


function setStatus(
  type,
  title,
  text
) {

  statusTitle.textContent =
    title;

  statusText.textContent =
    text;

  statusBadge.className =
    `status-badge ${type}`;


  const labels = {

    idle: "READY",

    running: "RUNNING",

    done: "DONE",

    error: "ERROR",

  };


  statusBadge.textContent =
    labels[type] || "READY";

}


function setProgress(
  percent,
  text
) {

  const safe =
    Math.min(
      100,
      Math.max(
        0,
        percent
      )
    );


  progressBar.style.width =
    `${safe}%`;

  progressText.textContent =
    text;

}


function resetStats() {

  statSymbols.textContent =
    "—";

  statSpot.textContent =
    "—";

  statDaily.textContent =
    "—";

  statMatches.textContent =
    "—";

}


function checkStopped() {

  if (
    abortController?.signal
      .aborted
  ) {

    throw new DOMException(
      "Scan stopped",
      "AbortError"
    );

  }

}


/* -------------------------------------------------------
   API
------------------------------------------------------- */

async function fetchJson(
  url,
  options = {}
) {

  const response =
    await fetch(
      url,
      {

        ...options,

        headers: {

          Accept:
            "application/json",

          ...(options.headers || {}),

        },

      }
    );


  if (!response.ok) {

    let message =
      `HTTP ${response.status}`;


    try {

      const error =
        await response.json();

      if (error?.msg) {

        message +=
          `: ${error.msg}`;

      }

    } catch (_) {

      // Ignore.

    }


    throw new Error(message);

  }


  return response.json();

}


/* -------------------------------------------------------
   SPOT verification
------------------------------------------------------- */

function containsSpotPermission(
  value
) {

  if (!value) {
    return false;
  }


  if (
    typeof value ===
    "string"
  ) {

    return (
      value.toUpperCase() ===
      "SPOT"
    );

  }


  if (
    Array.isArray(value)
  ) {

    return value.some(
      containsSpotPermission
    );

  }


  return false;

}


function isVerifiedSpotSymbol(
  symbol
) {

  if (
    !symbol ||
    typeof symbol !== "object"
  ) {

    return false;

  }


  if (
    symbol.status !==
    "TRADING"
  ) {

    return false;

  }


  if (
    symbol.quoteAsset !==
    "USDT"
  ) {

    return false;

  }


  const permissionSources = [

    symbol.permissions,

    symbol.permissionSets,

    symbol.allowedPermissions,

  ];


  const hasSpotPermission =
    permissionSources.some(
      containsSpotPermission
    );


  if (hasSpotPermission) {

    return true;

  }


  if (
    symbol.isSpotTradingAllowed ===
    true
  ) {

    return true;

  }


  if (
    symbol.spotTradingAllowed ===
    true
  ) {

    return true;

  }


  /*
   * Fail closed.
   *
   * USDT + TRADING alone does
   * NOT prove Spot.
   */

  return false;

}


/* -------------------------------------------------------
   Exchange information
------------------------------------------------------- */

async function getSpotSymbols() {

  const data =
    await fetchJson(
      ENDPOINTS.exchangeInfo
    );


  if (
    !Array.isArray(
      data?.symbols
    )
  ) {

    throw new Error(
      "Binance exchangeInfo returned no symbols."
    );

  }


  const allSymbols =
    data.symbols;


  const spotUsdtSymbols =
    allSymbols.filter(
      isVerifiedSpotSymbol
    );


  return {

    allSymbols,

    spotUsdtSymbols,

  };

}


/* -------------------------------------------------------
   24H ticker
------------------------------------------------------- */

async function getAll24hTickers() {

  const data =
    await fetchJson(
      ENDPOINTS.ticker24h
    );


  if (!Array.isArray(data)) {

    throw new Error(
      "Binance 24H ticker response was invalid."
    );

  }


  return data;

}


/* -------------------------------------------------------
   Klines
------------------------------------------------------- */

async function getKlines(
  symbol,
  interval,
  limit,
  signal
) {

  const url =
    `${ENDPOINTS.klines}` +
    `?symbol=${encodeURIComponent(
      symbol
    )}` +
    `&interval=${encodeURIComponent(
      interval
    )}` +
    `&limit=${limit}`;


  return fetchJson(
    url,
    {
      signal,
    }
  );

}


/* -------------------------------------------------------
   Candle analysis
------------------------------------------------------- */

function analyzeCandle(
  kline
) {

  if (
    !Array.isArray(kline) ||
    kline.length < 7
  ) {

    return null;

  }


  const open =
    Number(kline[1]);

  const close =
    Number(kline[4]);


  if (
    !Number.isFinite(open) ||
    !Number.isFinite(close) ||
    open <= 0
  ) {

    return null;

  }


  const percent =
    ((close - open) /
      open) *
    100;


  return {

    open,

    close,

    percent,

    green:
      close > open,

    red:
      close < open,

  };

}


/* -------------------------------------------------------
   Completed candles
------------------------------------------------------- */

function getCompletedKlines(
  klines
) {

  const now =
    Date.now();


  return klines.filter(
    (kline) => {

      const closeTime =
        Number(kline[6]);


      return (
        Number.isFinite(
          closeTime
        ) &&
        closeTime < now
      );

    }
  );

}


/* -------------------------------------------------------
   Concurrency
------------------------------------------------------- */

async function runWithConcurrency(
  items,
  concurrency,
  worker
) {

  const results =
    new Array(items.length);


  let nextIndex = 0;


  async function workerLoop() {

    while (true) {

      checkStopped();


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

        if (
          error?.name ===
          "AbortError"
        ) {

          throw error;

        }


        results[index] = {

          error,

          item:
            items[index],

        };

      }

    }

  }


  const workerCount =
    Math.min(
      concurrency,
      items.length
    );


  await Promise.all(

    Array.from(
      {
        length:
          workerCount,
      },

      () =>
        workerLoop()

    )

  );


  return results;

}


/* -------------------------------------------------------
   Candidate scan
------------------------------------------------------- */

async function analyzeCandidate(
  symbolInfo,
  ticker,
  settings
) {

  checkStopped();


  const symbol =
    symbolInfo.symbol;


  const quoteVolume =
    Number(
      ticker?.quoteVolume
    );


  if (
    !Number.isFinite(
      quoteVolume
    )
  ) {

    return null;

  }


  /*
   * Volume condition always
   * remains active.
   */

  if (
    quoteVolume <
    settings.volumeMin
  ) {

    return null;

  }


  let dailyPercent =
    null;


  /*
   * IMPORTANT:
   *
   * Only call the 1D API
   * when 1D condition is enabled.
   */

  if (
    settings.enableDaily
  ) {

    const klines =
      await getKlines(
        symbol,
        "1d",
        1,
        abortController.signal
      );


    checkStopped();


    const daily =
      analyzeCandle(
        klines?.[0]
      );


    if (!daily) {

      return null;

    }


    /*
     * Current 1D candle:
     *
     * Must be green.
     */

    if (!daily.green) {

      return null;

    }


    /*
     * Daily percentage.
     */

    if (
      daily.percent <
      settings.dailyMin
    ) {

      return null;

    }


    dailyPercent =
      daily.percent;

  }


  /*
   * If 1D is disabled,
   * there is deliberately
   * NO 1D API call.
   */

  return {

    symbolInfo,

    symbol,

    dailyPercent,

    quoteVolume,

  };

}


/* -------------------------------------------------------
   Candidate scanning
------------------------------------------------------- */

async function scanCandidates(
  spotSymbols,
  tickerMap,
  settings
) {

  const candidates = [];


  let completed = 0;

  const total =
    spotSymbols.length;


  let conditionText;


  if (
    settings.enableDaily
  ) {

    conditionText =
      "1D + 24H volume";

  } else {

    conditionText =
      "24H volume only";

  }


  setStatus(
    "running",
    "Checking markets",
    `Applying ${conditionText} conditions...`
  );


  setProgress(
    0,
    `Checking ${conditionText}: 0/${total} • Candidates: 0`
  );


  await runWithConcurrency(

    spotSymbols,

    CONCURRENCY,

    async (
      symbolInfo
    ) => {

      try {

        const result =
          await analyzeCandidate(
            symbolInfo,
            tickerMap.get(
              symbolInfo.symbol
            ),
            settings
          );


        if (result) {

          candidates.push(
            result
          );

        }


        return result;

      } finally {

        completed++;


        const percent =
          total > 0
            ? (
                completed /
                total
              ) * 100
            : 100;


        setProgress(

          percent,

          `Checking ${conditionText}: ${completed}/${total} • Candidates: ${candidates.length}`

        );

      }

    }

  );


  /*
   * If 1D is enabled,
   * sort by actual 1D %.
   *
   * If 1D is disabled,
   * there is no 1D candle value,
   * so preserve scanner order.
   */

  if (
    settings.enableDaily
  ) {

    candidates.sort(
      (a, b) =>
        b.dailyPercent -
        a.dailyPercent
    );

  }


  return candidates;

}


/* -------------------------------------------------------
   Hourly pattern
------------------------------------------------------- */

async function checkHourlyPattern(
  candidate,
  settings
) {

  checkStopped();


  const count =
    Number(
      settings.hourlyPattern
    );


  /*
   * Request a couple extra
   * candles because the latest
   * candle may still be forming.
   */

  const klines =
    await getKlines(

      candidate.symbol,

      "1h",

      count + 2,

      abortController.signal

    );


  checkStopped();


  const completed =
    getCompletedKlines(
      klines
    );


  if (
    completed.length <
    count
  ) {

    return null;

  }


  /*
   * EXACTLY the latest N
   * completed candles.
   */

  const selected =
    completed.slice(
      -count
    );


  const candles =
    selected.map(
      analyzeCandle
    );


  if (
    candles.some(
      (candle) =>
        !candle
    )
  ) {

    return null;

  }


  /*
   * Every candle except
   * the last must be RED.
   *
   * Last candle must be GREEN.
   *
   * Therefore:
   *
   * 3:
   * RED RED GREEN
   *
   * 4:
   * RED RED RED GREEN
   */

  for (
    let i = 0;
    i < candles.length - 1;
    i++
  ) {

    if (
      !candles[i].red
    ) {

      return null;

    }

  }


  const last =
    candles[
      candles.length - 1
    ];


  if (!last.green) {

    return null;

  }


  /*
   * Latest green candle
   * minimum percentage.
   */

  if (
    last.percent <
    settings.hourlyMin
  ) {

    return null;

  }


  return {

    ...candidate,

    hourlyValues:
      candles.map(
        (c) => c.percent
      ),

    hourlyLast:
      last.percent,

  };

}


/* -------------------------------------------------------
   Hourly scan
------------------------------------------------------- */

async function scanHourly(
  candidates,
  settings
) {

  const matches = [];


  let completed = 0;

  const total =
    candidates.length;


  const patternCount =
    Number(
      settings.hourlyPattern
    );


  setStatus(
    "running",
    "Checking 1H patterns",
    `Checking the latest ${patternCount} completed 1H candles...`
  );


  setProgress(
    0,
    `Checking 1H pattern: 0/${total} • Matches: 0`
  );


  if (!total) {

    return [];

  }


  await runWithConcurrency(

    candidates,

    CONCURRENCY,

    async (
      candidate
    ) => {

      try {

        const result =
          await checkHourlyPattern(
            candidate,
            settings
          );


        if (result) {

          matches.push(
            result
          );

        }


        return result;

      } finally {

        completed++;


        setProgress(

          (
            completed /
            total
          ) * 100,

          `Checking 1H pattern: ${completed}/${total} • Matches: ${matches.length}`

        );

      }

    }

  );


  /*
   * If 1D is enabled,
   * sort by daily percentage.
   */

  if (
    settings.enableDaily
  ) {

    matches.sort(
      (a, b) =>
        b.dailyPercent -
        a.dailyPercent
    );

  }


  return matches;

}


/* -------------------------------------------------------
   Results header
------------------------------------------------------- */

function renderTableHeader(
  settings
) {

  let html = `
    <tr>
      <th>#</th>
      <th>Coin</th>
      <th>Market</th>
  `;


  if (
    settings.enableDaily
  ) {

    html += `
      <th>1D</th>
    `;

  }


  if (
    settings.enableHourly
  ) {

    const count =
      Number(
        settings.hourlyPattern
      );


    for (
      let i = 0;
      i < count - 1;
      i++
    ) {

      html += `
        <th>
          1H -${count - i - 1}
        </th>
      `;

    }


    html += `
      <th>1H Last</th>
    `;

  }


  html += `
      <th>24H Volume</th>
      <th>Chart</th>
    </tr>
  `;


  resultsHead.innerHTML =
    html;

}


/* -------------------------------------------------------
   Results
------------------------------------------------------- */

function renderResults(
  results,
  settings
) {

  renderTableHeader(
    settings
  );


  resultsBody.innerHTML = "";


  let columnCount = 5;


  if (
    settings.enableDaily
  ) {

    columnCount++;

  }


  if (
    settings.enableHourly
  ) {

    columnCount +=
      Number(
        settings.hourlyPattern
      );

  }


  if (!results.length) {

    resultsBody.innerHTML = `

      <tr class="empty-row">

        <td colspan="${columnCount}">

          <div class="empty-state">

            <div class="empty-icon">
              ⌁
            </div>

            <strong>
              No exact matches found
            </strong>

            <span>
              No verified Spot USDT pair satisfied all enabled conditions.
            </span>

          </div>

        </td>

      </tr>

    `;


    resultsSubtitle.textContent =
      "No coins matched all enabled conditions.";


    return;

  }


  results.forEach(
    (result, index) => {

      const row =
        document.createElement(
          "tr"
        );


      const chartUrl =
        `https://www.binance.com/en/trade/${encodeURIComponent(
          result.symbol
        )}`;


      let html = `

        <td>
          ${index + 1}
        </td>

        <td>

          <div class="coin">

            ${escapeHtml(
              result.symbol
            )}

            <small>
              Binance Spot
            </small>

          </div>

        </td>

        <td>

          <span class="spot">
            ✓ SPOT
          </span>

        </td>

      `;


      /*
       * 1D column
       */

      if (
        settings.enableDaily
      ) {

        html += `

          <td>

            <span class="percent green">

              ${formatPercent(
                result.dailyPercent
              )}

            </span>

          </td>

        `;

      }


      /*
       * Hourly columns
       */

      if (
        settings.enableHourly
      ) {

        result.hourlyValues.forEach(
          (value, index) => {

            const isLast =
              index ===
              result.hourlyValues.length - 1;


            html += `

              <td>

                <span class="percent ${
                  isLast
                    ? "green"
                    : "red"
                }">

                  ${formatPercent(
                    value
                  )}

                </span>

              </td>

            `;

          }
        );

      }


      html += `

        <td>

          <span class="volume">

            ${formatVolume(
              result.quoteVolume
            )}

          </span>

        </td>


        <td>

          <a
            class="chart-link"
            href="${chartUrl}"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open ↗
          </a>

        </td>

      `;


      row.innerHTML =
        html;


      resultsBody.appendChild(
        row
      );

    }
  );


  resultsSubtitle.textContent =
    `${results.length} exact match${
      results.length === 1
        ? ""
        : "es"
    } found.`;

}


/* -------------------------------------------------------
   CSV
------------------------------------------------------- */

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

    return `"${stringValue.replaceAll(
      '"',
      '""'
    )}"`;

  }


  return stringValue;

}


function exportCSV() {

  if (
    !lastResults.length
  ) {

    return;

  }


  const settings =
    getSettings();


  const header = [

    "Rank",

    "Symbol",

    "Market",

  ];


  if (
    settings.enableDaily
  ) {

    header.push(
      "1D %"
    );

  }


  if (
    settings.enableHourly
  ) {

    header.push(
      "1H Pattern"
    );

    header.push(
      "1H Values"
    );

    header.push(
      "1H Last %"
    );

  }


  header.push(
    "24H Volume"
  );


  const rows =
    lastResults.map(
      (result, index) => {

        const row = [

          index + 1,

          result.symbol,

          "SPOT",

        ];


        if (
          settings.enableDaily
        ) {

          row.push(
            result.dailyPercent
              .toFixed(4)
          );

        }


        if (
          settings.enableHourly
        ) {

          const count =
            Number(
              settings.hourlyPattern
            );


          const redCount =
            count - 1;


          const pattern =
            `${"RED ".repeat(
              redCount
            )}GREEN`.trim();


          row.push(
            pattern
          );


          row.push(

            result.hourlyValues
              .map(
                (value) =>
                  value.toFixed(4)
              )
              .join(" | ")

          );


          row.push(
            result.hourlyLast
              .toFixed(4)
          );

        }


        row.push(
          result.quoteVolume
            .toFixed(2)
        );


        return row;

      }
    );


  const csv =
    [

      header,

      ...rows,

    ]

      .map(
        (row) =>
          row
            .map(csvEscape)
            .join(",")
      )

      .join("\r\n");


  const blob =
    new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8;",
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


  link.href =
    url;


  link.download =
    `binance-momentum-v1.0.3-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;


  document.body.appendChild(
    link
  );


  link.click();


  link.remove();


  URL.revokeObjectURL(
    url
  );

}


/* -------------------------------------------------------
   Settings
------------------------------------------------------- */

function getSettings() {

  const dailyMin =
    Number(
      dailyMinInput.value
    );


  const volumeMin =
    Number(
      volumeMinInput.value
    );


  const hourlyMin =
    Number(
      hourlyMinInput.value
    );


  const maxResults =
    Number(
      maxResultsInput.value
    );


  if (
    !Number.isFinite(
      dailyMin
    )
  ) {

    throw new Error(
      "Daily minimum % is invalid."
    );

  }


  if (
    !Number.isFinite(
      volumeMin
    ) ||
    volumeMin < 0
  ) {

    throw new Error(
      "Minimum 24H volume is invalid."
    );

  }


  if (
    !Number.isFinite(
      hourlyMin
    )
  ) {

    throw new Error(
      "Latest 1H minimum % is invalid."
    );

  }


  if (
    !Number.isFinite(
      maxResults
    ) ||
    maxResults < 1
  ) {

    throw new Error(
      "Maximum results must be at least 1."
    );

  }


  return {

    enableDaily:
      enableDaily.checked,

    enableHourly:
      enableHourly.checked,

    dailyMin,

    volumeMin,

    hourlyMin,

    hourlyPattern:
      hourlyPattern.value,

    maxResults:
      Math.floor(
        maxResults
      ),

  };

}


/* -------------------------------------------------------
   Main scan
------------------------------------------------------- */

async function startScan() {

  if (isScanning) {

    return;

  }


  let settings;


  try {

    settings =
      getSettings();

  } catch (error) {

    setStatus(
      "error",
      "Invalid settings",
      error.message
    );

    return;

  }


  isScanning = true;

  abortController =
    new AbortController();


  lastResults = [];


  scanBtn.disabled =
    true;

  stopBtn.disabled =
    false;

  exportBtn.disabled =
    true;


  resetStats();


  renderTableHeader(
    settings
  );


  resultsBody.innerHTML = `

    <tr class="empty-row">

      <td colspan="10">

        <div class="empty-state">

          <div class="empty-icon">
            ⟳
          </div>

          <strong>
            Loading Binance...
          </strong>

          <span>
            Fetching verified Spot USDT markets.
          </span>

        </div>

      </td>

    </tr>

  `;


  resultsSubtitle.textContent =
    "Scanning Binance Spot markets...";


  try {

    setStatus(
      "running",
      "Loading Binance Spot markets",
      "Fetching exchangeInfo and 24H ticker data..."
    );


    setProgress(
      2,
      "Fetching Binance exchange information..."
    );


    /*
     * exchangeInfo + 24H ticker
     * are loaded in parallel.
     */

    const [

      spotData,

      tickers,

    ] = await Promise.all([

      getSpotSymbols(),

      getAll24hTickers(),

    ]);


    checkStopped();


    statSymbols.textContent =
      formatNumber(
        spotData
          .allSymbols
          .length
      );


    statSpot.textContent =
      formatNumber(
        spotData
          .spotUsdtSymbols
          .length
      );


    /*
     * Ticker lookup.
     */

    const tickerMap =
      new Map();


    for (
      const ticker of tickers
    ) {

      if (
        ticker?.symbol
      ) {

        tickerMap.set(
          ticker.symbol,
          ticker
        );

      }

    }


    /*
     * Candidate scan.
     *
     * If 1D is OFF,
     * analyzeCandidate()
     * NEVER requests 1D klines.
     */

    const candidates =
      await scanCandidates(

        spotData
          .spotUsdtSymbols,

        tickerMap,

        settings

      );


    checkStopped();


    statDaily.textContent =
      formatNumber(
        candidates.length
      );


    let matches;


    /*
     * Hourly condition.
     */

    if (
      settings.enableHourly
    ) {

      matches =
        await scanHourly(
          candidates,
          settings
        );

    } else {

      /*
       * IMPORTANT:
       *
       * No 1H API calls.
       */

      setStatus(

        "running",

        settings.enableDaily
          ? "1D-only scan"
          : "Volume-only scan",

        settings.enableDaily
          ? "1H condition is disabled. Using 1D + 24H volume only."
          : "1D and 1H conditions are disabled. Using 24H volume only."

      );


      setProgress(

        100,

        "1H condition skipped • No hourly API calls made"

      );


      matches =
        candidates;

    }


    checkStopped();


    /*
     * Apply maximum result
     * limit AFTER matching.
     */

    const finalResults =
      matches.slice(
        0,
        settings.maxResults
      );


    lastResults =
      finalResults;


    statMatches.textContent =
      formatNumber(
        finalResults.length
      );


    renderResults(
      finalResults,
      settings
    );


    setProgress(

      100,

      `Scan complete • ${finalResults.length} result${
        finalResults.length === 1
          ? ""
          : "s"
      }`

    );


    let mode;


    if (
      settings.enableDaily &&
      settings.enableHourly
    ) {

      mode =
        "1D + 1H + 24H volume";

    } else if (
      settings.enableDaily
    ) {

      mode =
        "1D + 24H volume";

    } else if (
      settings.enableHourly
    ) {

      mode =
        "1H + 24H volume";

    } else {

      mode =
        "24H volume only";

    }


    setStatus(

      "done",

      "Scan complete",

      `${matches.length} exact match${
        matches.length === 1
          ? ""
          : "es"
      } found • Mode: ${mode}`

    );


    exportBtn.disabled =
      finalResults.length === 0;


  } catch (error) {

    if (
      error?.name ===
      "AbortError"
    ) {

      setStatus(
        "idle",
        "Scan stopped",
        "The scan was stopped by the user."
      );


      setProgress(
        0,
        "Scan stopped."
      );


      resultsSubtitle.textContent =
        "Scan stopped.";


      return;

    }


    console.error(
      error
    );


    setStatus(

      "error",

      "Scan failed",

      error?.message ||
        "An unexpected error occurred."

    );


    setProgress(
      0,
      "Unable to complete scan."
    );


    resultsSubtitle.textContent =
      "The scan could not be completed.";

  } finally {

    isScanning =
      false;

    abortController =
      null;

    scanBtn.disabled =
      false;

    stopBtn.disabled =
      true;

  }

}


/* -------------------------------------------------------
   Stop
------------------------------------------------------- */

function stopScan() {

  if (
    !isScanning ||
    !abortController
  ) {

    return;

  }


  abortController.abort();

}


/* -------------------------------------------------------
   UI controls
------------------------------------------------------- */

function syncControls() {

  /*
   * 1D controls
   */

  dailyMinInput.disabled =
    !enableDaily.checked;


  /*
   * 1H controls
   */

  hourlyPattern.disabled =
    !enableHourly.checked;

  hourlyMinInput.disabled =
    !enableHourly.checked;

}


/* -------------------------------------------------------
   Events
------------------------------------------------------- */

enableDaily.addEventListener(
  "change",
  syncControls
);


enableHourly.addEventListener(
  "change",
  syncControls
);


hourlyPattern.addEventListener(
  "change",
  () => {

    /*
     * Refresh empty/header state
     * immediately when pattern
     * changes.
     */

    if (!isScanning) {

      try {

        const settings =
          getSettings();

        renderTableHeader(
          settings
        );

      } catch (_) {

        // Ignore invalid input
        // until scan.

      }

    }

  }
);


scanBtn.addEventListener(
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


/* -------------------------------------------------------
   Initial UI
------------------------------------------------------- */

syncControls();

try {

  renderTableHeader(
    getSettings()
  );

} catch (_) {

  // Ignore.

}
