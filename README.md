# Binance Spot Momentum Scanner

Static GitHub Pages website. No backend and no Binance API key required.

## Signal

A symbol must satisfy:

- Binance Spot market
- USDT quote asset
- Latest completed 1D candle is green
- Latest completed 1D candle change is at least the configured minimum (default +20%)
- 24h quote volume is at least the configured minimum (default $5M)
- Latest three completed 1H candles are:
  - red
  - red
  - green
- Latest 1H green candle is at least the configured minimum (default 0%)

The default result limit is 20.

## Deploy on GitHub Pages

1. Create a GitHub repository.
2. Upload `index.html`, `style.css`, and `app.js` to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`.
6. Save and open the generated GitHub Pages URL.

## Important

The scanner uses Binance public REST market-data endpoints directly from the browser. It uses completed candles so an in-progress candle cannot create a false signal.

Because Binance's kline REST endpoint is symbol-specific, scanning hundreds of pairs can take some time. The page uses moderate concurrency and a short delay to reduce rate-limit pressure.

If Binance returns a rate-limit error, wait briefly and scan again.

This is a market scanner, not financial advice.
