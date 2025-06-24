# MeridianAlgo - Crypto Trading Monitor

**MeridianAlgo** offers our unique take on popular trading bot strategies. As a non-profit, we leverage Alpaca's paper trading features for all "buy and sell" orders, focusing solely on research and development without financial gain. This project is a dedicated tool for monitoring and paper trading cryptocurrencies.

## 🌟 Overview

The `cryptoMonitor.js` application is a Node.js-based tool for real-time and historical price monitoring of cryptocurrencies. It employs an adaptive moving average (MA) strategy, powered by the `QuantumMA` module, to analyze market trends and generate automatic buy/sell signals within Alpaca's paper trading environment.

## ✨ Features

* **Cryptocurrency Focus:** Specifically designed for monitoring and trading crypto pairs (e.g., BTC/USD, ETH/USD).
* **Adaptive Moving Average (QuantumMA):**
    * Dynamically selects the best-performing MA type (SMA, EMA, WMA, Hull, ALMA, RMA, LINREG, VWMA) and length for given price data.
    * Utilizes a custom scoring mechanism and R-squared calculation to evaluate MA effectiveness.
    * Provides clear "Bullish," "Bearish," or "Neutral" trend indications.
    * Configurable `baseLength`, `evalPeriod`, `almaOffset`, and `almaSigma` for fine-tuning.
* **Real-time & Historical Data:** Fetches real-time price data from Finnhub via WebSocket and historical OHLCV data from Alpaca's Crypto API.
* **Automatic Signals & Paper Trading:** Generates automatic buy/sell signals and executes simulated crypto trades using Alpaca's paper trading API.
* **Market Status Checks:** Verifies crypto market status through Polygon.io and confirms asset tradability via Alpaca.
* **Configurable Timeframes:** Supports various timeframes relevant to crypto markets (e.g., `1Min`, `5Min`, `15Min`, `1Hour`, `1Day`).
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
    *(Assuming `cryptoMonitor.js` is in the root or a dedicated `crypto` folder you've navigated into)*

2.  **Install dependencies:**
    ```sh
    npm install @alpacahq/alpaca-trade-api axios dotenv node-cron ws yahoo-finance2 node-fetch
    ```

## 🔑 Configuration

Create a `.env` file in the root directory of the project (where `cryptoMonitor.js` resides) with the following variables:

````

ALPACA\_API\_KEY\_ID=your\_alpaca\_key\_id
ALPACA\_SECRET\_KEY=your\_alpaca\_secret\_key
POLYGON\_API\_KEY=your\_polygon\_api\_key
FINNHUB\_API\_KEY=your\_finnhub\_api\_key

````

* **All variables are required for full functionality.** The application will notify you if any are missing upon startup.

## 🚀 Usage

Run the crypto monitor from the command line, providing a crypto trading pair as an argument (e.g., `BTC/USD`):

```sh
node cryptoMonitor.js BTC/USD
````

  * You will be prompted to select a timeframe (e.g., `1Min`, `5Min`, `15Min`, `1Hour`, `1Day`).
  * The monitor will fetch historical data from Alpaca, verify market status, display initial analysis, and begin real-time monitoring via Finnhub WebSocket.
  * Buy/sell signals will be generated based on the adaptive MA, and paper trades will be executed using Alpaca's API.

### Example Output

```
PS C:\Users\ishaa\OneDrive\Desktop\Crypto> node cryptoMonitor.js BTC/USD

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

  * This project is for educational and paper trading purposes only. **No real money is used.**
  * Ensure your API keys are valid and have sufficient access for market data and paper trading.
  * To stop monitoring, press `Ctrl+C` in the terminal.
  * The `QuantumMA` module's adaptive logic is central to this bot, providing an intelligent approach to moving average analysis for cryptocurrencies.

## 📂 Project Structure

  * `cryptoMonitor.js`: Main logic for monitoring and paper trading cryptocurrencies.
  * `quantamMA.js`: Core module containing the `QuantumMA` class for adaptive moving average calculation and analysis (shared with `stockMonitor.js`).
  * `.env`: Configuration file for API keys (not included in repository, must be created locally).
  * `package.json`: Project dependencies.

## 🏗️ Development & Contribution

As a non-profit, MeridianAlgo thrives on collaborative research and development. We welcome contributions from developers, quantitative analysts, and enthusiasts interested in algorithmic trading, data analysis, and open-source projects.

If you'd like to contribute, please:

1.  Fork the repository.
2.  Create a new branch for your features or bug fixes.
3.  Ensure your code adheres to our style guidelines.
4.  Submit a pull request with a clear description of your changes.

## 📄 License

This project is open-source and available under the Mozilla Public Liscense


