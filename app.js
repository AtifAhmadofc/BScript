const API = "https://api.binance.com";
let stopRequested = false;
let currentResults = [];
let refreshTimer = null;
let serverTime = Date.now();

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function setStatus(text, type="idle"){
  $("statusText").textContent = text;
  $("statusDot").className = `status-dot ${type}`;
}
function setProgress(done,total,text){
  const pct = total ? Math.round(done/total*100) : 0;
  $("progressBar").style.width = `${pct}%`;
  $("progressText").textContent = text || `${done}/${total}`;
}
async function getJSON(url, params={}){
  const u = new URL(url);
  for(const [k,v] of Object.entries(params)) u.searchParams.set(k,v);
  const res = await fetch(u.toString(), {cache:"no-store"});
  if(!res.ok){
    let msg = `HTTP ${res.status}`;
    try { const x=await res.json(); if(x.msg) msg += `: ${x.msg}`; } catch {}
    throw new Error(msg);
  }
  return res.json();
}
function isClosed(c){ return Number(c[6]) <= serverTime; }
function isGreen(c){ return Number(c[4]) > Number(c[1]); }
function isRed(c){ return Number(c[4]) < Number(c[1]); }
function change(c, closeOverride=null){
  const o=Number(c[1]), close=closeOverride===null?Number(c[4]):Number(closeOverride);
  return ((close-o)/o)*100;
}
function fmtPct(n){return `${n>=0?"+":""}${n.toFixed(2)}%`;}
function fmtVol(n){
  if(n>=1e9) return `$${(n/1e9).toFixed(2)}B`;
  if(n>=1e6) return `$${(n/1e6).toFixed(2)}M`;
  if(n>=1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

async function getServerTime(){
  const x=await getJSON(`${API}/api/v3/time`);
  serverTime=Number(x.serverTime);
}
async function getSymbols(){
  const info=await getJSON(`${API}/api/v3/exchangeInfo`);
  return info.symbols.filter(s =>
    s.status==="TRADING" &&
    s.quoteAsset==="USDT" &&
    Array.isArray(s.permissions) ? s.permissions.includes("SPOT") :
    Array.isArray(s.permissionSets) ? s.permissionSets.some(x=>Array.isArray(x)&&x.includes("SPOT")) : true
  ).map(s=>s.symbol);
}
async function get24hTickers(){
  const data=await getJSON(`${API}/api/v3/ticker/24hr`);
  const map=new Map();
  for(const x of data) map.set(x.symbol,{
    quoteVolume:Number(x.quoteVolume||0),
    lastPrice:Number(x.lastPrice||0),
    rolling24h:Number(x.priceChangePercent||0)
  });
  return map;
}
async function getKlines(symbol,interval,limit=5){
  return getJSON(`${API}/api/v3/klines`,{symbol,interval,limit});
}

function render(results){
  currentResults=results;
  $("matchCount").textContent=results.length;
  const body=$("resultsBody");
  if(!results.length){
    body.innerHTML=`<tr class="empty"><td colspan="8">No coins currently match all filters.</td></tr>`;
    $("exportBtn").disabled=true;
    return;
  }
  $("exportBtn").disabled=false;
  body.innerHTML=results.map((r,i)=>`
    <tr>
      <td>${i+1}</td>
      <td><span class="coin">${r.symbol.replace(/USDT$/,"")}<small>USDT</small></span></td>
      <td class="green">${fmtPct(r.daily)}</td>
      <td class="red">${fmtPct(r.h2)}</td>
      <td class="red">${fmtPct(r.h1)}</td>
      <td class="green">${fmtPct(r.h0)}</td>
      <td>${fmtVol(r.volume)}</td>
      <td><a class="chart" target="_blank" rel="noopener" href="https://www.binance.com/en/trade/${r.symbol}?type=spot">Open ↗</a></td>
    </tr>`).join("");
}

function renderDiagnostics(d){
  $("diagScanned").textContent=d.scanned;
  $("diagDaily").textContent=d.daily;
  $("diagVolume").textContent=d.volume;
  $("diagHourly").textContent=d.hourly;
  $("diagMatches").textContent=d.matches;
}

async function scan(){
  stopRequested=false;
  $("scanBtn").disabled=true;
  $("stopBtn").disabled=false;
  $("exportBtn").disabled=true;
  setStatus("Scanning…","busy");

  const dailyMin=Math.max(0,Number($("dailyMin").value)||20);
  const volumeMin=Math.max(0,Number($("volumeMin").value)||0);
  const hourGreenMin=Math.max(0,Number($("hourGreenMin").value)||0);
  const maxResults=Math.min(100,Math.max(1,Number($("maxResults").value)||20));
  const dailyMode=$("dailyMode").value; // current or completed

  const diag={scanned:0,daily:0,volume:0,hourly:0,matches:0};
  renderDiagnostics(diag);

  try{
    await getServerTime();
    const [symbols,tickers]=await Promise.all([getSymbols(),get24hTickers()]);
    $("pairsScanned").textContent=symbols.length;
    setProgress(0,symbols.length,`Checking ${dailyMode==="current"?"current":"completed"} 1D candles for ${symbols.length} Spot USDT pairs…`);

    const dailyCandidates=[];
    const queue=[...symbols];
    const workers=Array.from({length:5},async()=>{
      while(queue.length&&!stopRequested){
        const symbol=queue.shift();
        try{
          const t=tickers.get(symbol);
          if(!t || t.quoteVolume<volumeMin) continue;
          diag.volume++;

          const ks=await getKlines(symbol,"1d",2);
          const current=ks[ks.length-1];
          const closed=ks.filter(isClosed);
          const c=dailyMode==="current" ? current : closed[closed.length-1];

          if(!c) continue;

          let dailyPct;
          if(dailyMode==="current"){
            // Current 1D candle: open -> current last traded price.
            dailyPct=change(c,t.lastPrice);
          }else{
            dailyPct=change(c);
          }

          if(dailyPct>=dailyMin && (dailyMode==="current" ? t.lastPrice>Number(c[1]) : isGreen(c))){
            diag.daily++;
            dailyCandidates.push({
              symbol,daily:dailyPct,volume:t.quoteVolume
            });
          }
        }catch(e){
          // Ignore individual symbol failures.
        }finally{
          diag.scanned++;
          if(diag.scanned%5===0||diag.scanned===symbols.length){
            setProgress(diag.scanned,symbols.length,
              `1D: ${diag.scanned}/${symbols.length} • Daily +${dailyMin}%: ${dailyCandidates.length} • Volume OK: ${diag.volume}`);
            renderDiagnostics(diag);
          }
        }
        await sleep(55);
      }
    });
    await Promise.all(workers);

    if(stopRequested){
      setStatus("Stopped","idle");
      return;
    }

    $("dailyCandidates").textContent=dailyCandidates.length;
    setProgress(0,dailyCandidates.length,`Checking 1H pattern for ${dailyCandidates.length} candidates…`);

    const matches=[];
    const q2=[...dailyCandidates];
    const workers2=Array.from({length:5},async()=>{
      while(q2.length&&!stopRequested){
        const candidate=q2.shift();
        try{
          const ks=await getKlines(candidate.symbol,"1h",6);
          const closed=ks.filter(isClosed);
          // IMPORTANT: only completed 1H candles. Latest 3 completed = red, red, green.
          if(closed.length<3) continue;
          const h2=closed[closed.length-3];
          const h1=closed[closed.length-2];
          const h0=closed[closed.length-1];

          if(isRed(h2)&&isRed(h1)&&isGreen(h0)&&change(h0)>=hourGreenMin){
            diag.hourly++;
            matches.push({
              symbol:candidate.symbol,daily:candidate.daily,
              h2:change(h2),h1:change(h1),h0:change(h0),volume:candidate.volume
            });
          }
        }catch(e){}finally{
          diag.scanned++;
          if(diag.scanned%3===0){
            setProgress(diag.scanned,dailyCandidates.length,
              `1H: ${Math.min(diag.scanned,dailyCandidates.length)}/${dailyCandidates.length} • Exact matches: ${matches.length}`);
            renderDiagnostics(diag);
          }
        }
        await sleep(55);
      }
    });
    await Promise.all(workers2);

    matches.sort((a,b)=>b.daily-a.daily);
    diag.matches=matches.length;
    renderDiagnostics(diag);
    render(matches.slice(0,maxResults));
    $("lastScan").textContent=new Date().toLocaleTimeString([],{
      hour:"2-digit",minute:"2-digit"
    });
    setStatus(`${matches.length} match${matches.length===1?"":"es"} found`,"live");
    setProgress(1,1,`Finished • ${matches.length} exact match${matches.length===1?"":"es"}.`);

  }catch(err){
    console.error(err);
    setStatus("Scan failed","error");
    $("progressText").textContent=`Error: ${err.message}`;
  }finally{
    $("scanBtn").disabled=false;
    $("stopBtn").disabled=true;
  }
}

function exportCSV(){
  if(!currentResults.length)return;
  const rows=[["Rank","Symbol","1D %","1H -2 %","1H -1 %","1H Last %","24H Quote Volume"]];
  currentResults.forEach((r,i)=>rows.push([
    i+1,r.symbol,r.daily.toFixed(4),r.h2.toFixed(4),r.h1.toFixed(4),r.h0.toFixed(4),r.volume.toFixed(2)
  ]));
  const csv=rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`binance-scanner-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("scanBtn").addEventListener("click",scan);
$("stopBtn").addEventListener("click",()=>{
  stopRequested=true;
  $("stopBtn").disabled=true;
  setStatus("Stopping…","busy");
});
$("exportBtn").addEventListener("click",exportCSV);
$("autoRefresh").addEventListener("change",e=>{
  $("refreshMinutes").disabled=!e.target.checked;
  if(refreshTimer)clearInterval(refreshTimer);
  if(e.target.checked){
    refreshTimer=setInterval(()=>{
      if(!$("scanBtn").disabled)scan();
    },Number($("refreshMinutes").value)*60000);
  }
});
$("refreshMinutes").addEventListener("change",()=>{
  if($("autoRefresh").checked){
    if(refreshTimer)clearInterval(refreshTimer);
    refreshTimer=setInterval(()=>{
      if(!$("scanBtn").disabled)scan();
    },Number($("refreshMinutes").value)*60000);
  }
});
