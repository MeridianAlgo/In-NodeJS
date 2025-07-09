# BitFlow

BitFlow is a modern crypto trading bot for Node.js and Python that automates trading, backtesting, and monitoring. It features a professional CLI UI, dynamic position sizing, and advanced analytics.

---

## 🚀 Quick Start

1. **Clone the repository:**
   ```sh
   git clone <your-repo-url>
   cd BitFlow
   ```
2. **Install Node.js:**
   - [Download Node.js](https://nodejs.org/) (v16+ recommended)
3. **Install dependencies:**
   ```sh
   npm install
   ```
4. **Set up your `.env` file:**
   - Create a `.env` file in the project root with your API keys:
     ```env
     ALPACA_API_KEY_ID=your_alpaca_key_id
     ALPACA_SECRET_KEY=your_alpaca_secret
     POLYGON_API_KEY=your_polygon_key
     FINNHUB_API_KEY=your_finnhub_key
     LLAMA_API_KEY=your_llama_key   # (optional, for advanced sizing)
     GEMINI_API_KEY=your_gemini_key # (optional, for sentiment analysis)
     ```
5. **Configure your preferences:**
   - Edit `user_settings.json` in the project root. See below for details.
6. **Run the bot:**
   ```sh
   node BitFlow.js BTC/USD
   ```
   - Replace `BTC/USD` with any supported crypto pair.

---

## ⚙️ User Settings (`user_settings.json`)

All user preferences are read **directly** from `user_settings.json`. No merging, no prompts—just edit and go!

### Example `user_settings.json`
```json
{
  "enablePositionLogging": true,
  "defaultTakeProfit": "auto",
  "defaultStopLoss": "auto",
  "defaultTimeframe": "5Min",
  "enableCrossunderSignals": true,
  "enablePerformanceMetrics": true
}
```

### Option Descriptions
| Option                     | Type    | Description |
|----------------------------|---------|-------------|
| enablePositionLogging      | bool    | Log every position entry/exit to file. |
| defaultTakeProfit          | string/number | Default take profit (percent or "auto"). |
| defaultStopLoss            | string/number | Default stop loss (percent or "auto"). |
| defaultTimeframe           | string  | Chart timeframe (e.g., "1Min", "5Min"). |
| enableCrossunderSignals    | bool    | Sell on MA crossunder (true) or only TP/SL (false). |
| enablePerformanceMetrics   | bool    | Show advanced metrics (Sharpe, drawdown, win rate). |

**To change the bot's behavior, simply edit `user_settings.json` and restart the bot.**

---

## 🖥️ What to Expect
- The UI and all trading logic always reflect the current settings in `user_settings.json`.
- The monitor dashboard will show your preferences (metrics, crossunder, logging, etc.) live.
- No more prompts or merging—your settings are always in sync.

---

## 🛠️ Troubleshooting
- **Bot not using your settings?**
  - Make sure you saved `user_settings.json` and restarted the bot.
  - Check for typos or missing commas in your JSON file.
- **API errors?**
  - Double-check your `.env` file and API keys.
- **Desktop notifications not working?**
  - On Windows, ensure notifications are enabled in system settings.
- **TP/SL values not persisting?**
  - Check if `position_tp_sl.json` exists and matches your entry price.

---

## ❓ FAQ

**Q: How do I change the trading pair or timeframe?**
- Edit `user_settings.json` for the default timeframe, and run the bot with your desired pair:
  ```sh
  node BitFlow.js ETH/USD
  ```

**Q: Can I use this for live trading?**
- BitFlow is designed for paper trading with Alpaca. Use at your own risk for live trading.

**Q: How do I enable advanced analytics?**
- Set `enablePerformanceMetrics` to `true` in `user_settings.json`.

**Q: How do I reset all preferences?**
- Delete or edit `user_settings.json` to your desired defaults.

---

## 🧩 Advanced Features
- **Dynamic Position Sizing:** Uses Llama API for smarter trade sizes (if enabled).
- **Sentiment Analysis:** Uses Gemini AI for news sentiment (if enabled).
- **Backtesting:** Run historical simulations with `core/backtest.js`.
- **Professional UI:** Modern, color-coded CLI cards and tables.

---

## 📄 Legal & Disclaimer
This software is for educational and research purposes only. Cryptocurrency trading involves substantial risk of loss and is not suitable for all investors. Past performance does not guarantee future results. Always conduct your own research and consider consulting with a financial advisor before making investment decisions. The developers are not responsible for any financial losses incurred through the use of this software.
