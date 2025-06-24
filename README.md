# MeridianAlgo - Our Take

**MeridianAlgo** offers our unique take on popular trading bot strategies. As a non-profit, we leverage Alpaca's paper trading features for all "buy and sell" orders, focusing solely on research and development without financial gain. This project serves as a comprehensive tool for monitoring both traditional stocks and cryptocurrencies, powered by an adaptive moving average (MA) formula.

## 🌟 Overview

This Node.js application provides real-time and historical price monitoring, advanced moving average analysis using the `QuantumMA` module, and automatic buy/sell signal generation for paper trading via Alpaca. It supports both stock and cryptocurrency markets, adapting its analysis to find the most effective moving average strategies.

## ✨ Features

* **Dual Market Support:** Monitor both traditional stocks and cryptocurrencies (e.g., AAPL, BTC/USD).
* **Adaptive Moving Average (QuantumMA):**
    * Dynamically selects the best-performing MA type (SMA, EMA, WMA, Hull, ALMA, RMA, LINREG, VWMA) and length for given price data.
    * Utilizes a custom scoring mechanism and R-squared calculation to evaluate MA effectiveness.
    * Provides clear "Bullish," "Bearish," or "Neutral" trend indications.
    * Configurable `baseLength`, `evalPeriod`, `almaOffset`, and `almaSigma` for fine-tuning.
* **Real-time & Historical Data:** Fetches price data from Yahoo Finance, Finnhub, Polygon.io, and Alpaca's API (for crypto historical data).
* **Automatic Signals & Paper Trading:** Generates automatic buy/sell signals and executes simulated trades using Alpaca's paper trading API.
* **Market Status Checks:** Verifies market status for both stocks (Polygon.io) and crypto (Polygon.io & Alpaca asset status).
* **Configurable Timeframes:** Supports various timeframes (e.g., `1m`, `5m`, `15m`, `1h`, `1d` for stocks; `1Min`, `5Min`, `15Min`, `1Hour`, `1Day` for crypto).
* **Non-Profit Focus:** Dedicated to research and development; **no real money is used** in trades.

## ⚙️ Prerequisites

* Node.js (v14 or higher recommended)
* npm (Node Package Manager)
* **API Keys for:**
    * [Alpaca](https://alpaca.markets/) (for paper trading and crypto historical data)
    * [Polygon.io](https://polygon.io/) (for market status checks)
    * [Finnhub](https://finnhub.io/) (for real-time price feeds)

## 📦 Installation

1.  **Clone the repository:**
    ```sh
    git clone <repo-url>
    cd MeridianAlgo
    ```

2.  **Install dependencies:**
    ```sh
    npm install @alpacahq/alpaca-trade-api axios dotenv node-cron ws yahoo-finance2 node-fetch
    ```
    *Note: `node-fetch` is specifically required for `cryptoMonitor.js` to interact with external APIs if needed, though Alpaca is primarily used now.*

## 🔑 Configuration

Create a `.env` file in the root directory of the project with the following variables:
- *ALPACA_API_KEY_ID=your_alpaca_key_id*

- *ALPACA_SECRET_KEY=your_alpaca_secret_key*

- *POLYGON_API_KEY=your_polygon_api_key*

- *FINNHUB_API_KEY=your_finnhub_api_key*

* **All variables are required for full functionality.** The application will notify you if any are missing upon startup.

## 🚀 Usage

You can run the monitor for either stocks or cryptocurrencies from the command line.

### Monitoring Stocks

Run the stock monitor, providing a stock symbol (e.g., `AAPL`):

```sh
node stockMonitor.js AAPL
```

You will be prompted to select a timeframe (e.g., 1m, 5m, 15m, 1h, 1d).
The monitor will fetch historical data, display initial analysis, and begin real-time monitoring.
Buy/sell signals will be executed using Alpaca's paper trading API.
Monitoring Cryptocurrencies
Run the crypto monitor, providing a crypto trading pair (e.g., BTC/USD):

```sh
node cryptoMonitor.js BTC/USD
```

Example Output (Crypto Monitor)
```sh
PS C:\Users\meridian\OneDrive\Desktop\CryptoBot> node cryptoMonitor.js BTC/USD

=== Timeframe Configuration ===
Available timeframes:
1Min: 1 Minute
5Min: 5 Minutes
15Min: 15 Minutes
1Hour: 1 Hour
1Day: 1 Day

Select timeframe (default: 5Min): 15Min

Selected timeframe: 15Min

=== Crypto Monitor Initialization ===
Symbol: BTC/USD
Timeframe: 15Min

=== API Status ===
Alpaca: ✅ Connected
Polygon: ✅ Connected
Finnhub: ✅ Connected

=== Market Status (Polygon) ===
Crypto market is OPEN (Polygon)

=== Market Status (Alpaca) ===
BTCUSD is available for trading (Alpaca)

=== Alpaca Paper Trading Account ===
Buying Power: $199766.36
Portfolio Value: $99984.37
Cash: $99781.99

=== Market Analysis ===
Current Price: $104925.35
MA: $105144.46
MA Type: SMA
Trend: Bearish

Waiting for data to stabilize...
Connected to Finnhub WebSocket

==================================================
=== Regular Update for BTC/USD ===
Time: 6/24/2025, 9:54:45 AM
Current Price: $104925.35
MA Type: SMA
MA Length: 20
MA Value: $105144.46
Trend: Bearish
Score: 4.96
R-Squared: -6.34
==================================================

✅ Monitoring Active
```

## 📝 Notes
This project is for educational and paper trading purposes only. No real money is used.
Ensure your API keys are valid and have sufficient access for market data and paper trading.
To stop monitoring, press Ctrl+C in the terminal.
The QuantumMA module's adaptive logic is central to both stockMonitor.js and cryptoMonitor.js, providing an intelligent approach to moving average analysis.

## 📂 Project Structure
stockMonitor.js: Main logic for monitoring and paper trading traditional stocks.
cryptoMonitor.js: Main logic for monitoring and paper trading cryptocurrencies.
quantamMA.js: Core module containing the QuantumMA class for adaptive moving average calculation and analysis.
.env: Configuration file for API keys (not included in repository, must be created locally).
package.json: Project dependencies.

## 🏗️ Development & Contribution
As a non-profit, MeridianAlgo thrives on collaborative research and development. We welcome contributions from developers, quantitative analysts, and enthusiasts interested in algorithmic trading, data analysis, and open-source projects.

If you'd like to contribute, please:

Fork the repository.
Create a new branch for your features or bug fixes.
Ensure your code adheres to our style guidelines.
Submit a pull request with a clear description of your changes.

## 📄 License
This project is open-source and available under the Mozilla Public Liscense.
