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
        let polygonOpen = false;
        if (this.polygonKey) {
            try {
                const marketResponse = await axios.get(
                    'https://api.polygon.io/v1/marketstatus/now',
                    { headers: { 'Authorization': `Bearer ${this.polygonKey}` } }
                );
                if (marketResponse.data && marketResponse.data.currencies && marketResponse.data.currencies.crypto === 'open') {
                    console.log('Crypto market is OPEN (Polygon)');
                    polygonOpen = true;
                } else {
                    console.log('Crypto market is CLOSED or in maintenance (Polygon)');
                    polygonOpen = false;
                }
            } catch (error) {
                console.error('Polygon market status check failed:', error.message);
            }
        } else {
            console.log('No Polygon API key provided, skipping Polygon market status check.');
        }
        if (!polygonOpen) {
            console.log('Aborting: Crypto market is not open according to Polygon.');
            return false;
        }
        // 2. Check if the pair is tradable using Alpaca
        return this.checkAlpacaAssetStatus();
    }

    async checkAlpacaAssetStatus() {
        try {
            // Use Alpaca's getAssets to check if pair is tradable
            const assets = await this.alpaca.getAssets({ asset_class: 'crypto', status: 'active' });
            const found = assets.find(a => (a.symbol === this.symbol || a.symbol === this.symbol.replace('/', '')) && a.tradable);
            if (found) {
                console.log(`\n=== Market Status (Alpaca) ===`);
                console.log(`${this.symbol} is available for trading (Alpaca)`);
                return true;
            } else {
                console.log(`\n❌ ${this.symbol} is not available for trading (Alpaca)`);
                return false;
            }
        } catch (error) {
            console.error('Alpaca asset status check failed:', error.message);
            return false;
        }
    }

    // --- Historical Data Initialization ---
    async initializeHistoricalData() {
        // Use Alpaca for historical OHLCV
        const bars = await this.fetchAlpacaHistorical(this.symbol, this.timeframe, 1000);
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
        this.historicalData = bars;
        this.currentPrice = bars[bars.length - 1].c;
        return bars.map(b => b.c);
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
            const quantity = 0.001; // Fixed quantity for crypto (e.g., 0.001 BTC)
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
                    time_in_force: 'gtc',
                    extended_hours: true
                });
                console.log(`Order placed successfully: ${order.id}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                const updatedPositions = await this.alpaca.getPositions();
                const newPosition = updatedPositions.find(p => p.symbol === this.symbol.replace('/', ''));
                if (newPosition) {
                    const entryPrice = parseFloat(newPosition.avg_entry_price);
                    const stopLossPrice = entryPrice * 0.99;
                    const takeProfitPrice = entryPrice * 1.01;
                    await this.alpaca.createOrder({
                        symbol: this.symbol.replace('/', ''),
                        qty: quantity,
                        side: 'sell',
                        type: 'stop',
                        time_in_force: 'gtc',
                        stop_price: stopLossPrice,
                        extended_hours: true
                    });
                    await this.alpaca.createOrder({
                        symbol: this.symbol.replace('/', ''),
                        qty: quantity,
                        side: 'sell',
                        type: 'limit',
                        time_in_force: 'gtc',
                        limit_price: takeProfitPrice,
                        extended_hours: true
                    });
                    console.log(`Stop Loss set at: $${stopLossPrice.toFixed(2)}`);
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
                    time_in_force: 'gtc',
                    extended_hours: true
                });
                console.log(`Order placed successfully: ${order.id}`);
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
            if (!prices.length || prices.some(v => v == null || isNaN(v))) {
                console.warn('No valid price data for MA calculation.');
                return;
            }
            const analysis = this.quantumMA.analyze(prices);
            const currentPrice = prices[prices.length - 1];
            const currentMA = analysis.maValues[analysis.maValues.length - 1];
            console.log('\n=== Market Analysis ===');
            console.log(`Current Price: $${currentPrice.toFixed(2)}`);
            console.log(`MA: $${currentMA.toFixed(2)}`);
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
            if (!prices.length || prices.some(v => v == null || isNaN(v))) {
                console.warn('No valid price data for MA calculation.');
                return;
            }
            const analysis = this.quantumMA.analyze(prices);
            const currentPrice = prices[prices.length - 1];
            const currentMA = analysis.maValues[analysis.maValues.length - 1];
            const timestamp = new Date().toLocaleString();
            console.log('\n' + '='.repeat(50));
            console.log(`=== Regular Update for ${this.symbol} ===`);
            console.log(`Time: ${timestamp}`);
            console.log(`Current Price: $${currentPrice.toFixed(2)}`);
            console.log(`MA Type: ${analysis.maType}`);
            console.log(`MA Length: ${analysis.length}`);
            console.log(`MA Value: $${currentMA.toFixed(2)}`);
            console.log(`Trend: ${analysis.trendDirection}`);
            console.log(`Score: ${analysis.score.toFixed(2)}`);
            console.log(`R-Squared: ${analysis.rSquared.toFixed(2)}`);
            console.log('='.repeat(50));
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
        console.log('\n=== API Status ===');
        const alpacaInitialized = await this.initializeAlpaca();
        console.log(`Alpaca: ${alpacaInitialized ? '✅ Connected' : '❌ Not Connected'}`);
        const polygonInitialized = !!this.polygonKey;
        console.log(`Polygon: ${polygonInitialized ? '✅ Connected' : '❌ Not Connected'}`);
        const finnhubInitialized = !!this.finnhubKey;
        console.log(`Finnhub: ${finnhubInitialized ? '✅ Connected' : '❌ Not Connected'}`);
        // Market Status
        const marketStatus = await this.checkMarketStatus();
        if (!marketStatus) {
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