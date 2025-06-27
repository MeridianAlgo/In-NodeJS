# CryptoMonitor Bot 🚦📈

**Crypto Monitor**
*Version 2.0 – Automated Crypto Trading, Now Smarter and Safer*

---

## What is CryptoMonitor?
CryptoMonitor is an advanced, open-source crypto trading bot for real-time market analysis and automated trading. It leverages robust moving average analytics, live price feeds, and multiple APIs to help you trade smarter. Version 2.0 introduces candle-close signal logic, improved error handling, persistent user preferences, and a legal/disclaimer section for your safety.

---

## ✨ What's New in v2.0
- **Candle-Close Signal Logic:** Signals (buy/long) are only generated after a new candle is fully closed, for all timeframes.
- **Race Condition Exit Logic:** Positions are closed by whichever comes first: take-profit, stop-loss, or a moving average crossunder (if enabled).
- **Persistent User Preferences:** Your settings (logging, TP/SL %, timeframe) are saved and can be reused or updated at startup.
- **Position & P&L Logging:** See your open positions and P&L at startup and during monitoring.
- **Bracket Orders:** Entry, take-profit, and stop-loss are managed as a single bracket order for crypto (per Alpaca docs).
- **Centralized Error Logging:** All API errors are logged to `api_errors.log` for easy troubleshooting.
- **Improved CLI UI:** Clear prompts, startup summaries, and error messages.
- **Legal & Compliance:** See the new Legal & Disclaimer section below.

---

## 🛠️ How It Works
1. **Startup:** Launch the bot with a trading pair (e.g., `BTC/USD`).
2. **Preferences:** Use previous settings or enter new ones (logging, TP/SL, timeframe).
3. **API Checks:** Bot verifies all required API keys and connectivity.
4. **Market Status:** Confirms the market is open and the asset is tradable.
5. **Historical Data:** Fetches recent OHLCV bars for robust moving average analysis.
6. **Live Feed:** Subscribes to real-time price updates via Finnhub WebSocket.
7. **Signal Engine:** Analyzes price vs. adaptive moving averages (QuantumMA) to detect buy signals (on candle close).
8. **Trade Execution:** Executes trades on Alpaca with bracket orders and dynamic/user-defined risk controls.
9. **Exit Logic:** Closes positions on take-profit, stop-loss, or (optionally) MA crossunder—whichever comes first.
10. **Logging:** Prints detailed status and trade logs to the terminal and logs errors to `api_errors.log`.
11. **Graceful Exit:** Handles Ctrl+C and errors cleanly, closing all connections.

---

## 🚀 Installation & Setup

### 1. Clone the Repository
```sh
git clone <your-repo-url>
cd Crypto
```

### 2. Install Node.js
[Download Node.js](https://nodejs.org/)

### 3. Install Dependencies
```sh
npm install
```

### 4. Set Up Your `.env` File
Create a `.env` file in the root directory with these variables:
```
ALPACA_API_KEY_ID=your_alpaca_key_id
ALPACA_SECRET_KEY=your_alpaca_secret
POLYGON_API_KEY=your_polygon_key
FINNHUB_API_KEY=your_finnhub_key
LLAMA_API_KEY=your_llama_key (optional, for advanced sizing)
NEWS_API_KEY=your_newsapi_key (optional)
```

---

## 🏃 Usage (CLI)
Run the bot from your terminal:
```sh
node cryptoMonitor.js BTC/USD
```
- Replace `BTC/USD` with any supported crypto pair.
- The bot will prompt you to select timeframe, take-profit, and stop-loss, or reuse previous settings.
- Press Ctrl+C to stop monitoring at any time.

---

## 🖥️ Example Output
```
=== Crypto Monitor Initialization ===
Symbol: BTC/USD
Timeframe: 1Min

[CURRENT POSITION]
Symbol: BTC/USD
Quantity: 0.00093
Entry Price: $107505.42
Current Price: $106949.07
Market Value: $99.29
Unrealized P/L: $-0.44 (-0.45%)
Take Profit: 2%
Stop Loss: 1%

=== API Status ===
Alpaca: ✅ Connected
Polygon: ✅ Connected
Finnhub: ✅ Connected
Llama: ✅ Connected (Test: What is 2+2? 4)
NewsAPI: ✅ Connected

=== Market Status ===
Crypto market is OPEN (Polygon)
BTC/USD is available for trading (Alpaca)

=== Alpaca Paper Trading Account ===
Buying Power: $100000
Portfolio Value: $100000
Cash: $100000

=== Market Analysis ===
Current Price: $65000.00
MA Type: EMA
MA: $64800.00
MA Length: 20
Trend: Bullish

Waiting for data to stabilize...

==================================================
=== Regular Update for BTC/USD ===
Time: 2024-06-25 12:00:00
Current Price: $65100.00
MA Type: EMA
MA Length: 20
MA Value: $64950.00
Trend: Bullish
Score: 0.85
R-Squared: 0.92

🔼 BUY SIGNAL DETECTED 🔼
==================================================

=== Executing BUY Order ===
Symbol: BTC/USD
Quantity: 0.0009
Current Price: $65100.00
Available Cash: $100000
Position Size: $58.59
Take Profit: 2% | Stop Loss: 1%
Order placed successfully: 123456789
[TP/SL Monitor] Monitoring for TP: $66402.00, SL: $64449.00
```

---

## ⏳ Supported Exchanges, Assets, and Timeframes
- **Exchanges:** Trades via Alpaca (paper trading, US users)
- **Assets:** Any crypto supported by Alpaca (e.g., BTC/USD, ETH/USD, etc.)
- **Timeframes:** 1Min, 5Min, 15Min, 1Hour, 1Day (all use candle-close logic)

---

## ⚡ Trading Logic & Risk Controls
- **Signals:** Generated when price crosses above the best-fit moving average (QuantumMA) on candle close.
- **Position Sizing:** Uses Llama API for dynamic sizing if enabled, otherwise fixed size (0.0009 BTC by default).
- **Take-Profit/Stop-Loss:** User-defined or auto (Llama/logic-based), managed as bracket orders.
- **No Overtrading:** Only one position per symbol at a time; will not buy if already long.
- **Race Condition Exit:** Position is closed by whichever comes first: TP, SL, or (optionally) MA crossunder.
- **Centralized Error Logging:** All API errors are logged to `api_errors.log`.
- **Graceful Error Handling:** Stops trading and exits on critical errors or insufficient funds.

---

## 🔑 API Rate Limits & Error Handling
- **Alpaca:** 200 requests/minute (see [docs](https://alpaca.markets/docs/api-references/trading-api/)).
- **Polygon:** Used for market status; see [Polygon docs](https://polygon.io/docs/).
- **Finnhub:** Used for live price feed; see [Finnhub docs](https://finnhub.io/docs/api/websocket-trades).
- **Llama/NewsAPI:** Optional, for advanced features.
- **Error Handling:**
  - Missing/invalid API keys: clear error and exit.
  - API/network errors: detailed message, bot stops or retries as appropriate.
  - Insufficient funds: bot warns and exits.
  - All API errors are logged to `api_errors.log`.

---

## 🧩 Troubleshooting & FAQ
**Q: The bot says missing environment variables.**
- Check your `.env` file and ensure all required keys are present.

**Q: No trades are being executed.**
- Ensure the market is open, the asset is tradable, and you have sufficient paper cash.

**Q: The bot exits unexpectedly.**
- Check the error message for details (API limits, network, funds, etc.).

**Q: How do I reset the paper trading account?**
- Log in to your Alpaca dashboard and reset your paper account.

---

## 👩‍💻 Developer Notes & Contribution
- **Core logic:** `core/CryptoMonitor.js`
- **Trading logic:** `core/tradeUtils.js`
- **Moving averages:** `quantamMA.js`
- **API helpers:** `core/apiHelpers.js`
- **CLI entry:** `cryptoMonitor.js`
- **Extending:** Add new analytics, APIs, or trading logic in the respective modules.
- **Contributions:** PRs/issues welcome! Please do not commit API keys.

---

## ⚖️ Legal & Disclaimer
**CryptoMonitor is provided for educational and informational purposes only.**

- **No Financial Advice:** This software does not constitute investment advice, financial advice, trading advice, or any other sort of advice. Use at your own risk.
- **No Warranty:** The software is provided "as is", without warranty of any kind, express or implied. The authors and contributors are not responsible for any losses, damages, or claims arising from your use of this software.
- **Paper Trading Only:** CryptoMonitor is intended for use with Alpaca's paper trading environment. Do not use with real funds unless you fully understand the risks.
- **Compliance:** You are responsible for complying with all local laws, regulations, and exchange terms of service.
- **API Keys:** Keep your API keys secure. Do not share or commit them to public repositories.
- **Open Source License:** See LICENSE file for details. Contributions are welcome, but must not include proprietary or sensitive information.

**By using CryptoMonitor, you acknowledge and accept all risks and responsibilities.**

---

## 📚 References
- [Alpaca API Docs](https://alpaca.markets/docs/api-references/trading-api/)
- [Polygon API Docs](https://polygon.io/docs/)
- [Finnhub WebSocket Docs](https://finnhub.io/docs/api/websocket-trades)
- [Node.js](https://nodejs.org/)

---

## ❤️ Why CryptoMonitor?
CryptoMonitor was built out of a passion for automation, transparency, and empowering traders with open-source tools. It combines robust analytics, real-time data, and safe trading practices to help you navigate the crypto markets with confidence. Happy trading!

-MeridianAlgo