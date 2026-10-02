/* Binance Spot USDT Momentum Scanner v1.0.1 */
"use strict";

const API_BASES=[
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api-gcp.binance.com",
  "https://api1.binance.com"
];
const API_PATHS={
  exchangeInfo:"/api/v3/exchangeInfo",
  ticker24h:"/api/v3/ticker/24hr",
  klines:"/api/v3/klines"
};
let activeApiBase=null;
const CONCURRENCY=7;
let isScanning=false,abortController=null,lastResults=[];

const $=id=>document.getElementById(id);
const dailyMinInput=$("dailyMin"),volumeMinInput=$("volumeMin"),hourlyMinInput=$("hourlyMin"),maxResultsInput=$("maxResults");
const scanBtn=$("scanBtn"),stopBtn=$("stopBtn"),exportBtn=$("exportBtn");
const statusTitle=$("statusTitle"),statusText=$("statusText"),statusBadge=$("statusBadge"),progressBar=$("progressBar"),progressText=$("progressText");
const statSymbols=$("statSymbols"),statSpot=$("statSpot"),statDaily=$("statDaily"),statMatches=$("statMatches"),resultsBody=$("resultsBody"),resultsSubtitle=$("resultsSubtitle");

function formatNumber(v){return new Intl.NumberFormat("en-US").format(v)}
function formatPercent(v){v=Number(v);return Number.isFinite(v)?`${v>=0?"+":""}${v.toFixed(2)}%`:"—"}
function formatVolume(v){v=Number(v);if(!Number.isFinite(v))return"—";if(v>=1e9)return`$${(v/1e9).toFixed(2)}B`;if(v>=1e6)return`$${(v/1e6).toFixed(2)}M`;if(v>=1e3)return`$${(v/1e3).toFixed(1)}K`;return`$${v.toFixed(0)}`}
function setStatus(type,title,text){statusTitle.textContent=title;statusText.textContent=text;statusBadge.className=`status-badge ${type}`;statusBadge.textContent={idle:"READY",running:"RUNNING",done:"DONE",error:"ERROR"}[type]||"READY"}
function setProgress(p,text){progressBar.style.width=`${Math.min(Math.max(p,0),100)}%`;progressText.textContent=text}
function resetStats(){statSymbols.textContent="—";statSpot.textContent="—";statDaily.textContent="—";statMatches.textContent="—"}
function checkStopped(){if(abortController?.signal.aborted)throw new DOMException("Scan stopped","AbortError")}

async function fetchJson(url,options={}){
  const r=await fetch(url,{...options,headers:{Accept:"application/json",...(options.headers||{})}});
  if(!r.ok){
    let m=`HTTP ${r.status}`;
    try{const e=await r.json();if(e?.msg)m+=`: ${e.msg}`}catch(_){}
    throw new Error(m)
  }
  return r.json()
}

async function fetchPublic(path,params="",signal){
  const bases=activeApiBase?[activeApiBase,...API_BASES.filter(b=>b!==activeApiBase)]:API_BASES;
  let lastError=null;
  for(const base of bases){
    try{
      const result=await fetchJson(`${base}${path}${params}`,{signal});
      activeApiBase=base;
      return result;
    }catch(e){
      if(e?.name==="AbortError")throw e;
      lastError=e;
    }
  }
  throw new Error(`Binance public API unavailable. Last error: ${lastError?.message||"Unknown error"}`);
}
function containsSpotPermission(v){if(!v)return false;if(typeof v==="string")return v.toUpperCase()==="SPOT";if(Array.isArray(v))return v.some(containsSpotPermission);return false}

function isVerifiedSpotSymbol(s){
  if(!s||s.status!=="TRADING"||s.quoteAsset!=="USDT")return false;
  const sources=[s.permissions,s.permissionSets,s.allowedPermissions];
  if(sources.some(containsSpotPermission))return true;
  if(s.isSpotTradingAllowed===true||s.spotTradingAllowed===true)return true;
  return false;
}

async function getSpotSymbols(){
  /*
   * Binance supports permission filtering directly on exchangeInfo.
   * This keeps futures/perpetual/margin-only markets out before
   * candle scanning begins. Each symbol is still positively checked.
   */
  const query="?permissions=SPOT&symbolStatus=TRADING&showPermissionSets=true";
  const data=await fetchPublic(API_PATHS.exchangeInfo,query,abortController?.signal);

  if(!Array.isArray(data?.symbols)){
    throw new Error("Binance exchangeInfo returned no symbols.");
  }

  const allSymbols=data.symbols;

  if(allSymbols.length===0){
    throw new Error("Binance returned zero symbols for permissions=SPOT and symbolStatus=TRADING.");
  }

  const spotUsdtSymbols=allSymbols.filter(isVerifiedSpotSymbol);

  if(spotUsdtSymbols.length===0){
    throw new Error("Binance returned Spot symbols, but none could be positively verified as Spot USDT pairs.");
  }

  return{allSymbols,spotUsdtSymbols}
}
async function getAll24hTickers(){
  const data=await fetchPublic(API_PATHS.ticker24h,"",abortController?.signal);
  if(!Array.isArray(data))throw new Error("Binance 24H ticker response was invalid.");
  return data
}
async function getKlines(symbol,interval,limit,signal){
  return fetchPublic(
    API_PATHS.klines,
    `?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
    signal
  )
}
function analyzeCandle(k){
  if(!Array.isArray(k)||k.length<5)return null;
  const open=Number(k[1]),close=Number(k[4]);
  if(!Number.isFinite(open)||!Number.isFinite(close)||open<=0)return null;
  return{open,close,percent:((close-open)/open)*100,green:close>open,red:close<open}
}

function getCompletedKlines(klines){
  const now=Date.now();
  return klines.filter(k=>Number.isFinite(Number(k[6]))&&Number(k[6])<now)
}

async function runWithConcurrency(items,concurrency,worker){
  const results=new Array(items.length);let nextIndex=0;
  async function loop(){while(true){checkStopped();const i=nextIndex++;if(i>=items.length)return;try{results[i]=await worker(items[i],i)}catch(e){if(e?.name==="AbortError")throw e;results[i]={error:e,item:items[i]}}}}
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},loop));return results
}

async function scanDailyCandidates(symbols,tickerMap,dailyMin,volumeMin){
  const candidates=[];let completed=0,total=symbols.length;
  setStatus("running","Checking daily candles",`Scanning ${total} verified Spot USDT pairs...`);
  setProgress(0,`Checking daily candles: 0/${total} • Candidates: 0`);
  await runWithConcurrency(symbols,CONCURRENCY,async info=>{
    try{
      const klines=await getKlines(info.symbol,"1d",1,abortController.signal);
      const daily=analyzeCandle(klines?.[0]),ticker=tickerMap.get(info.symbol);
      if(!daily||!ticker)return null;
      const volume=Number(ticker.quoteVolume);
      if(!Number.isFinite(volume)||!daily.green||daily.percent<dailyMin||volume<volumeMin)return null;
      candidates.push({symbolInfo:info,symbol:info.symbol,dailyPercent:daily.percent,quoteVolume:volume});
      return true;
    }finally{
      completed++;setProgress(completed/total*100,`Checking daily candles: ${completed}/${total} • Candidates: ${candidates.length}`)
    }
  });
  candidates.sort((a,b)=>b.dailyPercent-a.dailyPercent);return candidates
}

async function checkHourlyPattern(candidate,hourlyMin){
  const klines=await getKlines(candidate.symbol,"1h",5,abortController.signal);
  const completed=getCompletedKlines(klines);
  if(completed.length<3)return null;
  const a=analyzeCandle(completed.at(-3)),b=analyzeCandle(completed.at(-2)),c=analyzeCandle(completed.at(-1));
  if(!a||!b||!c||!a.red||!b.red||!c.green||c.percent<hourlyMin)return null;
  return{...candidate,hourlyMinus2:a.percent,hourlyMinus1:b.percent,hourlyLast:c.percent}
}

async function scanHourlyCandidates(candidates,hourlyMin){
  const matches=[];let completed=0,total=candidates.length;
  setStatus("running","Checking 1H patterns","Checking the latest 3 completed 1H candles...");
  if(!total){setProgress(100,"No daily candidates to check.");return[]}
  setProgress(0,`Checking 1H pattern: 0/${total} • Matches: 0`);
  await runWithConcurrency(candidates,CONCURRENCY,async c=>{
    try{const r=await checkHourlyPattern(c,hourlyMin);if(r)matches.push(r);return r}
    finally{completed++;setProgress(completed/total*100,`Checking 1H pattern: ${completed}/${total} • Matches: ${matches.length}`)}
  });
  matches.sort((a,b)=>b.dailyPercent-a.dailyPercent);return matches
}

function escapeHtml(v){return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}

function renderResults(results){
  resultsBody.innerHTML="";
  if(!results.length){
    resultsBody.innerHTML=`<tr class="empty-row"><td colspan="9"><div class="empty-state"><div class="empty-icon">⌁</div><strong>No exact matches found</strong><span>No verified Spot USDT pair satisfied all configured conditions.</span></div></td></tr>`;
    resultsSubtitle.textContent="No coins matched all configured conditions.";return
  }
  results.forEach((r,i)=>{
    const row=document.createElement("tr");
    const chartUrl=`https://www.binance.com/en/trade/${encodeURIComponent(r.symbol)}`;
    row.innerHTML=`<td>${i+1}</td><td><div class="coin">${escapeHtml(r.symbol)}<small>Binance Spot</small></div></td><td><span class="spot">✓ SPOT</span></td><td><span class="percent green">${formatPercent(r.dailyPercent)}</span></td><td><span class="percent red">${formatPercent(r.hourlyMinus2)}</span></td><td><span class="percent red">${formatPercent(r.hourlyMinus1)}</span></td><td><span class="percent green">${formatPercent(r.hourlyLast)}</span></td><td><span class="volume">${formatVolume(r.quoteVolume)}</span></td><td><a class="chart-link" href="${chartUrl}" target="_blank" rel="noopener noreferrer">Open ↗</a></td>`;
    resultsBody.appendChild(row)
  });
  resultsSubtitle.textContent=`${results.length} exact match${results.length===1?"":"es"} found.`
}

function csvEscape(v){const s=String(v??"");return s.includes(",")||s.includes('"')||s.includes("\n")?`"${s.replaceAll('"','""')}"`:s}
function exportCSV(){
  if(!lastResults.length)return;
  const header=["Rank","Symbol","Market","1D %","1H -2 %","1H -1 %","1H Last %","24H Volume"];
  const rows=lastResults.map((r,i)=>[i+1,r.symbol,"SPOT",r.dailyPercent.toFixed(4),r.hourlyMinus2.toFixed(4),r.hourlyMinus1.toFixed(4),r.hourlyLast.toFixed(4),r.quoteVolume.toFixed(2)]);
  const blob=new Blob([[header,...rows].map(row=>row.map(csvEscape).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`binance-momentum-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)
}

function getSettings(){
  const dailyMin=Number(dailyMinInput.value),volumeMin=Number(volumeMinInput.value),hourlyMin=Number(hourlyMinInput.value),maxResults=Number(maxResultsInput.value);
  if(!Number.isFinite(dailyMin))throw new Error("Daily minimum % is invalid.");
  if(!Number.isFinite(volumeMin)||volumeMin<0)throw new Error("Minimum 24H volume is invalid.");
  if(!Number.isFinite(hourlyMin))throw new Error("Latest 1H minimum % is invalid.");
  if(!Number.isFinite(maxResults)||maxResults<1)throw new Error("Maximum results must be at least 1.");
  return{dailyMin,volumeMin,hourlyMin,maxResults:Math.floor(maxResults)}
}

async function startScan(){
  if(isScanning)return;
  let settings;
  try{settings=getSettings()}catch(e){setStatus("error","Invalid settings",e.message);return}
  isScanning=true;abortController=new AbortController();lastResults=[];exportBtn.disabled=true;scanBtn.disabled=true;stopBtn.disabled=false;resetStats();
  resultsSubtitle.textContent="Scanning Binance Spot markets...";
  try{
    setStatus("running","Loading Binance Spot markets","Fetching exchangeInfo...");
    setProgress(5,"Fetching Binance exchange information...");
    const[spotData,tickers]=await Promise.all([getSpotSymbols(),getAll24hTickers()]);
    checkStopped();
    statSymbols.textContent=formatNumber(spotData.allSymbols.length);
    statSpot.textContent=formatNumber(spotData.spotUsdtSymbols.length);
    setStatus("running","Spot markets loaded",`${spotData.spotUsdtSymbols.length} verified Spot USDT pairs. Scanning daily candles now...`);
    const tickerMap=new Map(tickers.filter(t=>t?.symbol).map(t=>[t.symbol,t]));
    const daily=await scanDailyCandidates(spotData.spotUsdtSymbols,tickerMap,settings.dailyMin,settings.volumeMin);
    checkStopped();statDaily.textContent=formatNumber(daily.length);
    if(daily.length===0){
      setProgress(100,"Daily scan complete • 0 candidates passed the configured daily + volume filters.");
      lastResults=[];
      statMatches.textContent="0";
      renderResults([]);
      setStatus("done","Scan complete","All verified Spot USDT pairs were checked. No daily candidates matched the current settings.");
      return;
    }
    const allMatches=await scanHourlyCandidates(daily,settings.hourlyMin);
    checkStopped();
    lastResults=allMatches.slice(0,settings.maxResults);statMatches.textContent=formatNumber(lastResults.length);renderResults(lastResults);
    setProgress(100,`Scan complete • ${lastResults.length} result${lastResults.length===1?"":"s"}`);
    setStatus("done","Scan complete",`${allMatches.length} exact match${allMatches.length===1?"":"es"} found. Showing up to ${settings.maxResults}.`);
    exportBtn.disabled=!lastResults.length
  }catch(e){
    if(e?.name==="AbortError"){setStatus("idle","Scan stopped","The scan was stopped by the user.");setProgress(0,"Scan stopped.");resultsSubtitle.textContent="Scan stopped.";return}
    console.error(e);setStatus("error","Scan failed",e?.message||"An unexpected error occurred.");setProgress(0,"Unable to complete scan.");resultsSubtitle.textContent="The scan could not be completed."
  }finally{isScanning=false;abortController=null;scanBtn.disabled=false;stopBtn.disabled=true}
}
function stopScan(){if(isScanning&&abortController)abortController.abort()}
scanBtn.addEventListener("click",startScan);stopBtn.addEventListener("click",stopScan);exportBtn.addEventListener("click",exportCSV);