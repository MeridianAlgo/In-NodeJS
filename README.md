
# MeridianAlgo/In-NodeJS

MeridianAlgo offers unique trading bot strategies implemented in Node.js. As a non-profit, we use Alpaca's paper trading for all buy/sell orders, focusing on research and development without financial gain.

## 🌟 Overview

This Node.js application provides tools for monitoring stocks and cryptocurrencies, powered by an adaptive moving average (MA) algorithm. It supports real-time/historical price tracking and automated paper trading via Alpaca.

## ✨ Features

- **Dual Market Support**: Monitor stocks (e.g., AAPL) or cryptocurrencies (e.g., BTC/USD).
- **Adaptive Moving Average (QuantumMA)**:
  - Dynamically selects optimal MA type (SMA, EMA, WMA, Hull, ALMA, RMA, LINREG, VWMA) and length.
  - Uses custom scoring and R-squared for MA effectiveness.
  - Outputs "Bullish," "Bearish," or "Neutral" trends.
  - Configurable parameters: `baseLength`, `evalPeriod`, `almaOffset`, `almaSigma`.
- **Data Sources**: Fetches real-time/historical data from Yahoo Finance, Finnhub, Polygon.io, and Alpaca (crypto).
- **Automated Paper Trading**: Generates buy/sell signals and executes simulated trades via Alpaca.
- **Market Status**: Checks stock/crypto market status using Polygon.io and Alpaca.
- **Timeframes**: Supports `1m`, `5m`, `15m`, `1h`, `1d` for stocks; `1Min`, `5Min`, `15Min`, `1Hour`, `1Day` for crypto.
- **Non-Profit**: Focused on research; no real money used.

## ⚙️ Prerequisites

- Node.js (v14 or higher)
- npm
- API Keys:
  - Alpaca (paper trading, crypto data)
  - Polygon.io (market status)
  - Finnhub (real-time prices)

## 📦 Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/MeridianAlgo/In-NodeJS.git
   cd In-NodeJS
   ```
2. Install dependencies:
   ```bash
   npm install @alpacahq/alpaca-trade-api axios dotenv node-cron ws yahoo-finance2 node-fetch
   ```

## 🔑 Configuration

Create a `.env` file in the project root with:
```
ALPACA_API_KEY_ID=your_alpaca_key_id
ALPACA_SECRET_KEY=your_alpaca_secret_key
POLYGON_API_KEY=your_polygon_api_key
FINNHUB_API_KEY=your_finnhub_api_key
```

## 🚀 Usage

### Monitor Stocks - From StockBot Folder
```bash
node stockMonitor.js AAPL
```
Select timeframe (e.g., `1m`, `5m`). Monitors real-time data and executes paper trades.

### Monitor Cryptocurrencies - From CryptoBot Folder
```bash
node cryptoMonitor.js BTC/USD
```
Select timeframe (e.g., `15Min`). Monitors crypto data and executes paper trades.

## 📝 Notes

- For educational/paper trading only; no real money used.
- Ensure valid API keys with appropriate access.
- Stop monitoring with `Ctrl+C`.
- `QuantumMA` drives adaptive MA logic.

## ⚠️ Disclaimers

- **Not Financial Advice**: This project is for research and educational purposes only. It does not constitute financial advice or recommendations to buy/sell securities or cryptocurrencies.
- **No Real Money**: All trades are simulated via Alpaca's paper trading API. No actual funds are used or at risk.
- **Use at Your Own Risk**: MeridianAlgo is not responsible for any losses, damages, or issues arising from the use of this software or its outputs.

## 📂 Project Structure

- `stockMonitor.js`: Logic for stock monitoring/paper trading.
- `cryptoMonitor.js`: Logic for crypto monitoring/paper trading.
- `quantamMA.js`: Adaptive moving average calculations.
- `.env`: API key configuration (create locally).
- `package.json`: Project dependencies.

## 🏗️ Contribution

We welcome contributions to enhance algorithmic trading research:
1. Fork the repository.
2. Create a feature/bug-fix branch.
3. Follow code style guidelines.
4. Submit a pull request with clear descriptions.

## 📄 License

Mozilla Public License

## About

MeridianAlgo is a non-profit dedicated to advancing trading bot strategies through open-source research and Alpaca's paper trading platform.

© 2025 MeridianAlgo
