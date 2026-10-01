const API = "https://api.binance.com";
let stopRequested = false;
let currentResults = [];
let refreshTimer = null;

const $ = id => document.getElementById(id);

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function setStatus(text, type="idle"){
  $("statusText").textContent = text;
  $("statusDot").className = `status-dot ${type}`;
}

function setProgress(done,total,text){
  const pct = total ? Math.round(done / total * 100) : 0;
  $("progressBar").style.width = `${pct}%`;
  $("progressText").textContent = text || `${done}/${total}`;
}

async function getJSON(url, params={}){
  const u = new URL(url);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k,v));
  const res = await fetch(u.toString(), {cache:"no-store"});
  if(!res.ok){
    let msg = `HTTP ${res.status}`;
    try{
      const body = await res.json();
      if(body.msg) msg += `: ${body.msg}`;
    }catch{}
    throw new Error(msg);
  }
  return res.json();
}

function isCompleted(candle){
  return Number(candle[6]) <= Date.now();
}

function isGreen(candle){ return Number(candle[4]) > Number(candle[1]); }
function isRed(candle){ return Number(candle[4]) < Number(candle[1]); }

function pct(candle){
  const o = Number(candle[1]), c = Number(candle[4]);
  return ((c-o)/o)*100;
}

function fmtPct(n){
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtVol(n){
  if(n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if(n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if(n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

async function getSymbols(){
  const info = await getJSON(`${API}/api/v3/exchangeInfo`);
  return info.symbols.filter(s =>
    s.status === "TRADING" &&
    s.quoteAsset === "USDT" &&
    (
      Array.isArray(s.permissions) ? s.permissions.includes("SPOT") :
      Array.isArray(s.permissionSets) ? s.permissionSets.some(x => Array.isArray(x) && x.includes("SPOT")) :
      true
    )
  ).map(s => s.symbol);
}

async function get24hTickers(){
  const data = await getJSON(`${API}/api/v3/ticker/24hr`);
  const map = new Map();
  for(const x of data) map.set(x.symbol, Number(x.quoteVolume || 0));
  return map;
}

/*
  Binance's REST kline endpoint is symbol-specific. This scanner deliberately
  uses completed 1D candles rather than the rolling 24h ticker as the primary
  +20% test, so the signal matches the requested "one day candle" rule.
*/
async function getLastCandles(symbol, interval, limit=4){
  const data = await getJSON(`${API}/api/v3/klines`, {
    symbol, interval, limit
  });
  return data.filter(isCompleted);
}

function render(results){
  currentResults = results;
  $("matchCount").textContent = results.length;
  const body = $("resultsBody");

  if(!results.length){
    body.innerHTML = `<tr class="empty"><td colspan="8">No coins currently match all filters.</td></tr>`;
    $("exportBtn").disabled = true;
    return;
  }

  $("exportBtn").disabled = false;
  body.innerHTML = results.map((r,i) => `
    <tr>
      <td>${i+1}</td>
      <td><span class="coin">${r.symbol.replace("USDT","")}<small>USDT</small></span></td>
      <td class="green">${fmtPct(r.daily)}</td>
      <td class="red">${fmtPct(r.h2)}</td>
      <td class="red">${fmtPct(r.h1)}</td>
      <td class="green">${fmtPct(r.h0)}</td>
      <td>${fmtVol(r.volume)}</td>
      <td><a class="chart" target="_blank" rel="noopener" href="https://www.binance.com/en/trade/${r.symbol}?type=spot">Open ↗</a></td>
    </tr>
  `).join("");
}

async function scan(){
  stopRequested = false;
  $("scanBtn").disabled = true;
  $("stopBtn").disabled = false;
  $("exportBtn").disabled = true;
  setStatus("Scanning…","busy");
  $("progressBar").style.width = "0%";

  const dailyMin = Number($("dailyMin").value);
  const volumeMin = Number($("volumeMin").value);
  const hourGreenMin = Number($("hourGreenMin").value);
  const maxResults = Math.max(1, Number($("maxResults").value) || 20);

  try{
    const [symbols, volumeMap] = await Promise.all([getSymbols(), get24hTickers()]);
    $("pairsScanned").textContent = symbols.length;
    setProgress(0, symbols.length, `Checking completed 1D candles for ${symbols.length} Spot USDT pairs…`);

    const dailyCandidates = [];
    let done = 0;

    // Concurrency is intentionally moderate to reduce 429/rate-limit risk.
    const queue = [...symbols];
    const workers = Array.from({length: 6}, async () => {
      while(queue.length && !stopRequested){
        const symbol = queue.shift();
        try{
          const candles = await getLastCandles(symbol, "1d", 2);
          const c = candles[candles.length - 1];
          const volume = volumeMap.get(symbol) || 0;

          if(c && isGreen(c) && pct(c) >= dailyMin && volume >= volumeMin){
            dailyCandidates.push({symbol, daily:pct(c), volume});
          }
        }catch(e){
          // A single symbol failing should not abort the complete scan.
        }finally{
          done++;
          if(done % 5 === 0 || done === symbols.length)
            setProgress(done, symbols.length, `1D scan: ${done}/${symbols.length} checked • ${dailyCandidates.length} candidates`);
        }
        await sleep(45);
      }
    });

    await Promise.all(workers);

    if(stopRequested){
      setStatus("Stopped","idle");
      setProgress(done, symbols.length, `Stopped after ${done}/${symbols.length} pairs.`);
      return;
    }

    $("dailyCandidates").textContent = dailyCandidates.length;
    setProgress(0, dailyCandidates.length, `Checking 1H candles for ${dailyCandidates.length} daily candidates…`);

    const matches = [];
    const queue2 = [...dailyCandidates];
    let done2 = 0;

    const workers2 = Array.from({length: 6}, async () => {
      while(queue2.length && !stopRequested){
        const candidate = queue2.shift();
        try{
          const candles = await getLastCandles(candidate.symbol, "1h", 5);
          if(candles.length >= 3){
            const h2 = candles[candles.length-3];
            const h1 = candles[candles.length-2];
            const h0 = candles[candles.length-1];

            if(isRed(h2) && isRed(h1) && isGreen(h0) && pct(h0) >= hourGreenMin){
              matches.push({
                symbol:candidate.symbol,
                daily:candidate.daily,
                h2:pct(h2),
                h1:pct(h1),
                h0:pct(h0),
                volume:candidate.volume
              });
            }
          }
        }catch(e){
        }finally{
          done2++;
          if(done2 % 3 === 0 || done2 === dailyCandidates.length)
            setProgress(done2, dailyCandidates.length, `1H scan: ${done2}/${dailyCandidates.length} checked • ${matches.length} matches`);
        }
        await sleep(45);
      }
    });

    await Promise.all(workers2);

    matches.sort((a,b) => b.daily - a.daily);
    render(matches.slice(0, maxResults));

    $("lastScan").textContent = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    setStatus(`${matches.length} match${matches.length===1?"":"es"} found`,"live");
    setProgress(dailyCandidates.length, dailyCandidates.length, `Finished • ${matches.length} exact match${matches.length===1?"":"es"}.`);

  }catch(err){
    console.error(err);
    setStatus("Scan failed","error");
    $("progressText").textContent = `Error: ${err.message}. Try again in a moment.`;
  }finally{
    $("scanBtn").disabled = false;
    $("stopBtn").disabled = true;
  }
}

function exportCSV(){
  if(!currentResults.length) return;
  const rows = [
    ["Rank","Symbol","1D %","1H -2 %","1H -1 %","1H Last %","24H Quote Volume"]
  ];
  currentResults.forEach((r,i) => rows.push([
    i+1,r.symbol,r.daily.toFixed(4),r.h2.toFixed(4),r.h1.toFixed(4),r.h0.toFixed(4),r.volume.toFixed(2)
  ]));
  const csv = rows.map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `binance-scanner-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("scanBtn").addEventListener("click", scan);
$("stopBtn").addEventListener("click", () => {
  stopRequested = true;
  $("stopBtn").disabled = true;
  setStatus("Stopping…","busy");
});

$("exportBtn").addEventListener("click", exportCSV);

$("autoRefresh").addEventListener("change", e => {
  $("refreshMinutes").disabled = !e.target.checked;
  if(refreshTimer) clearInterval(refreshTimer);
  if(e.target.checked){
    const mins = Number($("refreshMinutes").value);
    refreshTimer = setInterval(() => {
      if(!$("scanBtn").disabled) scan();
    }, mins * 60 * 1000);
  }
});

$("refreshMinutes").addEventListener("change", () => {
  if($("autoRefresh").checked){
    if(refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if(!$("scanBtn").disabled) scan();
    }, Number($("refreshMinutes").value) * 60 * 1000);
  }
});
