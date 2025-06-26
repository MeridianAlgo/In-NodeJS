# Stock Monitor

A Node.js application for monitoring stocks, analyzing moving averages, and executing trades using Alpaca's paper trading API. It fetches price data from Yahoo Finance and Finnhub, and checks market status with Polygon.

## Features
- Real-time and historical price monitoring
- Multiple moving average strategies (SMA, EMA, HMA, etc.)
- Automatic buy/sell signals and paper trading via Alpaca
- Market status checks (Polygon, Yahoo Finance)
- Configurable timeframes (1m, 5m, 15m, 1h, 1d)

## Prerequisites
- Node.js (v14 or higher recommended)
- npm (Node Package Manager)
- API keys for:
  - [Alpaca](https://alpaca.markets/)
  - [Polygon.io](https://polygon.io/) (for market status)
  - [Finnhub](https://finnhub.io/) (for real-time prices)

## Installation

1. **Clone the repository:**
   ```sh
   git clone <repo-url>
   cd Stock
   ```

2. **Install dependencies:**
   You can install all required packages at once with:
   ```sh
   npm install @alpacahq/alpaca-trade-api axios dotenv node-cron ws yahoo-finance2
   ```
   Or simply run:
   ```sh
   npm install
   ```
   if you want to use the dependencies listed in `package.json`.

## Configuration

Create a `.env` file in the root directory with the following variables:

```
ALPACA_API_KEY_ID=your_alpaca_key_id
ALPACA_SECRET_KEY=your_alpaca_secret_key
POLYGON_API_KEY=your_polygon_api_key
FINNHUB_API_KEY=your_finnhub_api_key
```

- All variables are required for full functionality. The app will notify you if any are missing.

## Usage

Run the stock monitor from the command line, providing a stock symbol (e.g., AAPL):

```sh
node stockMonitor.js AAPL
```

- You will be prompted to select a timeframe (e.g., 1m, 5m, 1d, etc.).
- The monitor will fetch historical data, display initial analysis, and begin real-time monitoring.
- Buy/sell signals will be executed using Alpaca's paper trading API.

## Notes
- This project is for educational and paper trading purposes only. **No real money is used.**
- Ensure your API keys are valid and have sufficient access.
- To stop monitoring, press `Ctrl+C` in the terminal.

## Project Structure
- `stockMonitor.js` - Main monitoring and trading logic
- `quantamMA.js` - Moving average analysis engine
- `package.json` - Project dependencies

## License
Mozilla Public License 2.0
