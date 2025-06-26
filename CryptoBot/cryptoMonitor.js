// cryptoMonitor.js
require('dotenv').config();
const yahooFinance = require('yahoo-finance2').default;
const cron = require('node-cron');
const QuantumMA = require('./quantamMA');
const readline = require('readline');
const WebSocket = require('ws');
const axios = require('axios');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const fetch = require('node-fetch'); // Add at the top for Cryptowatch REST API

// Suppress Yahoo Finance survey notice
yahooFinance.suppressNotices(['yahooSurvey']);

class CryptoMonitor {
    constructor(symbol, baseLength = 20, evalPeriod = 20, timeframe = '5Min', polygonKey = process.env.POLYGON_API_KEY) {
        this.symbol = symbol.toUpperCase(); // e.g., BTC/USD
        this.quantumMA = new QuantumMA(baseLength, evalPeriod);
        this.previousPrices = [];
        this.previousMA = [];
        this.isMonitoring = false;
        this.timeframe = timeframe;
        this.validTimeframes = {
            '1Min': '1 Minute',
            '5Min': '5 Minutes',
            '15Min': '15 Minutes',
            '1Hour': '1 Hour',
            '1Day': '1 Day'
        };
        this.finnhubKey = process.env.FINNHUB_API_KEY;
        this.ws = null;
        this.currentPrice = null;
        this.polygonKey = polygonKey;
        this.marketStatus = null;
        this.lastSignal = null;
        this.historicalData = [];
        this.alpaca = new Alpaca({
            keyId: process.env.ALPACA_API_KEY_ID,
            secretKey: process.env.ALPACA_SECRET_KEY,
            paper: true,
            usePolygon: false
        });
        this.position = null;
        this.lastMarketCheck = false;
        this.accumulatedPrices = []; // Store prices if insufficient data
    }

    static async configureTimeframe() {
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        const validTimeframes = {
            '1Min': '1 Minute',
            '5Min': '5 Minutes',
            '15Min': '15 Minutes',
            '1Hour': '1 Hour',
            '1Day': '1 Day'
        };
        console.log('\n=== Timeframe Configuration ===');
        console.log('Available timeframes:');
        Object.entries(validTimeframes).forEach(([key, value]) => {
            console.log(`${key}: ${value}`);
        });
        return new Promise((resolve) => {
            rl.question('\nSelect timeframe (default: 5Min): ', (answer) => {
                rl.close();
                const tfMap = {
                    '1min': '1Min', '1 min': '1Min', '1minute': '1Min', '1 minute': '1Min', '1Min': '1Min',
                    '5min': '5Min', '5 min': '5Min', '5minute': '5Min', '5 minutes': '5Min', '5Min': '5Min',
                    '15min': '15Min', '15 min': '15Min', '15minute': '15Min', '15 minutes': '15Min', '15Min': '15Min',
                    '1hour': '1Hour', '1 hour': '1Hour', '1hr': '1Hour', '1Hr': '1Hour', '1Hour': '1Hour',
                    '1day': '1Day', '1 day': '1Day', '1Day': '1Day'
                };
                const tf = tfMap[answer.trim()] || '5Min';
                console.log(`\nSelected timeframe: ${tf}`);
                resolve(tf);
            });
        });
    }

    // --- Fetch historical OHLCV from Alpaca REST API ---
    async fetchAlpacaHistorical(symbol, timeframe = this.timeframe, limit = 1000) {
        const url = `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`;
        try {
            const resp = await axios.get(url, {
                headers: {
                    'Apca-Api-Key-Id': process.env.ALPACA_API_KEY_ID,
                    'Apca-Api-Secret-Key': process.env.ALPACA_SECRET_KEY
                }
            });
            const bars = resp.data.bars && resp.data.bars[symbol];
            if (!bars || !Array.isArray(bars) || bars.length === 0) {
                throw new Error('No OHLCV data from Alpaca');
            }
            return bars;
        } catch (err) {
            console.error('Error fetching Alpaca OHLCV:', err.message);
            return [];
        }
    }

    // --- Market Status Check ---
    async checkMarketStatus() {
        // 1. Check if crypto market is open using Polygon
        let polygonStatus = {
            available: !!this.polygonKey,
            open: false,
            message: '',
            error: null
        };
        if (this.polygonKey) {
            try {
                const marketResponse = await axios.get(
                    'https://api.polygon.io/v1/marketstatus/now',
                    { headers: { 'Authorization': `Bearer ${this.polygonKey}` } }
                );
                if (marketResponse.data && marketResponse.data.currencies && marketResponse.data.currencies.crypto === 'open') {
                    polygonStatus.open = true;
                    polygonStatus.message = 'Crypto market is OPEN (Polygon)';
                } else {
                    polygonStatus.open = false;
                    polygonStatus.message = 'Crypto market is CLOSED or in maintenance (Polygon)';
                }
            } catch (error) {
                polygonStatus.error = 'Polygon market status check failed: ' + error.message;
            }
        } else {
            polygonStatus.message = 'No Polygon API key provided, skipping Polygon market status check.';
        }
        // 2. Check if the pair is tradable using Alpaca
        const alpacaStatus = await this.checkAlpacaAssetStatus();
        // Only allow monitoring if both Polygon is open and Alpaca is tradable
        const canMonitor = polygonStatus.open && alpacaStatus.tradable;
        return { polygonStatus, alpacaStatus, canMonitor };
    }

    async checkAlpacaAssetStatus() {
        let status = {
            available: true,
            tradable: false,
            message: '',
            error: null
        };
        try {
            // Use Alpaca's getAssets to check if pair is tradable
            const assets = await this.alpaca.getAssets({ asset_class: 'crypto', status: 'active' });
            const found = assets.find(a => (a.symbol === this.symbol || a.symbol === this.symbol.replace('/', '')) && a.tradable);
            if (found) {
                status.tradable = true;
                status.message = `${this.symbol} is available for trading (Alpaca)`;
            } else {
                status.tradable = false;
                status.message = `❌ ${this.symbol} is not available for trading (Alpaca)`;
            }
        } catch (error) {
            status.error = 'Alpaca asset status check failed: ' + error.message;
            status.available = false;
        }
        return status;
    }

    // --- Historical Data Initialization ---
    async initializeHistoricalData() {
        // Use Alpaca for historical OHLCV
        // Fetch at least 2x the baseLength bars for robust MA calculation
        const minBars = Math.max(this.quantumMA.baseLength * 2, 50);
        const bars = await this.fetchAlpacaHistorical(this.symbol, this.timeframe, minBars);
        if (bars.length === 0) {
            console.error('Alpaca historical data unavailable for', this.symbol);
            return false;
        }
        this.historicalData = bars;
        return true;
    }

    // --- Finnhub WebSocket for Real-Time Price Updates ---
    startFinnhubWebSocket() {
        // Finnhub symbol: COINBASE:BTC-USD
        const finnhubSymbol = `COINBASE:${this.symbol.replace('/', '-')}`;
        const ws = new WebSocket(`wss://ws.finnhub.io?token=${this.finnhubKey}`);
        ws.on('open', () => {
            console.log('Connected to Finnhub WebSocket');
            ws.send(JSON.stringify({'type':'subscribe', 'symbol': finnhubSymbol}));
        });
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                if (message.type === 'trade' && message.data) {
                    this.currentPrice = message.data[0].p;
                }
            } catch (error) {
                console.error('Error processing Finnhub message:', error);
            }
        });
        ws.on('error', (error) => {
            console.error('Finnhub WebSocket error:', error);
        });
        ws.on('close', () => {
            console.log('Finnhub WebSocket connection closed');
            setTimeout(() => this.startFinnhubWebSocket(), 5000);
        });
        this.ws = ws;
    }

    // --- Get Crypto Data (for regular updates) ---
    async getCryptoData() {
        // Use Alpaca for latest historical bars
        const bars = await this.fetchAlpacaHistorical(this.symbol, this.timeframe, 1000);
        if (bars.length === 0) {
            console.error('No data from Alpaca');
            return [];
        }
        // Append new prices to accumulatedPrices
        const newPrices = bars.map(b => b.close || b.c);
        // Only add truly new prices
        for (const price of newPrices) {
            if (this.accumulatedPrices.length === 0 || price !== this.accumulatedPrices[this.accumulatedPrices.length - 1]) {
                this.accumulatedPrices.push(price);
            }
        }
        // Limit to last 1000 prices to avoid memory bloat
        if (this.accumulatedPrices.length > 1000) {
            this.accumulatedPrices = this.accumulatedPrices.slice(-1000);
        }
        this.historicalData = bars;
        this.currentPrice = bars[bars.length - 1].c;
        return this.accumulatedPrices;
    }

    // --- Signal Generation ---
    checkSignals(currentPrices, currentMA) {
        if (currentPrices.length < 2 || currentMA.length < 2) return;
        const lastPrice = currentPrices[currentPrices.length - 1];
        const lastMA = currentMA[currentMA.length - 1];
        const prevPrice = currentPrices[currentPrices.length - 2];
        const prevMA = currentMA[currentMA.length - 2];
        if (isNaN(lastPrice) || isNaN(lastMA) || isNaN(prevPrice) || isNaN(prevMA)) {
            console.log('Invalid price or MA values detected, skipping signal generation');
            return;
        }
        let signal = null;
        const analysis = this.quantumMA.analyze(currentPrices);
        if (prevPrice <= prevMA && lastPrice > lastMA) {
            signal = 'BUY';
        } else if (prevPrice >= prevMA && lastPrice < lastMA) {
            signal = 'SELL';
        }
        if (signal && signal !== this.lastSignal) {
            this.lastSignal = signal;
            this.printStatus({
                signal,
                price: lastPrice,
                ma: lastMA,
                maType: analysis.maType,
                maLength: analysis.length,
                score: analysis.score,
                rSquared: analysis.rSquared,
                trendDirection: analysis.trendDirection
            });
            this.executeTrade(signal);
        }
    }

    // --- Logging ---
    printStatus(result) {
        const timestamp = new Date().toLocaleString();
        const signalEmoji = result.signal === 'BUY' ? '🔼' : '🔽';
        console.log('\n' + '='.repeat(50));
        console.log(`=== Regular Update for ${this.symbol} ===`);
        console.log(`Time: ${timestamp}`);
        console.log(`Current Price: $${result.price.toFixed(2)}`);
        console.log(`MA Type: ${result.maType}`);
        console.log(`MA Length: ${result.maLength}`);
        console.log(`MA Value: $${result.ma.toFixed(2)}`);
        console.log(`Trend: ${result.trendDirection}`);
        console.log(`Score: ${result.score.toFixed(4)}`);
        console.log(`R-Squared: ${result.rSquared.toFixed(4)}`);
        if (result.signal) {
            console.log(`\n${signalEmoji} ${result.signal} SIGNAL DETECTED ${signalEmoji}`);
        }
        console.log('='.repeat(50) + '\n');
    }

    // --- Trade Execution ---
    async executeTrade(signal) {
        try {
            if (!this.currentPrice || isNaN(this.currentPrice)) {
                console.error('Invalid current price, cannot execute trade');
                return;
            }
            // Get current positions
            const positions = await this.alpaca.getPositions();
            const currentPosition = positions.find(p => p.symbol === this.symbol.replace('/', ''));
            const quantity = 0.0009; // Fixed quantity for crypto (e.g., 0.001 BTC)
            if (signal === 'BUY' && !currentPosition) {
                console.log(`\n=== Executing BUY Order ===`);
                console.log(`Symbol: ${this.symbol}`);
                console.log(`Quantity: ${quantity}`);
                console.log(`Price: $${this.currentPrice}`);
                console.log(`Position Size: $${(quantity * this.currentPrice).toFixed(2)}`);
                console.log(`Risk: $${(quantity * this.currentPrice * 0.01).toFixed(2)} (1% stop loss)`);
                const order = await this.alpaca.createOrder({
                    symbol: this.symbol.replace('/', ''),
                    qty: quantity,
                    side: 'buy',
                    type: 'market',
                    time_in_force: 'gtc'
                });
                console.log(`Order placed successfully: ${order.id}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                const updatedPositions = await this.alpaca.getPositions();
                const newPosition = updatedPositions.find(p => p.symbol === this.symbol.replace('/', ''));
                if (newPosition) {
                    const entryPrice = parseFloat(newPosition.avg_entry_price);
                    const takeProfitPrice = entryPrice * 1.01;
                    await this.alpaca.createOrder({
                        symbol: this.symbol.replace('/', ''),
                        qty: quantity,
                        side: 'sell',
                        type: 'limit',
                        time_in_force: 'gtc',
                        limit_price: takeProfitPrice
                    });
                    console.log(`Take Profit set at: $${takeProfitPrice.toFixed(2)}`);
                }
            } else if (signal === 'SELL' && currentPosition) {
                console.log(`\n=== Executing SELL Order ===`);
                console.log(`Symbol: ${this.symbol}`);
                console.log(`Quantity: ${currentPosition.qty}`);
                console.log(`Price: $${this.currentPrice}`);
                const order = await this.alpaca.createOrder({
                    symbol: this.symbol.replace('/', ''),
                    qty: currentPosition.qty,
                    side: 'sell',
                    type: 'market',
                    time_in_force: 'gtc'
                });
                console.log(`Order placed successfully: ${order.id}`);
                // Calculate and print profit/loss
                const entryPrice = parseFloat(currentPosition.avg_entry_price);
                const exitPrice = parseFloat(this.currentPrice);
                const quantity = parseFloat(currentPosition.qty);
                const pnl = (exitPrice - entryPrice) * quantity;
                const pnlStr = pnl >= 0 ? `Profit` : `Loss`;
                console.log(`${pnlStr}: $${pnl.toFixed(2)} (Entry: $${entryPrice.toFixed(2)}, Exit: $${exitPrice.toFixed(2)}, Qty: ${quantity})`);
            }
        } catch (error) {
            console.error('Error executing trade:', error.message);
            if (error.response) {
                console.error('Error details:', error.response.data);
            }
        }
    }

    // --- Initial Analysis ---
    async displayInitialAnalysis() {
        try {
            if (!this.historicalData || this.historicalData.length === 0) return;
            const prices = this.historicalData.map(d => d.close || d.c);
            // Store prices for accumulation if not enough data
            this.accumulatedPrices = prices.slice();
            let effectiveLength = this.quantumMA.baseLength;
            if (prices.length < effectiveLength) {
                console.warn(`Not enough data for full MA calculation (need ${effectiveLength}, have ${prices.length}). Using available data.`);
                effectiveLength = prices.length;
            }
            if (!prices.length || prices.some(v => v == null || isNaN(v))) {
                console.warn('No valid price data for MA calculation.');
                return;
            }
            const analysis = this.quantumMA.analyze(prices);
            const currentPrice = prices[prices.length - 1];
            const currentMA = analysis.maValues[analysis.maValues.length - 1];
            console.log('\n=== Market Analysis ===');
            console.log(`Current Price: $${currentPrice.toFixed(2)}`);
            if (prices.length < this.quantumMA.baseLength || currentMA === 0) {
                console.log('MA: N/A (insufficient data)');
            } else {
                console.log(`MA: $${currentMA.toFixed(2)}`);
            }
            console.log(`MA Type: ${analysis.maType}`);
            console.log(`Trend: ${analysis.trendDirection}`);
        } catch (error) {
            console.error('❌ Error in analysis:', error.message);
        }
    }

    // --- Regular Updates ---
    async displayRegularUpdate() {
        try {
            const prices = await this.getCryptoData();
            let effectiveLength = this.quantumMA.baseLength;
            if (prices.length < effectiveLength) {
                console.warn(`Not enough data for full MA calculation (need ${effectiveLength}, have ${prices.length}). Accumulating more data...`);
                // Do not proceed with MA calculation until enough data is available
                return;
            }
            if (!prices.length || prices.some(v => v == null || isNaN(v))) {
                console.warn('No valid price data for MA calculation.');
                return;
            }
            const analysis = this.quantumMA.analyze(prices);
            const currentPrice = prices[prices.length - 1];
            const currentMA = analysis.maValues[analysis.maValues.length - 1];
            const timestamp = new Date().toLocaleString();
            // Only print regular update for 15Min or higher timeframes
            if (this.timeframe === '15Min' || this.timeframe === '1Hour' || this.timeframe === '1Day') {
                console.log('\n' + '='.repeat(50));
                console.log(`=== Regular Update for ${this.symbol} ===`);
                console.log(`Time: ${timestamp}`);
                console.log(`Current Price: $${currentPrice.toFixed(2)}`);
                console.log(`MA Type: ${analysis.maType}`);
                console.log(`MA Length: ${analysis.length}`);
                if (prices.length < this.quantumMA.baseLength || currentMA === 0) {
                    console.log('MA Value: N/A (insufficient data)');
                } else {
                    console.log(`MA Value: $${currentMA.toFixed(2)}`);
                }
                console.log(`Trend: ${analysis.trendDirection}`);
                console.log(`Score: ${analysis.score.toFixed(2)}`);
                console.log(`R-Squared: ${analysis.rSquared.toFixed(2)}`);
                console.log('='.repeat(50));
            }
            // Always check for signals (signal printing is handled in checkSignals)
            this.checkSignals(prices, analysis.maValues);
        } catch (error) {
            console.error('Error in regular update:', error.message);
        }
    }

    // --- Monitoring Control ---
    async startMonitoring() {
        console.log('\n=== Crypto Monitor Initialization ===');
        console.log(`Symbol: ${this.symbol}`);
        console.log(`Timeframe: ${this.timeframe}`);
        this.isMonitoring = true;
        // API Status
        const alpacaInitialized = await this.initializeAlpaca();
        const polygonInitialized = !!this.polygonKey;
        const finnhubInitialized = !!this.finnhubKey;
        if (alpacaInitialized || polygonInitialized || finnhubInitialized) {
            console.log('\n=== API Status ===');
            console.log(`Alpaca: ${alpacaInitialized ? '✅ Connected' : '❌ Not Connected'}`);
            console.log(`Polygon: ${polygonInitialized ? '✅ Connected' : '❌ Not Connected'}`);
            console.log(`Finnhub: ${finnhubInitialized ? '✅ Connected' : '❌ Not Connected'}`);
        }
        // Market Status
        const { polygonStatus, alpacaStatus, canMonitor } = await this.checkMarketStatus();
        if (polygonStatus || alpacaStatus) {
            console.log('\n=== Market Status ===');
            if (polygonStatus.error) {
                console.log(polygonStatus.error);
            } else if (polygonStatus.message) {
                console.log(polygonStatus.message);
            }
            if (alpacaStatus.error) {
                console.log(alpacaStatus.error);
            } else if (alpacaStatus.message) {
                console.log(alpacaStatus.message);
            }
        }
        if (!canMonitor) {
            this.stopMonitoring();
            return;
        }
        // Fetch historical data from Alpaca
        const dataInitialized = await this.initializeHistoricalData();
        if (!dataInitialized) {
            this.stopMonitoring();
            return;
        }
        // Initial Analysis
        await this.displayInitialAnalysis();
        // Finnhub WebSocket
        if (this.finnhubKey) {
            this.startFinnhubWebSocket();
        }
        // Wait for data to stabilize
        console.log('\nWaiting for data to stabilize...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        // Schedule regular updates
        let updateInterval;
        switch(this.timeframe) {
            case '1Min':
                updateInterval = 60 * 1000;
                break;
            case '5Min':
                updateInterval = 5 * 60 * 1000;
                break;
            case '15Min':
                updateInterval = 15 * 60 * 1000;
                break;
            case '1Hour':
                updateInterval = 60 * 60 * 1000;
                break;
            case '1Day':
                updateInterval = 24 * 60 * 60 * 1000;
                break;
            default:
                updateInterval = 5 * 60 * 1000;
        }
        await this.displayRegularUpdate();
        this.monitorInterval = setInterval(async () => {
            if (this.isMonitoring) {
                await this.displayRegularUpdate();
            }
        }, updateInterval);
        console.log('\n✅ Monitoring Active\n');
    }

    async initializeAlpaca() {
        try {
            const account = await this.alpaca.getAccount();
            console.log(`\n=== Alpaca Paper Trading Account ===`);
            console.log(`Buying Power: $${account.buying_power}`);
            console.log(`Portfolio Value: $${account.portfolio_value}`);
            console.log(`Cash: $${account.cash}`);
            return true;
        } catch (error) {
            console.error('Error initializing Alpaca:', error.message);
            return false;
        }
    }

    stopMonitoring() {
        this.isMonitoring = false;
        if (this.ws) {
            this.ws.close();
        }
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
        }
        console.log(`Stopped monitoring ${this.symbol}`);
    }
}

// --- CLI ---
if (require.main === module) {
    (async () => {
        const symbol = process.argv[2];
        if (!symbol) {
            console.log('Please provide a crypto trading pair as a command line argument');
            console.log('Example: node cryptoMonitor.js BTC/USD');
            process.exit(1);
        }
        // Check required environment variables
        const requiredEnvVars = {
            'ALPACA_API_KEY_ID': process.env.ALPACA_API_KEY_ID,
            'ALPACA_SECRET_KEY': process.env.ALPACA_SECRET_KEY,
            'POLYGON_API_KEY': process.env.POLYGON_API_KEY,
            'FINNHUB_API_KEY': process.env.FINNHUB_API_KEY
        };
        const missingVars = Object.entries(requiredEnvVars)
            .filter(([_, value]) => !value)
            .map(([key]) => key);
        if (missingVars.length > 0) {
            console.log('\n❌ Missing required environment variables:');
            missingVars.forEach(varName => console.log(`- ${varName}`));
            console.log('\nPlease create a .env file with these variables:');
            console.log('ALPACA_API_KEY_ID=your_key_here');
            console.log('ALPACA_SECRET_KEY=your_secret_here');
            console.log('POLYGON_API_KEY=your_key_here');
            console.log('FINNHUB_API_KEY=your_key_here');
            process.exit(1);
        }
        const timeframe = await CryptoMonitor.configureTimeframe();
        async function startMonitoring() {
            try {
                const monitor = new CryptoMonitor(symbol, 20, 20, timeframe);
                process.on('SIGINT', () => {
                    monitor.stopMonitoring();
                    process.exit(0);
                });
                await monitor.startMonitoring();
            } catch (error) {
                console.error('Error starting monitor:', error.message);
                process.exit(1);
            }
        }
        startMonitoring();
    })();
}

module.exports = CryptoMonitor; 
