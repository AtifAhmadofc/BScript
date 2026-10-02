"use strict";

/*
 * Binance Spot USDT Momentum Scanner
 *
 * VERSION 1.0.4
 *
 * IMPORTANT LOGIC:
 *
 * 1D OFF:
 *   - No 1D kline API calls.
 *   - Daily condition is completely skipped.
 *
 * 1H OFF:
 *   - No 1H kline API calls.
 *   - No 1H pattern calculation.
 *   - No 1H filtering.
 *   - No 1H table columns.
 *
 * 1H ON:
 *   3 candles = RED -> RED -> GREEN
 *   4 candles = RED -> RED -> RED -> GREEN
 *
 * Always:
 *   - Binance Spot
 *   - USDT pairs
 *   - Verified Spot permission
 *   - 24H quote volume minimum
 */


const VERSION = "1.0.4";


const API_BASE =
  "https://api.binance.com";


const ENDPOINTS = {

  exchangeInfo:
    `${API_BASE}/api/v3/exchangeInfo`,

  ticker24h:
    `${API_BASE}/api/v3/ticker/24hr`,

  klines:
    `${API_BASE}/api/v3/klines`

};


const CONCURRENCY = 7;


let abortController = null;

let lastResults = [];

let lastSettings = null;


/* =========================================================
   DOM
========================================================= */

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

const patternLengthInput =
  $("patternLength");

const maxResultsInput =
  $("maxResults");


const dailySetting =
  $("dailySetting");

const hourlyMinSetting =
  $("hourlyMinSetting");

const patternSetting =
  $("patternSetting");


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

const progressCount =
  $("progressCount");


const statSymbols =
  $("statSymbols");

const statSpot =
  $("statSpot");

const statCandidates =
  $("statCandidates");

const statMatches =
  $("statMatches");

const statCandidateLabel =
  $("statCandidateLabel");

const statMatchLabel =
  $("statMatchLabel");


const resultsDescription =
  $("resultsDescription");

const resultCount =
  $("resultCount");

const resultsHeadRow =
  $("resultsHeadRow");

const resultsBody =
  $("resultsBody");


/* =========================================================
   STATUS
========================================================= */

function setStatus(
  type,
  title,
  message
) {

  statusTitle.textContent =
    title;

  statusText.textContent =
    message;

  statusBadge.className =
    `status-badge ${type}`;


  const labels = {

    idle: "IDLE",

    running: "SCANNING",

    success: "COMPLETE",

    error: "ERROR",

    stopped: "STOPPED"

  };


  statusBadge.textContent =
    labels[type] ||
    type.toUpperCase();

}


/* =========================================================
   PROGRESS
========================================================= */

function setProgress(
  current,
  total
) {

  const percent =
    total > 0
      ? Math.min(
          100,
          Math.round(
            (current / total) * 100
          )
        )
      : 0;


  progressBar.style.width =
    `${percent}%`;


  progressText.textContent =
    `${percent}%`;


  progressCount.textContent =
    `${current} / ${total}`;

}


/* =========================================================
   RUNNING STATE
========================================================= */

function setRunning(
  running
) {

  scanBtn.disabled =
    running;

  stopBtn.disabled =
    !running;


  enableDaily.disabled =
    running;

  enableHourly.disabled =
    running;


  volumeMinInput.disabled =
    running;

  maxResultsInput.disabled =
    running;


  dailyMinInput.disabled =
    running ||
    !enableDaily.checked;


  hourlyMinInput.disabled =
    running ||
    !enableHourly.checked;


  patternLengthInput.disabled =
    running ||
    !enableHourly.checked;

}


/* =========================================================
   CONDITION UI
========================================================= */

function updateConditionControls() {

  const dailyOn =
    enableDaily.checked;

  const hourlyOn =
    enableHourly.checked;


  dailySetting.classList.toggle(
    "disabled",
    !dailyOn
  );


  hourlyMinSetting.classList.toggle(
    "disabled",
    !hourlyOn
  );


  patternSetting.classList.toggle(
    "disabled",
    !hourlyOn
  );


  dailyMinInput.disabled =
    !dailyOn;

  hourlyMinInput.disabled =
    !hourlyOn;

  patternLengthInput.disabled =
    !hourlyOn;


  /*
   * Dynamic statistics labels.
   */

  if (
    dailyOn &&
    hourlyOn
  ) {

    statCandidateLabel.textContent =
      "Daily Candidates";

    statMatchLabel.textContent =
      "Exact Matches";

  } else if (
    dailyOn &&
    !hourlyOn
  ) {

    statCandidateLabel.textContent =
      "Daily Candidates";

    statMatchLabel.textContent =
      "Final Matches";

  } else if (
    !dailyOn &&
    hourlyOn
  ) {

    statCandidateLabel.textContent =
      "Volume Candidates";

    statMatchLabel.textContent =
      "1H Matches";

  } else {

    statCandidateLabel.textContent =
      "Volume Candidates";

    statMatchLabel.textContent =
      "Final Matches";

  }


  /*
   * CRITICAL:
   *
   * Header is generated from the actual
   * checkbox state.
   */

  renderTableHeader({

    dailyEnabled: dailyOn,

    hourlyEnabled: hourlyOn,

    patternLength:
      Number(
        patternLengthInput.value
      )

  });

}


/* =========================================================
   SETTINGS
========================================================= */

function getSettings() {

  const dailyEnabled =
    enableDaily.checked;

  const hourlyEnabled =
    enableHourly.checked;


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


  const patternLength =
    Number(
      patternLengthInput.value
    );


  const maxResults =
    Number(
      maxResultsInput.value
    );


  if (
    !Number.isFinite(volumeMin) ||
    volumeMin < 0
  ) {

    throw new Error(
      "Minimum 24H volume must be 0 or greater."
    );

  }


  if (
    dailyEnabled &&
    (
      !Number.isFinite(dailyMin) ||
      dailyMin < 0
    )
  ) {

    throw new Error(
      "Minimum 1D percentage must be 0 or greater."
    );

  }


  if (
    hourlyEnabled &&
    (
      !Number.isFinite(hourlyMin) ||
      hourlyMin < -100
    )
  ) {

    throw new Error(
      "Minimum 1H percentage must be -100 or greater."
    );

  }


  if (
    hourlyEnabled &&
    ![3, 4].includes(
      patternLength
    )
  ) {

    throw new Error(
      "Invalid 1H pattern."
    );

  }


  if (
    !Number.isFinite(maxResults) ||
    maxResults < 1 ||
    maxResults > 500
  ) {

    throw new Error(
      "Maximum results must be between 1 and 500."
    );

  }


  return {

    dailyEnabled,

    hourlyEnabled,

    dailyMin,

    volumeMin,

    hourlyMin,

    patternLength,

    maxResults

  };

}


/* =========================================================
   FETCH
========================================================= */

async function fetchJson(
  url,
  signal
) {

  const response =
    await fetch(
      url,
      {
        method: "GET",

        signal,

        headers: {
          "Accept":
            "application/json"
        }
      }
    );


  if (!response.ok) {

    let message =
      `HTTP ${response.status}`;


    try {

      const error =
        await response.json();


      if (
        error &&
        error.msg
      ) {

        message +=
          `: ${error.msg}`;

      }

    } catch (_) {
      // Ignore.
    }


    throw new Error(
      message
    );

  }


  return response.json();

}


/* =========================================================
   SPOT PERMISSION CHECK
========================================================= */

function containsSpotPermission(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return false;

  }


  if (
    typeof value === "string"
  ) {

    const normalized =
      value.toLowerCase();


    return (
      normalized === "spot" ||
      normalized.includes("spot")
    );

  }


  if (
    Array.isArray(value)
  ) {

    return value.some(
      containsSpotPermission
    );

  }


  if (
    typeof value === "object"
  ) {

    return Object.values(
      value
    ).some(
      containsSpotPermission
    );

  }


  return false;

}


/* =========================================================
   STRICT SPOT VERIFICATION
========================================================= */

function isVerifiedSpotSymbol(
  symbol
) {

  if (
    !symbol ||
    symbol.status !== "TRADING"
  ) {

    return false;

  }


  if (
    symbol.quoteAsset !== "USDT"
  ) {

    return false;

  }


  /*
   * Positive Spot indicators.
   */

  if (
    symbol.isSpotTradingAllowed === true ||
    symbol.spotTradingAllowed === true
  ) {

    return true;

  }


  if (
    containsSpotPermission(
      symbol.permissions
    )
  ) {

    return true;

  }


  if (
    containsSpotPermission(
      symbol.permissionSets
    )
  ) {

    return true;

  }


  if (
    containsSpotPermission(
      symbol.allowedPermissions
    )
  ) {

    return true;

  }


  /*
   * Fail closed.
   */

  return false;

}


/* =========================================================
   EXCHANGE INFO
========================================================= */

async function getSpotSymbols(
  signal
) {

  const data =
    await fetchJson(
      ENDPOINTS.exchangeInfo,
      signal
    );


  const symbols =
    Array.isArray(
      data.symbols
    )
      ? data.symbols
      : [];


  const spotSymbols =
    symbols.filter(
      isVerifiedSpotSymbol
    );


  return {

    allSymbols:
      symbols,

    spotSymbols

  };

}


/* =========================================================
   24H TICKERS
========================================================= */

async function getAll24hTickers(
  signal
) {

  const data =
    await fetchJson(
      ENDPOINTS.ticker24h,
      signal
    );


  return Array.isArray(data)
    ? data
    : [];

}


/* =========================================================
   KLINES
========================================================= */

async function getKlines(
  symbol,
  interval,
  limit,
  signal
) {

  const url =
    `${ENDPOINTS.klines}` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${limit}`;


  return fetchJson(
    url,
    signal
  );

}


/* =========================================================
   COMPLETED CANDLES
========================================================= */

function getCompletedKlines(
  klines
) {

  const now =
    Date.now();


  return klines.filter(
    (kline) => {

      /*
       * Kline index 6 =
       * close time.
       *
       * We only accept candles
       * whose close time is already
       * in the past.
       */

      return (
        Number(kline[6]) <
        now
      );

    }
  );

}


/* =========================================================
   DAILY ANALYSIS
========================================================= */

function analyzeDailyCandle(
  kline,
  minimumPercent
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
    (
      (close - open) /
      open
    ) * 100;


  return {

    open,

    close,

    percent,

    green:
      close > open,

    passes:
      close > open &&
      percent >= minimumPercent

  };

}


/* =========================================================
   HOURLY ANALYSIS
========================================================= */

function analyzeHourlyCandle(
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


  const openTime =
    Number(kline[0]);

  const closeTime =
    Number(kline[6]);


  if (
    !Number.isFinite(open) ||
    !Number.isFinite(close) ||
    open <= 0
  ) {

    return null;

  }


  const percent =
    (
      (close - open) /
      open
    ) * 100;


  return {

    open,

    close,

    percent,

    green:
      close > open,

    red:
      close < open,

    openTime,

    closeTime

  };

}


/* =========================================================
   HOURLY PATTERN
========================================================= */

async function checkHourlyPattern(
  candidate,
  hourlyMin,
  patternLength,
  signal
) {

  /*
   * This function is ONLY called when
   * enableHourly === true.
   */

  const limit =
    patternLength + 3;


  const raw =
    await getKlines(
      candidate.symbol,
      "1h",
      limit,
      signal
    );


  const completed =
    getCompletedKlines(raw);


  if (
    completed.length <
    patternLength
  ) {

    return {

      passes: false,

      candles: []

    };

  }


  /*
   * Take exactly the latest
   * N COMPLETED candles.
   */

  const selected =
    completed.slice(
      -patternLength
    );


  const candles =
    selected.map(
      analyzeHourlyCandle
    );


  if (
    candles.some(
      (candle) => !candle
    )
  ) {

    return {

      passes: false,

      candles

    };

  }


  const lastIndex =
    candles.length - 1;


  const last =
    candles[lastIndex];


  /*
   * Every candle before the
   * final candle must be RED.
   */

  const previousAreRed =
    candles
      .slice(0, lastIndex)
      .every(
        (candle) =>
          candle.red
      );


  /*
   * Final candle must be GREEN.
   */

  const lastIsGreen =
    last.green;


  /*
   * Final green candle must
   * meet minimum percentage.
   */

  const lastPercentPasses =
    last.percent >=
    hourlyMin;


  const passes =
    previousAreRed &&
    lastIsGreen &&
    lastPercentPasses;


  return {

    passes,

    candles,

    lastGreenPercent:
      last.percent

  };

}


/* =========================================================
   CONCURRENCY
========================================================= */

async function runWithConcurrency(
  items,
  worker,
  concurrency,
  onProgress,
  signal
) {

  const results =
    new Array(
      items.length
    );


  let nextIndex = 0;

  let completed = 0;


  async function runner() {

    while (true) {

      if (
        signal.aborted
      ) {

        throw new DOMException(
          "Scan stopped",
          "AbortError"
        );

      }


      const index =
        nextIndex++;


      if (
        index >= items.length
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
          error.name ===
          "AbortError"
        ) {

          throw error;

        }


        results[index] = {

          error:
            error.message

        };

      }


      completed++;


      if (
        typeof onProgress ===
        "function"
      ) {

        onProgress(
          completed,
          items.length
        );

      }

    }

  }


  const workerCount =
    Math.min(
      concurrency,
      Math.max(
        1,
        items.length
      )
    );


  await Promise.all(
    Array.from(
      {
        length:
          workerCount
      },
      () => runner()
    )
  );


  return results;

}


/* =========================================================
   VOLUME CANDIDATES
========================================================= */

function buildVolumeCandidates(
  spotSymbols,
  tickerMap,
  volumeMin
) {

  const minimumVolume =
    volumeMin *
    1_000_000;


  return spotSymbols
    .map(
      (symbolInfo) => {

        const ticker =
          tickerMap.get(
            symbolInfo.symbol
          );


        if (!ticker) {

          return null;

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

          return null;

        }


        if (
          quoteVolume <
          minimumVolume
        ) {

          return null;

        }


        return {

          symbol:
            symbolInfo.symbol,

          baseAsset:
            symbolInfo.baseAsset,

          quoteAsset:
            symbolInfo.quoteAsset,

          quoteVolume,

          daily: null,

          hourly: null

        };

      }
    )
    .filter(Boolean);

}


/* =========================================================
   DAILY SCAN
========================================================= */

async function scanDailyCandidates(
  volumeCandidates,
  settings,
  signal
) {

  /*
   * CRITICAL:
   *
   * If 1D is disabled, return immediately.
   *
   * There will be ZERO 1D API requests.
   */

  if (
    !settings.dailyEnabled
  ) {

    return volumeCandidates;

  }


  if (
    volumeCandidates.length === 0
  ) {

    return [];

  }


  setStatus(
    "running",
    "Checking 1D conditions",
    `Analyzing current daily candles for ${volumeCandidates.length} volume-qualified pairs.`
  );


  const dailyResults =
    await runWithConcurrency(

      volumeCandidates,

      async (candidate) => {

        const klines =
          await getKlines(
            candidate.symbol,
            "1d",
            1,
            signal
          );


        const latest =
          klines[
            klines.length - 1
          ];


        const daily =
          analyzeDailyCandle(
            latest,
            settings.dailyMin
          );


        return {

          candidate,

          daily

        };

      },

      CONCURRENCY,

      (done, total) => {

        setProgress(
          done,
          total
        );

      },

      signal

    );


  return dailyResults
    .filter(
      (result) => {

        return (
          result &&
          result.candidate &&
          result.daily &&
          result.daily.passes
        );

      }
    )
    .map(
      (result) => {

        return {

          ...result.candidate,

          daily:
            result.daily

        };

      }
    );

}


/* =========================================================
   HOURLY SCAN
========================================================= */

async function scanHourlyCandidates(
  candidates,
  settings,
  signal
) {

  /*
   * =======================================================
   * THE IMPORTANT FIX
   * =======================================================
   *
   * 1H unchecked:
   *
   * return immediately.
   *
   * NO:
   * - 1H API calls
   * - pattern calculations
   * - hourly filtering
   */

  if (
    !settings.hourlyEnabled
  ) {

    return candidates;

  }


  if (
    candidates.length === 0
  ) {

    return [];

  }


  const patternText =
    settings.patternLength === 3
      ? "RED → RED → GREEN"
      : "RED → RED → RED → GREEN";


  setStatus(
    "running",
    "Checking 1H patterns",
    `Testing ${candidates.length} candidates for ${patternText}.`
  );


  const results =
    await runWithConcurrency(

      candidates,

      async (candidate) => {

        const hourly =
          await checkHourlyPattern(

            candidate,

            settings.hourlyMin,

            settings.patternLength,

            signal

          );


        return {

          ...candidate,

          hourly

        };

      },

      CONCURRENCY,

      (done, total) => {

        setProgress(
          done,
          total
        );

      },

      signal

    );


  return results.filter(
    (candidate) => {

      return (
        candidate &&
        candidate.hourly &&
        candidate.hourly.passes
      );

    }
  );

}


/* =========================================================
   DYNAMIC TABLE HEADER
========================================================= */

function renderTableHeader(
  settings
) {

  /*
   * These columns ALWAYS exist.
   */

  const headers = [

    "Symbol",

    "24H Volume",

    "1D %"

  ];


  /*
   * 1H columns ONLY exist when
   * 1H condition is enabled.
   */

  if (
    settings.hourlyEnabled
  ) {

    if (
      settings.patternLength === 3
    ) {

      headers.push(

        "1H -2",

        "1H -1",

        "1H Last"

      );

    } else {

      headers.push(

        "1H -3",

        "1H -2",

        "1H -1",

        "1H Last"

      );

    }

  }


  resultsHeadRow.innerHTML =
    headers
      .map(
        (header) =>
          `<th>${header}</th>`
      )
      .join("");

}


/* =========================================================
   FORMAT VOLUME
========================================================= */

function formatVolume(
  value
) {

  if (
    !Number.isFinite(value)
  ) {

    return "—";

  }


  if (
    value >=
    1_000_000_000
  ) {

    return `$${(
      value /
      1_000_000_000
    ).toFixed(2)}B`;

  }


  if (
    value >=
    1_000_000
  ) {

    return `$${(
      value /
      1_000_000
    ).toFixed(2)}M`;

  }


  if (
    value >=
    1_000
  ) {

    return `$${(
      value /
      1_000
    ).toFixed(2)}K`;

  }


  return `$${value.toFixed(0)}`;

}


/* =========================================================
   FORMAT PERCENT
========================================================= */

function formatPercent(
  value
) {

  if (
    !Number.isFinite(value)
  ) {

    return "—";

  }


  const prefix =
    value > 0
      ? "+"
      : "";


  return (
    `${prefix}${value.toFixed(2)}%`
  );

}


/* =========================================================
   HOURLY CELL
========================================================= */

function renderHourlyCell(
  candle
) {

  if (!candle) {

    return `
      <td class="muted">
        —
      </td>
    `;

  }


  const className =
    candle.green
      ? "green"
      : candle.red
        ? "red"
        : "muted";


  const emoji =
    candle.green
      ? "🟢"
      : candle.red
        ? "🔴"
        : "⚪";


  return `
    <td class="${className}">
      <span class="candle">
        ${emoji}
        ${formatPercent(
          candle.percent
        )}
      </span>
    </td>
  `;

}


/* =========================================================
   RENDER RESULTS
========================================================= */

function renderResults(
  results,
  settings
) {

  /*
   * Always regenerate headers first.
   */

  renderTableHeader(
    settings
  );


  resultCount.textContent =
    results.length;


  if (
    results.length === 0
  ) {

    const columnCount =
      3 +
      (
        settings.hourlyEnabled
          ? settings.patternLength
          : 0
      );


    resultsBody.innerHTML = `
      <tr>
        <td
          colspan="${columnCount}"
          class="empty"
        >
          No matching pairs found.
        </td>
      </tr>
    `;


    return;

  }


  resultsBody.innerHTML =
    results
      .map(
        (candidate) => {

          /*
           * If 1D is OFF:
           * show dash instead of fake data.
           */

          const dailyHtml =
            candidate.daily
              ? `
                <td class="green">
                  ${formatPercent(
                    candidate.daily.percent
                  )}
                </td>
              `
              : `
                <td class="muted">
                  —
                </td>
              `;


          /*
           * IMPORTANT:
           *
           * If 1H is OFF, this remains
           * an EMPTY STRING.
           *
           * No 1H columns.
           */

          let hourlyHtml = "";


          if (
            settings.hourlyEnabled
          ) {

            const candles =
              candidate.hourly?.candles ||
              [];


            hourlyHtml =
              candles
                .map(
                  renderHourlyCell
                )
                .join("");

          }


          return `
            <tr>

              <td class="symbol">
                ${escapeHtml(
                  candidate.symbol
                )}
              </td>


              <td class="volume">
                ${formatVolume(
                  candidate.quoteVolume
                )}
              </td>


              ${dailyHtml}


              ${hourlyHtml}

            </tr>
          `;

        }
      )
      .join("");

}


/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHtml(
  value
) {

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


/* =========================================================
   CSV ESCAPE
========================================================= */

function csvEscape(
  value
) {

  const stringValue =
    String(
      value ?? ""
    );


  return `"${stringValue.replaceAll(
    '"',
    '""'
  )}"`;

}


/* =========================================================
   EXPORT CSV
========================================================= */

function exportCSV() {

  if (
    !lastResults.length ||
    !lastSettings
  ) {

    return;

  }


  const settings =
    lastSettings;


  const headers = [

    "Symbol",

    "24H Quote Volume",

    "1D %"

  ];


  /*
   * Add hourly CSV columns ONLY
   * when hourly checking is ON.
   */

  if (
    settings.hourlyEnabled
  ) {

    if (
      settings.patternLength === 3
    ) {

      headers.push(

        "1H -2 %",

        "1H -1 %",

        "1H Last %"

      );

    } else {

      headers.push(

        "1H -3 %",

        "1H -2 %",

        "1H -1 %",

        "1H Last %"

      );

    }

  }


  const rows = [

    headers,

    ...lastResults.map(
      (candidate) => {

        const row = [

          candidate.symbol,

          candidate.quoteVolume,

          candidate.daily
            ? candidate.daily.percent
            : ""

        ];


        /*
         * Only add hourly CSV values
         * when hourly is enabled.
         */

        if (
          settings.hourlyEnabled
        ) {

          const candles =
            candidate.hourly?.candles ||
            [];


          candles.forEach(
            (candle) => {

              row.push(
                candle
                  ? candle.percent
                  : ""
              );

            }
          );

        }


        return row;

      }
    )

  ];


  const csv =
    rows
      .map(
        (row) =>
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


  link.href =
    url;


  link.download =
    `binance-momentum-scanner-v${VERSION}.csv`;


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
   MAIN SCAN
========================================================= */

async function startScan() {

  if (
    abortController
  ) {

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


  abortController =
    new AbortController();


  lastResults = [];

  lastSettings =
    settings;


  exportBtn.disabled =
    true;


  statSymbols.textContent =
    "—";

  statSpot.textContent =
    "—";

  statCandidates.textContent =
    "—";

  statMatches.textContent =
    "—";


  resultCount.textContent =
    "0";


  /*
   * Build correct table BEFORE scan.
   */

  renderTableHeader(
    settings
  );


  const columnCount =
    3 +
    (
      settings.hourlyEnabled
        ? settings.patternLength
        : 0
    );


  resultsBody.innerHTML = `
    <tr>
      <td
        colspan="${columnCount}"
        class="empty"
      >
        Scanning...
      </td>
    </tr>
  `;


  setProgress(
    0,
    0
  );


  setRunning(
    true
  );


  try {

    /*
     * =====================================================
     * CONDITIONS
     * =====================================================
     */

    const conditionText = [];


    conditionText.push(
      settings.dailyEnabled
        ? `1D ≥ ${settings.dailyMin}%`
        : "1D OFF"
    );


    if (
      settings.hourlyEnabled
    ) {

      conditionText.push(
        settings.patternLength === 3
          ? "1H RED → RED → GREEN"
          : "1H RED → RED → RED → GREEN"
      );

    } else {

      conditionText.push(
        "1H OFF"
      );

    }


    /*
     * =====================================================
     * STEP 1
     * EXCHANGE INFO
     * =====================================================
     */

    setStatus(
      "running",
      "Loading Binance symbols",
      "Verifying Binance Spot USDT pairs."
    );


    const {
      allSymbols,
      spotSymbols
    } =
      await getSpotSymbols(
        abortController.signal
      );


    statSymbols.textContent =
      allSymbols.length
        .toLocaleString();


    statSpot.textContent =
      spotSymbols.length
        .toLocaleString();


    /*
     * =====================================================
     * STEP 2
     * 24H TICKERS
     * =====================================================
     */

    setStatus(
      "running",
      "Loading 24H market data",
      "Fetching Binance 24H ticker data."
    );


    const tickers =
      await getAll24hTickers(
        abortController.signal
      );


    const tickerMap =
      new Map();


    tickers.forEach(
      (ticker) => {

        if (
          ticker &&
          ticker.symbol
        ) {

          tickerMap.set(
            ticker.symbol,
            ticker
          );

        }

      }
    );


    /*
     * =====================================================
     * STEP 3
     * VOLUME FILTER
     * =====================================================
     */

    setStatus(
      "running",
      "Filtering by 24H volume",
      `Minimum volume: $${settings.volumeMin}M`
    );


    const volumeCandidates =
      buildVolumeCandidates(
        spotSymbols,
        tickerMap,
        settings.volumeMin
      );


    /*
     * =====================================================
     * STEP 4
     * OPTIONAL 1D
     * =====================================================
     *
     * If OFF:
     * scanDailyCandidates() immediately returns.
     *
     * NO 1D REQUEST.
     */

    setProgress(
      0,
      settings.dailyEnabled
        ? volumeCandidates.length
        : 1
    );


    const dailyCandidates =
      await scanDailyCandidates(
        volumeCandidates,
        settings,
        abortController.signal
      );


    if (
      abortController.signal.aborted
    ) {

      throw new DOMException(
        "Scan stopped",
        "AbortError"
      );

    }


    statCandidates.textContent =
      dailyCandidates.length
        .toLocaleString();


    /*
     * =====================================================
     * STEP 5
     * OPTIONAL 1H
     * =====================================================
     *
     * If OFF:
     * scanHourlyCandidates() immediately returns.
     *
     * NO 1H REQUEST.
     * NO PATTERN MATCHING.
     */

    const finalResults =
      await scanHourlyCandidates(
        dailyCandidates,
        settings,
        abortController.signal
      );


    if (
      abortController.signal.aborted
    ) {

      throw new DOMException(
        "Scan stopped",
        "AbortError"
      );

    }


    /*
     * =====================================================
     * STEP 6
     * SORT
     * =====================================================
     *
     * 1D ON:
     *     Sort by daily % descending.
     *
     * 1D OFF:
     *     Sort by 24H volume descending.
     */

    if (
      settings.dailyEnabled
    ) {

      finalResults.sort(
        (a, b) => {

          return (
            (b.daily?.percent ??
              -Infinity) -
            (a.daily?.percent ??
              -Infinity)
          );

        }
      );

    } else {

      finalResults.sort(
        (a, b) => {

          return (
            b.quoteVolume -
            a.quoteVolume
          );

        }
      );

    }


    /*
     * =====================================================
     * STEP 7
     * LIMIT RESULTS
     * =====================================================
     */

    const limitedResults =
      finalResults.slice(
        0,
        settings.maxResults
      );


    lastResults =
      limitedResults;


    /*
     * =====================================================
     * STATS
     * =====================================================
     */

    statMatches.textContent =
      limitedResults.length
        .toLocaleString();


    /*
     * =====================================================
     * DESCRIPTION
     * =====================================================
     */

    let description = "";


    if (
      settings.dailyEnabled &&
      settings.hourlyEnabled
    ) {

      description =
        `1D ≥ ${settings.dailyMin}% • ` +
        `Volume ≥ $${settings.volumeMin}M • ` +
        (
          settings.patternLength === 3
            ? "1H RED → RED → GREEN"
            : "1H RED → RED → RED → GREEN"
        );

    } else if (
      settings.dailyEnabled &&
      !settings.hourlyEnabled
    ) {

      description =
        `1D ≥ ${settings.dailyMin}% • ` +
        `Volume ≥ $${settings.volumeMin}M • ` +
        `1H OFF`;

    } else if (
      !settings.dailyEnabled &&
      settings.hourlyEnabled
    ) {

      description =
        `Volume ≥ $${settings.volumeMin}M • ` +
        (
          settings.patternLength === 3
            ? "1H RED → RED → GREEN"
            : "1H RED → RED → RED → GREEN"
        ) +
        ` • 1D OFF`;

    } else {

      description =
        `Volume ≥ $${settings.volumeMin}M • ` +
        `1D OFF • 1H OFF`;

    }


    resultsDescription.textContent =
      `${limitedResults.length} result(s) • ${description}`;


    /*
     * =====================================================
     * RENDER
     * =====================================================
     */

    renderResults(
      limitedResults,
      settings
    );


    setProgress(
      1,
      1
    );


    setStatus(
      "success",
      "Scanning complete",
      `${limitedResults.length} matching pair(s) found.`
    );


    exportBtn.disabled =
      limitedResults.length === 0;


  } catch (error) {

    if (
      error.name ===
      "AbortError"
    ) {

      setStatus(
        "stopped",
        "Scan stopped",
        "The scan was stopped by the user."
      );


      return;

    }


    console.error(
      "Scanner error:",
      error
    );


    setStatus(
      "error",
      "Scan failed",
      error.message ||
        "An unexpected error occurred."
    );


  } finally {

    abortController =
      null;


    setRunning(
      false
    );


    updateConditionControls();

  }

}


/* =========================================================
   STOP
========================================================= */

function stopScan() {

  if (
    !abortController
  ) {

    return;

  }


  abortController.abort();


  setStatus(
    "stopped",
    "Stopping scan",
    "Cancelling active Binance requests..."
  );

}


/* =========================================================
   EVENTS
========================================================= */

enableDaily.addEventListener(
  "change",
  updateConditionControls
);


enableHourly.addEventListener(
  "change",
  updateConditionControls
);


patternLengthInput.addEventListener(
  "change",
  updateConditionControls
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


/* =========================================================
   INITIALIZE
========================================================= */

updateConditionControls();

setProgress(
  0,
  0
);
