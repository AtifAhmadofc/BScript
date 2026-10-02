const API = "https://api.binance.com";

let stopped = false;
let results = [];
let refreshTimer = null;


/* =====================================================
   DOM HELPERS
===================================================== */

const $ = (id) => document.getElementById(id);

function setStatus(text, type = "idle") {
  $("statusText").textContent = text;

  const dot = $("statusDot");

  dot.className = "status-dot " + type;
}


function setProgress(percent, text) {
  $("progressBar").style.width =
    `${Math.max(0, Math.min(100, percent))}%`;

  $("progressText").textContent = text;
}


/* =====================================================
   BINANCE API
===================================================== */

async function getJSON(endpoint, params = {}) {

  const url = new URL(API + endpoint);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(
    url.toString(),
    {
      cache: "no-store"
    }
  );

  if (!response.ok) {

    let message =
      `Binance API error ${response.status}`;

    try {
      const error =
        await response.json();

      if (error.msg) {
        message += `: ${error.msg}`;
      }

    } catch (_) {}

    throw new Error(message);
  }

  return response.json();
}


/* =====================================================
   STRICT SPOT VALIDATION
===================================================== */

/*
IMPORTANT:

We NEVER assume a symbol is Spot.

The symbol must satisfy:

status = TRADING
quoteAsset = USDT
explicit SPOT permission

If Spot permission is missing,
the symbol is rejected.
*/

function hasSpotPermission(symbol) {

  if (
    Array.isArray(symbol.permissions) &&
    symbol.permissions.includes("SPOT")
  ) {
    return true;
  }


  if (
    Array.isArray(symbol.permissionsSets)
  ) {

    if (
      symbol.permissionsSets.some(
        set =>
          Array.isArray(set) &&
          set.includes("SPOT")
      )
    ) {
      return true;
    }
  }


  if (
    Array.isArray(symbol.permissionSets)
  ) {

    if (
      symbol.permissionSets.some(
        set =>
          Array.isArray(set) &&
          set.includes("SPOT")
      )
    ) {
      return true;
    }
  }


  return false;
}


/* =====================================================
   GET BINANCE SPOT USDT SYMBOLS
===================================================== */

async function getSpotUSDTMarkets() {

  const info =
    await getJSON(
      "/api/v3/exchangeInfo"
    );

  const all =
    info.symbols || [];


  let tradingCount = 0;
  let usdtCount = 0;
  let spotCount = 0;


  const symbols = [];


  for (const symbol of all) {

    /*
    1. Must be actively trading
    */

    if (symbol.status !== "TRADING") {
      continue;
    }

    tradingCount++;


    /*
    2. Must be USDT pair
    */

    if (symbol.quoteAsset !== "USDT") {
      continue;
    }

    usdtCount++;


    /*
    3. MUST explicitly be Spot
    */

    if (!hasSpotPermission(symbol)) {
      continue;
    }

    spotCount++;

    symbols.push(
      symbol.symbol
    );
  }


  return {

    symbols,

    stats: {
      total: all.length,
      trading: tradingCount,
      usdt: usdtCount,
      spot: spotCount
    }
  };
}


/* =====================================================
   24H TICKERS
===================================================== */

async function get24hTickers() {

  const tickers =
    await getJSON(
      "/api/v3/ticker/24hr"
    );

  const map =
    new Map();


  for (const ticker of tickers) {

    map.set(
      ticker.symbol,
      {
        volume:
          Number(
            ticker.quoteVolume || 0
          ),

        lastPrice:
          Number(
            ticker.lastPrice || 0
          )
      }
    );
  }


  return map;
}


/* =====================================================
   CANDLE HELPERS
===================================================== */

function isCompleted(candle) {

  const closeTime =
    Number(candle[6]);

  return closeTime <= Date.now();
}


function removeIncompleteCandles(candles) {

  return candles.filter(
    isCompleted
  );
}


function isGreen(candle) {

  return (
    Number(candle[4]) >
    Number(candle[1])
  );
}


function isRed(candle) {

  return (
    Number(candle[4]) <
    Number(candle[1])
  );
}


function candleChange(candle) {

  const open =
    Number(candle[1]);

  const close =
    Number(candle[4]);


  if (!open) {
    return 0;
  }


  return (
    (close - open) /
    open *
    100
  );
}


/* =====================================================
   GET KLINES
===================================================== */

async function getCandles(
  symbol,
  interval,
  limit
) {

  const candles =
    await getJSON(
      "/api/v3/klines",
      {
        symbol,
        interval,
        limit
      }
    );


  return removeIncompleteCandles(
    candles
  );
}


/* =====================================================
   FORMATTERS
===================================================== */

function formatPercent(value) {

  return (
    value >= 0
      ? "+"
      : ""
  ) +
  value.toFixed(2) +
  "%";
}


function formatVolume(value) {

  if (value >= 1e9) {

    return (
      "$" +
      (value / 1e9)
        .toFixed(2) +
      "B"
    );
  }


  if (value >= 1e6) {

    return (
      "$" +
      (value / 1e6)
        .toFixed(2) +
      "M"
    );
  }


  if (value >= 1e3) {

    return (
      "$" +
      (value / 1e3)
        .toFixed(1) +
      "K"
    );
  }


  return (
    "$" +
    value.toFixed(0)
  );
}


/* =====================================================
   DAILY CANDLE
===================================================== */

async function getDailyCandle(
  symbol,
  mode
) {

  const candles =
    await getJSON(
      "/api/v3/klines",
      {
        symbol,
        interval: "1d",
        limit: 3
      }
    );


  /*
  Current day mode:

  Binance returns the currently
  forming daily candle as the last item.
  */

  if (mode === "current") {

    return candles[
      candles.length - 1
    ];
  }


  /*
  Completed day mode:

  Remove current candle if incomplete,
  then take latest completed candle.
  */

  const completed =
    removeIncompleteCandles(
      candles
    );


  if (!completed.length) {
    return null;
  }


  return completed[
    completed.length - 1
  ];
}


/* =====================================================
   SCAN
===================================================== */

async function scan() {

  stopped = false;


  $("scanBtn").disabled = true;
  $("stopBtn").disabled = false;
  $("exportBtn").disabled = true;


  results = [];


  $("pairsScanned").textContent = "—";
  $("dailyCandidates").textContent = "—";
  $("matchCount").textContent = "—";


  $("diagScanned").textContent = "0";
  $("diagVolume").textContent = "0";
  $("diagDaily").textContent = "0";
  $("diagHourly").textContent = "0";
  $("diagMatches").textContent = "0";


  setStatus(
    "Loading Binance Spot markets…",
    "working"
  );


  try {

    const dailyMinimum =
      Number(
        $("dailyMin").value
      );


    const volumeMinimum =
      Number(
        $("volumeMin").value
      );


    const hourlyMinimum =
      Number(
        $("hourGreenMin").value
      );


    const dailyMode =
      $("dailyMode").value;


    const maximumResults =
      Math.max(
        1,
        Math.min(
          100,
          Number(
            $("maxResults").value
          ) || 20
        )
      );


    /* ================================================
       GET STRICT SPOT UNIVERSE
    ================================================ */

    const [
      marketData,
      tickerMap
    ] =
      await Promise.all([
        getSpotUSDTMarkets(),
        get24hTickers()
      ]);


    const symbols =
      marketData.symbols;


    const stats =
      marketData.stats;


    $("pairsScanned").textContent =
      symbols.length;


    setProgress(
      0,
      `Found ${symbols.length} active Binance Spot USDT pairs.`
    );


    /* ================================================
       DAILY FILTER
    ================================================ */

    const dailyCandidates = [];


    let scanned = 0;
    let volumeQualified = 0;


    const queue =
      [...symbols];


    /*
    Limit concurrency.
    */

    const workerCount = 8;


    async function dailyWorker() {

      while (
        queue.length &&
        !stopped
      ) {

        const symbol =
          queue.shift();


        try {

          const ticker =
            tickerMap.get(symbol);


          /*
          Volume filter FIRST
          */

          if (
            !ticker ||
            ticker.volume <
              volumeMinimum
          ) {

            scanned++;

            $("diagScanned").textContent =
              scanned;

            continue;
          }


          volumeQualified++;


          $("diagVolume").textContent =
            volumeQualified;


          /*
          Get daily candle
          */

          const candle =
            await getDailyCandle(
              symbol,
              dailyMode
            );


          if (!candle) {
            continue;
          }


          const dailyChange =
            candleChange(
              candle
            );


          /*
          Must be GREEN
          */

          if (!isGreen(candle)) {
            continue;
          }


          /*
          Must meet daily %
          */

          if (
            dailyChange <
            dailyMinimum
          ) {
            continue;
          }


          dailyCandidates.push({

            symbol,

            daily:
              dailyChange,

            volume:
              ticker.volume
          });


          $("diagDaily").textContent =
            dailyCandidates.length;


        } catch (error) {

          console.warn(
            "Daily error:",
            symbol,
            error
          );

        } finally {

          scanned++;

          $("diagScanned").textContent =
            scanned;


          if (
            scanned % 5 === 0 ||
            scanned === symbols.length
          ) {

            setProgress(

              (
                scanned /
                symbols.length
              ) * 60,

              `Scanning 1D: ${scanned}/${symbols.length} • Daily qualified: ${dailyCandidates.length}`
            );
          }
        }
      }
    }


    await Promise.all(
      Array.from(
        {
          length:
            workerCount
        },
        dailyWorker
      )
    );


    $("dailyCandidates").textContent =
      dailyCandidates.length;


    if (stopped) {

      setStatus(
        "Stopped",
        "idle"
      );

      return;
    }


    /* ================================================
       HOURLY FILTER
    ================================================ */

    setStatus(
      "Checking 1H pattern…",
      "working"
    );


    const hourlyQueue =
      [...dailyCandidates];


    let hourlyChecked = 0;


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


          /*
          Need at least 3 completed candles
          */

          if (
            candles.length < 3
          ) {
            continue;
          }


          /*
          Latest three completed candles

          -2 = older RED
          -1 = newer RED
          Last = GREEN
          */

          const candle2 =
            candles[
              candles.length - 3
            ];


          const candle1 =
            candles[
              candles.length - 2
            ];


          const candleLast =
            candles[
              candles.length - 1
            ];


          const change2 =
            candleChange(
              candle2
            );


          const change1 =
            candleChange(
              candle1
            );


          const changeLast =
            candleChange(
              candleLast
            );


          /*
          EXACT PATTERN:

          RED
          RED
          GREEN
          */

          if (
            isRed(candle2) &&
            isRed(candle1) &&
            isGreen(candleLast) &&
            changeLast >=
              hourlyMinimum
          ) {

            results.push({

              symbol:
                candidate.symbol,

              daily:
                candidate.daily,

              h2:
                change2,

              h1:
                change1,

              h0:
                changeLast,

              volume:
                candidate.volume
            });


            $("diagHourly").textContent =
              results.length;


            $("diagMatches").textContent =
              results.length;
          }


        } catch (error) {

          console.warn(
            "1H error:",
            candidate.symbol,
            error
          );

        } finally {

          hourlyChecked++;


          if (
            hourlyChecked % 2 === 0 ||
            hourlyChecked ===
              dailyCandidates.length
          ) {

            setProgress(

              60 +
              (
                hourlyChecked /
                Math.max(
                  1,
                  dailyCandidates.length
                )
              ) * 40,

              `Checking 1H: ${hourlyChecked}/${dailyCandidates.length} • Exact matches: ${results.length}`
            );
          }
        }
      }
    }


    await Promise.all(
      Array.from(
        {
          length:
            workerCount
        },
        hourlyWorker
      )
    );


    if (stopped) {

      setStatus(
        "Stopped",
        "idle"
      );

      return;
    }


    /* ================================================
       SORT + LIMIT
    ================================================ */

    results.sort(
      (a, b) =>
        b.daily -
        a.daily
    );


    results =
      results.slice(
        0,
        maximumResults
      );


    /* ================================================
       UPDATE UI
    ================================================ */

    renderResults();


    $("dailyCandidates").textContent =
      dailyCandidates.length;


    $("matchCount").textContent =
      results.length;


    $("diagMatches").textContent =
      results.length;


    $("lastScan").textContent =
      new Date().toLocaleTimeString();


    setProgress(
      100,

      `Finished • ${symbols.length} Spot USDT pairs → ${dailyCandidates.length} daily candidates → ${results.length} matches`
    );


    setStatus(
      `${results.length} match${
        results.length === 1
          ? ""
          : "es"
      } found`,
      results.length
        ? "success"
        : "idle"
    );


    if (results.length) {
      $("exportBtn").disabled =
        false;
    }


  } catch (error) {

    console.error(error);


    setStatus(
      "Scanner error",
      "error"
    );


    $("progressText").textContent =
      error.message;


  } finally {

    $("scanBtn").disabled =
      false;

    $("stopBtn").disabled =
      true;
  }
}


/* =====================================================
   RENDER RESULTS
===================================================== */

function renderResults() {

  const body =
    $("resultsBody");


  if (!results.length) {

    body.innerHTML = `
      <tr class="empty">
        <td colspan="8">
          No Binance Spot USDT pair currently
          matches all conditions.
        </td>
      </tr>
    `;

    return;
  }


  body.innerHTML =
    results
      .map(
        (r, index) => {

          return `
            <tr>

              <td>
                ${index + 1}
              </td>

              <td>
                <strong>
                  ${r.symbol}
                </strong>

                <span class="spot-badge">
                  ✓ SPOT
                </span>
              </td>

              <td class="green">
                ${formatPercent(
                  r.daily
                )}
              </td>

              <td class="red">
                ${formatPercent(
                  r.h2
                )}
              </td>

              <td class="red">
                ${formatPercent(
                  r.h1
                )}
              </td>

              <td class="green">
                ${formatPercent(
                  r.h0
                )}
              </td>

              <td>
                ${formatVolume(
                  r.volume
                )}
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
          `;
        }
      )
      .join("");
}


/* =====================================================
   CSV EXPORT
===================================================== */

function exportCSV() {

  if (!results.length) {
    return;
  }


  const rows = [

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

      rows.push([

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
    rows
      .map(
        row =>
          row
            .map(
              value =>
                `"${String(value)
                  .replaceAll(
                    '"',
                    '""'
                  )}"`
            )
            .join(",")
      )
      .join("\n");


  const blob =
    new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8"
      }
    );


  const url =
    URL.createObjectURL(
      blob
    );


  const link =
    document.createElement("a");


  link.href = url;

  link.download =
    "binance-spot-scanner.csv";


  document.body.appendChild(
    link
  );

  link.click();

  link.remove();


  URL.revokeObjectURL(
    url
  );
}


/* =====================================================
   STOP
===================================================== */

$("stopBtn").onclick =
  () => {

    stopped = true;

    setStatus(
      "Stopping…",
      "idle"
    );
  };


/* =====================================================
   AUTO REFRESH
===================================================== */

$("autoRefresh").addEventListener(
  "change",
  () => {

    const enabled =
      $("autoRefresh").checked;


    $("refreshMinutes").disabled =
      !enabled;


    if (refreshTimer) {

      clearInterval(
        refreshTimer
      );

      refreshTimer = null;
    }


    if (enabled) {

      const minutes =
        Number(
          $("refreshMinutes").value
        );


      refreshTimer =
        setInterval(
          () => {

            if (
              !$("scanBtn").disabled
            ) {

              scan();
            }

          },
          minutes *
          60 *
          1000
        );
    }
  }
);


$("refreshMinutes").addEventListener(
  "change",
  () => {

    if (
      $("autoRefresh").checked
    ) {

      $("autoRefresh").dispatchEvent(
        new Event("change")
      );

      $("autoRefresh").dispatchEvent(
        new Event("change")
      );
    }
  }
);


/* =====================================================
   BUTTONS
===================================================== */

$("scanBtn").onclick =
  scan;


$("exportBtn").onclick =
  exportCSV;