"use strict";


/*
=========================================================
BINANCE SPOT MOMENTUM SCANNER
=========================================================

CONDITIONS:

1. Binance Spot only
2. USDT quote asset
3. Symbol must be TRADING
4. Daily candle GREEN
5. Daily candle >= configured %
6. 24H quote volume >= configured amount
7. Latest 3 COMPLETED 1H candles:

      RED
      RED
      GREEN

Results are sorted by daily percentage.

=========================================================
*/


const BINANCE_API =
  "https://api.binance.com";


let stopped = false;

let matches = [];


/* =====================================================
   DOM
===================================================== */

const $ = (id) =>
  document.getElementById(id);


/* =====================================================
   STATUS
===================================================== */

function status(text) {

  $("status").textContent =
    text;

}


/* =====================================================
   PROGRESS
===================================================== */

function progress(percent, text) {

  $("progressBar").style.width =
    `${percent}%`;

  $("progressText").textContent =
    text;

}


/* =====================================================
   API REQUEST
===================================================== */

async function api(
  endpoint,
  params = {}
) {

  const url =
    new URL(
      BINANCE_API + endpoint
    );


  for (
    const [key, value]
    of Object.entries(params)
  ) {

    url.searchParams.set(
      key,
      value
    );

  }


  const response =
    await fetch(
      url.toString(),
      {
        cache: "no-store"
      }
    );


  if (!response.ok) {

    let message =
      `HTTP ${response.status}`;


    try {

      const error =
        await response.json();


      if (error.msg) {

        message +=
          ": " + error.msg;

      }

    } catch (_) {}


    throw new Error(
      message
    );
  }


  return response.json();

}


/* =====================================================
   CHECK SPOT PERMISSION
===================================================== */

function isSpot(symbol) {

  /*
  Binance commonly returns:

  permissions: ["SPOT"]

  or:

  permissions: ["SPOT", "MARGIN"]
  */


  if (
    Array.isArray(
      symbol.permissions
    )
  ) {

    return symbol.permissions
      .includes("SPOT");

  }


  /*
  Some Binance responses may use
  permissionsSets.
  */

  if (
    Array.isArray(
      symbol.permissionsSets
    )
  ) {

    return symbol.permissionsSets
      .some(
        set =>
          Array.isArray(set) &&
          set.includes("SPOT")
      );

  }


  /*
  Legacy spelling.
  */

  if (
    Array.isArray(
      symbol.permissionSets
    )
  ) {

    return symbol.permissionSets
      .some(
        set =>
          Array.isArray(set) &&
          set.includes("SPOT")
      );

  }


  /*
  VERY IMPORTANT:

  If we cannot verify Spot,
  reject the symbol.
  */

  return false;

}


/* =====================================================
   GET ONLY SPOT USDT
===================================================== */

async function getSpotUSDT() {

  const info =
    await api(
      "/api/v3/exchangeInfo"
    );


  const all =
    info.symbols || [];


  const symbols = [];


  for (
    const symbol
    of all
  ) {

    /*
    Must be trading
    */

    if (
      symbol.status !==
      "TRADING"
    ) {

      continue;

    }


    /*
    Must be USDT
    */

    if (
      symbol.quoteAsset !==
      "USDT"
    ) {

      continue;

    }


    /*
    Must explicitly be Spot
    */

    if (
      !isSpot(symbol)
    ) {

      continue;

    }


    symbols.push(
      symbol.symbol
    );

  }


  return {

    symbols,

    total:
      all.length

  };

}


/* =====================================================
   24H TICKERS
===================================================== */

async function getTickers() {

  const data =
    await api(
      "/api/v3/ticker/24hr"
    );


  const map =
    new Map();


  for (
    const item
    of data
  ) {

    map.set(
      item.symbol,
      {
        volume:
          Number(
            item.quoteVolume
          )
      }
    );

  }


  return map;

}


/* =====================================================
   CANDLES
===================================================== */

async function candles(
  symbol,
  interval,
  limit
) {

  const data =
    await api(
      "/api/v3/klines",
      {
        symbol,
        interval,
        limit
      }
    );


  /*
  Binance kline:

  [0] Open time
  [1] Open
  [2] High
  [3] Low
  [4] Close
  [5] Volume
  [6] Close time
  */


  /*
  Remove currently forming candle.
  */

  return data.filter(
    candle =>
      Number(candle[6])
      <= Date.now()
  );

}


/* =====================================================
   CANDLE CHANGE
===================================================== */

function change(candle) {

  const open =
    Number(candle[1]);


  const close =
    Number(candle[4]);


  if (
    open === 0
  ) {

    return 0;

  }


  return (
    (close - open)
    / open
  ) * 100;

}


/* =====================================================
   GREEN
===================================================== */

function green(candle) {

  return (
    Number(candle[4]) >
    Number(candle[1])
  );

}


/* =====================================================
   RED
===================================================== */

function red(candle) {

  return (
    Number(candle[4]) <
    Number(candle[1])
  );

}


/* =====================================================
   FORMAT %
===================================================== */

function percent(value) {

  return (
    value >= 0
      ? "+"
      : ""
  ) +
  value.toFixed(2) +
  "%";

}


/* =====================================================
   FORMAT VOLUME
===================================================== */

function volume(value) {

  if (
    value >= 1000000000
  ) {

    return (
      "$" +
      (
        value / 1000000000
      ).toFixed(2) +
      "B"
    );

  }


  if (
    value >= 1000000
  ) {

    return (
      "$" +
      (
        value / 1000000
      ).toFixed(2) +
      "M"
    );

  }


  if (
    value >= 1000
  ) {

    return (
      "$" +
      (
        value / 1000
      ).toFixed(1) +
      "K"
    );

  }


  return (
    "$" +
    value.toFixed(0)
  );

}


/* =====================================================
   SCAN
===================================================== */

async function scan() {

  stopped = false;

  matches = [];


  $("scanBtn").disabled =
    true;

  $("stopBtn").disabled =
    false;

  $("csvBtn").disabled =
    true;


  status(
    "Loading Binance Spot markets..."
  );


  progress(
    0,
    "Getting Binance Spot USDT pairs..."
  );


  try {

    /*
    ================================================
    SETTINGS
    ================================================
    */

    const dailyMinimum =
      Number(
        $("dailyMin").value
      );


    const volumeMinimum =
      Number(
        $("volumeMin").value
      );


    const hourMinimum =
      Number(
        $("hourMin").value
      );


    const maxResults =
      Math.min(
        100,
        Math.max(
          1,
          Number(
            $("maxResults").value
          )
        )
      );


    /*
    ================================================
    GET SPOT PAIRS
    ================================================
    */

    const [
      marketData,
      tickerData
    ] =
      await Promise.all([

        getSpotUSDT(),

        getTickers()

      ]);


    const symbols =
      marketData.symbols;


    const tickers =
      tickerData;


    $("totalSymbols").textContent =
      marketData.total;


    $("spotSymbols").textContent =
      symbols.length;


    progress(
      0,
      `Found ${symbols.length} Binance Spot USDT pairs.`
    );


    /*
    ================================================
    DAILY SCAN
    ================================================
    */

    const candidates = [];


    let scanned = 0;


    /*
    Process 8 at a time.
    */

    const queue =
      [...symbols];


    async function worker() {

      while (
        queue.length > 0 &&
        !stopped
      ) {

        const symbol =
          queue.shift();


        try {

          /*
          24H volume
          */

          const ticker =
            tickers.get(
              symbol
            );


          if (
            !ticker
          ) {

            continue;

          }


          /*
          Volume filter
          */

          if (
            ticker.volume <
            volumeMinimum
          ) {

            continue;

          }


          /*
          Get DAILY candle

          We use CURRENT daily candle.

          This means:

          Today open -> current price

          If it is already +20%,
          it qualifies.
          */

          const daily =
            await api(
              "/api/v3/klines",
              {
                symbol,
                interval: "1d",
                limit: 2
              }
            );


          if (
            !daily.length
          ) {

            continue;

          }


          /*
          Last candle is
          current daily candle.
          */

          const d =
            daily[
              daily.length - 1
            ];


          /*
          IMPORTANT:

          Daily must be GREEN.
          */

          if (
            !green(d)
          ) {

            continue;

          }


          const dailyChange =
            change(d);


          /*
          Daily >= 20%
          */

          if (
            dailyChange <
            dailyMinimum
          ) {

            continue;

          }


          candidates.push({

            symbol,

            daily:
              dailyChange,

            volume:
              ticker.volume

          });


        } catch (error) {

          console.warn(
            symbol,
            error
          );

        } finally {

          scanned++;


          if (
            scanned % 5 === 0 ||
            scanned === symbols.length
          ) {

            progress(

              (
                scanned /
                symbols.length
              ) * 60,

              `Checking daily candles: ${scanned}/${symbols.length} • Candidates: ${candidates.length}`
            );

          }

        }

      }

    }


    await Promise.all(
      Array.from(
        {
          length: 8
        },
        () => worker()
      )
    );


    $("dailyCandidates").textContent =
      candidates.length;


    if (stopped) {

      status(
        "Stopped"
      );

      return;

    }


    /*
    ================================================
    1H SCAN
    ================================================
    */

    status(
      "Checking 1H patterns..."
    );


    const hourlyQueue =
      [...candidates];


    let checked =
      0;


    async function hourlyWorker() {

      while (
        hourlyQueue.length > 0 &&
        !stopped
      ) {

        const candidate =
          hourlyQueue.shift();


        try {

          const data =
            await candles(
              candidate.symbol,
              "1h",
              5
            );


          /*
          Need at least
          3 completed candles.
          */

          if (
            data.length < 3
          ) {

            continue;

          }


          /*
          Latest three
          COMPLETED candles:

          A = older
          B = previous
          C = latest
          */

          const A =
            data[
              data.length - 3
            ];


          const B =
            data[
              data.length - 2
            ];


          const C =
            data[
              data.length - 1
            ];


          /*
          Required:

          A = RED
          B = RED
          C = GREEN
          */

          if (
            !red(A) ||
            !red(B) ||
            !green(C)
          ) {

            continue;

          }


          const cChange =
            change(C);


          /*
          Latest green candle
          must meet minimum.
          */

          if (
            cChange <
            hourMinimum
          ) {

            continue;

          }


          matches.push({

            symbol:
              candidate.symbol,

            daily:
              candidate.daily,

            h2:
              change(A),

            h1:
              change(B),

            h0:
              cChange,

            volume:
              candidate.volume

          });


        } catch (error) {

          console.warn(
            candidate.symbol,
            error
          );

        } finally {

          checked++;


          progress(

            60 +
            (
              checked /
              Math.max(
                1,
                candidates.length
              )
            ) * 40,

            `Checking 1H pattern: ${checked}/${candidates.length} • Matches: ${matches.length}`
          );

        }

      }

    }


    await Promise.all(
      Array.from(
        {
          length: 8
        },
        () => hourlyWorker()
      )
    );


    if (stopped) {

      status(
        "Stopped"
      );

      return;

    }


    /*
    ================================================
    SORT
    ================================================
    */

    matches.sort(
      (a, b) =>
        b.daily -
        a.daily
    );


    /*
    Only show requested number.
    */

    matches =
      matches.slice(
        0,
        maxResults
      );


    /*
    ================================================
    DISPLAY
    ================================================
    */

    render();


    $("matchCount").textContent =
      matches.length;


    progress(
      100,

      `Finished • ${symbols.length} Spot USDT pairs → ${candidates.length} daily candidates → ${matches.length} matches`
    );


    status(
      matches.length +
      " match" +
      (
        matches.length === 1
          ? ""
          : "es"
      )
    );


    if (
      matches.length
    ) {

      $("csvBtn").disabled =
        false;

    }

  } catch (error) {

    console.error(
      error
    );


    status(
      "ERROR"
    );


    progress(
      0,
      error.message
    );


    alert(
      "Scanner error:\n\n" +
      error.message
    );

  } finally {

    $("scanBtn").disabled =
      false;

    $("stopBtn").disabled =
      true;

  }

}


/* =====================================================
   RENDER
===================================================== */

function render() {

  const body =
    $("results");


  if (
    matches.length === 0
  ) {

    body.innerHTML = `

      <tr>

        <td
          colspan="9"
          class="empty"
        >

          No Binance Spot USDT pair
          currently matches all conditions.

        </td>

      </tr>

    `;

    return;

  }


  body.innerHTML =
    matches
      .map(
        (item, index) => `

          <tr>

            <td>
              ${index + 1}
            </td>


            <td>

              <strong>
                ${item.symbol}
              </strong>

            </td>


            <td>

              <span class="spot">
                ✓ SPOT
              </span>

            </td>


            <td class="green">

              ${percent(
                item.daily
              )}

            </td>


            <td class="red">

              ${percent(
                item.h2
              )}

            </td>


            <td class="red">

              ${percent(
                item.h1
              )}

            </td>


            <td class="green">

              ${percent(
                item.h0
              )}

            </td>


            <td>

              ${volume(
                item.volume
              )}

            </td>


            <td>

              <a
                class="chart"
                target="_blank"
                href="https://www.binance.com/en/trade/${item.symbol}?type=spot"
              >

                Open ↗

              </a>

            </td>

          </tr>

        `
      )
      .join("");

}


/* =====================================================
   CSV
===================================================== */

function exportCSV() {

  if (
    !matches.length
  ) {

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
      "24H Volume"
    ]

  ];


  matches.forEach(
    (item, index) => {

      rows.push([

        index + 1,

        item.symbol,

        "BINANCE SPOT",

        item.daily.toFixed(2),

        item.h2.toFixed(2),

        item.h1.toFixed(2),

        item.h0.toFixed(2),

        item.volume.toFixed(2)

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
          "text/csv"
      }
    );


  const url =
    URL.createObjectURL(
      blob
    );


  const a =
    document.createElement(
      "a"
    );


  a.href = url;

  a.download =
    "binance-spot-results.csv";


  a.click();


  URL.revokeObjectURL(
    url
  );

}


/* =====================================================
   BUTTONS
===================================================== */

$("scanBtn").onclick =
  scan;


$("stopBtn").onclick =
  () => {

    stopped = true;

    status(
      "Stopping..."
    );

  };


$("csvBtn").onclick =
  exportCSV;