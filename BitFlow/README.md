# BitFlow (formaly CryptoMonitor)

BitFlow is a crypto trading bot that uses modern Node.js and Python tools to automate trading, backtesting, and monitoring. It features a modern CLI UI, dynamic position sizing, and advanced analytics.

## User Settings

**All user preferences are now read directly from `user_settings.json`.**

- To change the bot's behavior, simply edit `user_settings.json` in the project root.
- The bot will always use the current values from this file—no merging, no prompts, no confusion.
- You do **not** need to pass preferences anywhere in the code; all logic and UI read directly from this file.

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

### How It Works
- When you run the bot, it loads `user_settings.json` and uses those settings everywhere.
- The UI and all trading logic always reflect the current settings in this file.
- To change metrics, crossunder, logging, or any other preference, just edit the file and restart the bot.

## Running the Bot

1. Run ```npm install``` on your terminal with your folder open
2. Run the bot:
   ```sh
   node BitFlow.js BTC/USD
   ```
3. The UI will show your settings live.

## No More Merging or Prompts
- All previous logic for merging, spreading, or prompting for preferences has been removed.
- The bot is now always in sync with your `user_settings.json` file.

---

For more details on advanced features, see the rest of this README or the code comments.
