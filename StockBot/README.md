# MeridianAlgo StockMonitor

StockMonitor is a Node.js tool for monitoring and paper trading stocks using an adaptive moving average (MA) algorithm. Part of the MeridianAlgo non-profit, it uses Alpaca's paper trading API for simulated buy/sell orders, focusing on research.

## 🌟 Overview

StockMonitor fetches real-time and historical stock data, analyzes trends with the `QuantumMA` module, and generates automated paper trading signals via Alpaca.

## ✨ Features

- Tracks stocks (e.g., AAPL, TSLA).
- **Adaptive QuantumMA**:
  - Selects optimal MA type (SMA, EMA, WMA, Hull, ALMA, RMA, LINREG, VWMA) and length.
  - Uses scoring and R-squared for MA evaluation.
  - Outputs "Bullish," "Bearish," or "Neutral" trends.
  - Configurable: `baseLength`, `evalPeriod`, `almaOffset`, `almaSigma`.
- Data from Alpaca, Polygon.io, Finnhub, Yahoo Finance.
- Executes simulated trades via Alpaca's paper trading API.
- Verifies stock market status (Polygon.io, Alpaca).
- Supports timeframes: `1m`, `5m`, `15m`, `1h`, `1d`.

## ⚙️ Prerequisites

- Node.js (v14+)
- npm
- API Keys:
  - Alpaca (paper trading, stock data)
  - Polygon.io (market status)
  - Finnhub (real-time prices)

## 📦 Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/MeridianAlgo/In-Node.git
   cd In-Node
   ```
2. Install dependencies:
   ```bash
   npm install @alpacahq/alpaca-trade-api axios dotenv node-cron ws yahoo-finance2 node-fetch
   ```

## 🔑 Configuration

Create a `.env` file in the project root:
```
ALPACA_API_KEY_ID=your_alpaca_key_id
ALPACA_SECRET_KEY=your_alpaca_secret_key
POLYGON_API_KEY=your_polygon_api_key
FINNHUB_API_KEY=your_finnhub_api_key
```

## 🚀 Usage

Run with a stock symbol:
```bash
node stockMonitor.js AAPL
```
Select timeframe (e.g., `5m`). Monitors data and executes paper trades.

**Example Output**:
```
=== Stock Monitor ===
Symbol: AAPL | Timeframe: 5m
APIs: Alpaca ✅ | Polygon ✅ | Finnhub ✅
Market: OPEN (Polygon) | Tradable (Alpaca)
Price: $150.25 | MA: $149.80 (EMA) | Trend: Bullish
✅ Monitoring Active
```

## ⚠️ Disclaimers

- **Not Financial Advice**: For research/education only. Not a recommendation to buy/sell stocks.
- **Paper Trading Only**: Uses Alpaca's paper trading; no real money involved.
- **Use at Your Own Risk**: MeridianAlgo is not liable for any losses or issues.

## 📝 Notes

- Stop with `Ctrl+C`.
- Requires valid API keys.
- `QuantumMA` powers trend analysis.

## 📄 License

Mozilla Public License

## About

MeridianAlgo is a non-profit advancing algorithmic trading research via open-source tools.

© 2025 MeridianAlgo
