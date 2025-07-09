const Alpaca = require('@alpacahq/alpaca-trade-api');
const WebSocket = require('ws');
const axios = require('axios');
const { checkLlamaAPI, checkPolygonNewsAPI, fetchPolygonNews, fetchArticleText, isCryptoTicker } = require('./apiHelpers');
const { executeTrade } = require('./tradeUtils');
const fetch = require('node-fetch');
const LLAMA_API_KEY = process.env.LLAMA_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const { SMA, EMA } = require('technicalindicators');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const readline = require('readline');
const { printStatus, printSuccess, printWarning, printError, printBanner, printSection, printCard, printTableCard, printDivider, statusDot, formatMoney, formatNumber } = require('./ui');
const userSettings = require('../user_settings.json');

function boolStatus(val) {
    return val ? chalk.green('Enabled') : chalk.red('Disabled');
}

class BitFlow {
    constructor(symbol, baseLength = 20, evalPeriod = 20, timeframe = '5Min', polygonKey = process.env.POLYGON_API_KEY, takeProfit = 'auto', stopLoss = 'auto') {
        this.symbol = symbol.toUpperCase(); // e.g., BTC/USD
        this.baseLength = baseLength;
        this.evalPeriod = evalPeriod;
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
        this.takeProfit = takeProfit;
        this.stopLoss = stopLoss;
        this.hasPrintedNoPosition = false; // Track if 'No open position' was printed
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

    static async configureCrossunderSignals() {
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        console.log('\n=== Crossunder Signals Configuration ===');
        console.log('This setting controls whether the bot uses MA crossunder signals to sell positions.');
        console.log('When enabled: Bot will sell on MA crossunder OR when TP/SL is hit');
        console.log('When disabled: Bot will ONLY sell when TP/SL is hit (no crossunder signals)');
        
        return new Promise((resolve) => {
            rl.question('\nEnable MA crossunder signals for selling? (y/n, default: y): ', (answer) => {
                rl.close();
                const enable = answer.trim().toLowerCase() !== 'n' && answer.trim().toLowerCase() !== 'no';
                console.log(`\nCrossunder signals: ${enable ? 'ENABLED' : 'DISABLED'}`);
                resolve(enable);
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
                    'Apca-Api-Secret-Key': process.env.ALPACA_SECRET_KEY,
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
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
        const minBars = Math.max(this.baseLength * 2, 50);
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
        // Finnhub symbol: COINBASE:${this.symbol.replace('/', '-')}
        const finnhubSymbol = `COINBASE:${this.symbol.replace('/', '-')}`;
        const ws = new WebSocket(`wss://ws.finnhub.io?token=${this.finnhubKey}`);
        ws.on('open', () => {
            console.log('📡 Connected to Finnhub WebSocket');
            ws.send(JSON.stringify({'type':'subscribe', 'symbol': finnhubSymbol}));
        });
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                if (message.type === 'trade' && message.data) {
                    this.currentPrice = message.data[0].p;
                }
            } catch (error) {
                console.error('❌ Error processing Finnhub message:', error);
            }
        });
        ws.on('error', (error) => {
            console.error('❌ Finnhub WebSocket error:', error);
        });
        ws.on('close', () => {
            console.log('📡 Finnhub WebSocket connection closed');
            setTimeout(() => this.startFinnhubWebSocket(), 5000);
        });
        this.ws = ws;
    }

    // --- Get Crypto Data (for regular updates) ---
    async getCryptoData() {
        // Use Alpaca for latest historical bars with fresh data
        const bars = await this.fetchAlpacaHistorical(this.symbol, this.timeframe, 1000);
        if (bars.length === 0) {
            console.error('No data from Alpaca');
            return [];
        }
        
        // Update historical data with fresh bars
        this.historicalData = bars;
        
        // Get the latest price from the most recent bar
        const latestPrice = bars[bars.length - 1].close || bars[bars.length - 1].c;
        this.currentPrice = latestPrice;
        
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
        
        return this.accumulatedPrices;
    }

    // --- Adaptive MA Crossover + RSI Signal Generation ---
    async checkSignals(prices) {
        if (prices.length < Math.max(this.baseLength, 14) + 2) return;
        // Adaptive: Use volatility to adjust MA lengths
        const recentPrices = prices.slice(-100);
        const volatility = this.calculateVolatility(recentPrices);
        let fastLength = Math.max(5, Math.round((this.baseLength || 20) - (this.volScale || 10) * volatility));
        let slowLength = Math.max(fastLength + 5, Math.round((this.baseLength || 20) + (this.volScale || 10) * volatility));
        // Calculate MAs
        const fastMA = require('technicalindicators').SMA.calculate({ period: fastLength, values: prices });
        const slowMA = require('technicalindicators').EMA.calculate({ period: slowLength, values: prices });
        // Calculate RSI
        const rsi = this.calculateRSI(prices, this.rsiPeriod || 14);
        // Use last two closed candles for crossover
        const idx = prices.length - 2;
        const prevFast = fastMA[fastMA.length - 2];
        const prevSlow = slowMA[slowMA.length - 2];
        const lastFast = fastMA[fastMA.length - 1];
        const lastSlow = slowMA[slowMA.length - 1];
        const lastRSI = rsi[rsi.length - 1];
        let signal = null;
        // Buy if MA crossover and RSI is between 0 and 70
        if (prevFast <= prevSlow && lastFast > lastSlow && lastRSI >= 0 && lastRSI <= 70) {
            signal = 'BUY';
        } else if (prevFast >= prevSlow && lastFast < lastSlow && lastRSI < (this.rsiSellMax || 50) && lastRSI > (this.rsiSellMin || 30)) {
            signal = 'SELL';
        }
        if (signal && signal !== this.lastSignal) {
            this.lastSignal = signal;
            this.printStatus({
                signal,
                price: prices[idx],
                fastMA: lastFast,
                slowMA: lastSlow,
                fastLength,
                slowLength,
                rsi: lastRSI
            });
            if (signal === 'BUY') {
                const currentPosition = await this.getCurrentPosition();
                if (currentPosition.exists && currentPosition.quantity > 0) {
                    console.log('🔄 BUY signal detected but a position is already open. Will not run due to current position.');
                    return;
                }
            }
            require('./tradeUtils').executeTrade(this, signal);
        }
    }

    calculateVolatility(prices) {
        if (prices.length < 2) return 1;
        const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
        const std = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - (returns.reduce((a, b) => a + b, 0) / returns.length), 2), 0) / (returns.length - 1));
        return std * Math.sqrt(365 * 24 * 12); // annualized for 5min bars
    }

    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return [];
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff >= 0) gains += diff; else losses -= diff;
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;
        const rsi = [100 - 100 / (1 + (avgGain / (avgLoss || 1e-10)))];
        for (let i = period + 1; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff >= 0) {
                avgGain = (avgGain * (period - 1) + diff) / period;
                avgLoss = (avgLoss * (period - 1)) / period;
            } else {
                avgGain = (avgGain * (period - 1)) / period;
                avgLoss = (avgLoss * (period - 1) - diff) / period;
            }
            rsi.push(100 - 100 / (1 + (avgGain / (avgLoss || 1e-10))));
        }
        return rsi;
    }

    // --- Logging ---
    printStatus(result) {
        const timestamp = new Date().toLocaleString();
        const signalEmoji = result.signal === 'BUY' ? '🔼' : '🔽';
        printBanner('MARKET UPDATE - ' + this.symbol);
        printStatus('Time: ' + timestamp);
        printStatus('Price: $' + result.price.toFixed(2));
        printStatus('Fast MA: $' + (result.fastMA ? result.fastMA.toFixed(2) : 'N/A'));
        printStatus('Slow MA: $' + (result.slowMA ? result.slowMA.toFixed(2) : 'N/A'));
        printStatus('RSI: ' + (result.rsi ? result.rsi.toFixed(2) : 'N/A'));
        if (result.signal) {
            printWarning(`${signalEmoji} ${result.signal} SIGNAL DETECTED ${signalEmoji}`);
            this.sendDesktopNotification(
                `${result.signal} Signal - ${this.symbol}`,
                `Price: $${result.price.toFixed(2)} | Fast MA: $${result.fastMA ? result.fastMA.toFixed(2) : 'N/A'} | Slow MA: $${result.slowMA ? result.slowMA.toFixed(2) : 'N/A'} | RSI: ${result.rsi ? result.rsi.toFixed(2) : 'N/A'}`
            );
        }
    }

    // --- Desktop Notifications ---
    sendDesktopNotification(title, message) {
        try {
            const notifier = require('node-notifier');
            
            notifier.notify({
                title: title,
                message: message,
                icon: undefined, // Use default icon
                sound: true, // Play notification sound
                timeout: 5000, // Auto-dismiss after 5 seconds
                wait: false // Don't wait for user interaction
            }, (err, response) => {
                if (err) {
                    // Fallback to console notification
                    console.log(`🔔 NOTIFICATION: ${title} - ${message}`);
                }
            });
        } catch (error) {
            // Fallback to console notification
            console.log(`🔔 NOTIFICATION: ${title} - ${message}`);
        }
    }

    // --- Llama API Position Sizing Helper ---
    async getPositionSizeWithLlama(availableCash, price, symbol) {
        if (!LLAMA_API_KEY) {
            console.warn('LLAMA_API_KEY not set in .env. Using fallback sizing.');
            return null;
        }
        // Fetch news (but do not print)
        let ticker = symbol.replace('/', '');
        const newsArticles = await fetchNewsArticles(symbol);
        let newsText = '';
        if (newsArticles && newsArticles.length > 0) {
            const articlesWithContent = await Promise.all(newsArticles.map(async (article, idx) => {
                let mainText = '';
                if (article.url) mainText = await fetchArticleText(article.url);
                return `${idx + 1}. ${article.title || ''}\n${article.description || ''}\n${mainText}`;
            }));
            newsText = articlesWithContent.join('\n\n');
        }
        // Alpaca crypto fee: assume 0.25% taker fee for most users
        const feePercent = 0.25;
        const prompt = `I have $${availableCash} available cash and the current price of ${symbol} is $${price}.\nRecent news headlines and summaries:\n${newsText}\nAlpaca charges a 0.25% fee per crypto trade.\nWhat is the optimal position size in ${symbol.split('/')[0]} to buy, if I want to risk at most 1% of my cash and keep the order size under $100? Also recommend a reasonable take profit % (must be between 0.1% and 1%) and stop loss % (max 10%) for this trade. Reply as: qty, take_profit_percent, stop_loss_percent. If you don't know, use 1 for both. Only suggest take profit between 0.1 and 1 percent. Subtract the 0.25% fee from the expected profit when making your suggestion.`;
        try {
            const response = await axios.post(
                'https://api.llama.com/v1/chat/completions',
                {
                    model: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
                    messages: [
                        { role: 'system', content: 'You are a trading assistant that calculates optimal position size, take profit %, and stop loss % for a crypto trade. Only reply as: qty, take_profit_percent, stop_loss_percent. All numbers, no explanation.' },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 24
                },
                {
                    headers: {
                        'Authorization': `Bearer ${LLAMA_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            let answer = '';
            if (
                response.data &&
                response.data.completion_message &&
                response.data.completion_message.content &&
                typeof response.data.completion_message.content.text === 'string'
            ) {
                answer = response.data.completion_message.content.text.trim();
            } else if (response.data.choices && response.data.choices[0] && response.data.choices[0].message && response.data.choices[0].message.content) {
                answer = response.data.choices[0].message.content.trim();
            }
            // Parse: qty, take_profit_percent, stop_loss_percent
            const parts = answer.split(',').map(s => parseFloat(s.trim()));
            if (parts.length >= 3 && parts.every(x => !isNaN(x) && x > 0)) {
                let [qty, tp, sl] = parts;
                // Clamp tp to 0.1-1%, sl to 0.1-10%
                tp = Math.max(0.1, Math.min(tp, 1));
                sl = Math.max(0.1, Math.min(sl, 10));
                return { qty, takeProfit: tp, stopLoss: sl };
            }
            // Fallback: just qty
            const match = answer.match(/([0-9]*\.?[0-9]+)/);
            if (match) {
                const qty = parseFloat(match[1]);
                if (!isNaN(qty) && qty > 0) {
                    return { qty, takeProfit: 1, stopLoss: 1 };
                }
            }
            console.warn('Llama API did not return valid sizing. Fallback to default sizing.');
            return null;
        } catch (err) {
            console.error('Llama API position sizing failed:', err.message);
            return null;
        }
    }

    // --- Initial Analysis ---
    async displayInitialAnalysis() {
        try {
            const freshBars = await this.fetchAlpacaHistorical(this.symbol, this.timeframe, 1000);
            if (!freshBars || freshBars.length === 0) {
                printWarning('No fresh data available for initial analysis');
                return;
            }
            const prices = freshBars.map(d => d.close || d.c);
            this.accumulatedPrices = prices.slice();
            this.historicalData = freshBars;
            let effectiveLength = this.baseLength;
            if (prices.length < effectiveLength) {
                printWarning(`Not enough data for full MA calculation (need ${effectiveLength}, have ${prices.length}). Using available data.`);
                effectiveLength = prices.length;
            }
            if (!prices.length || prices.some(v => v == null || isNaN(v))) {
                printWarning('No valid price data for MA calculation.');
                return;
            }
            const volatility = this.calculateVolatility(prices.slice(-100));
            let fastLength = Math.max(5, Math.round((this.baseLength || 20) - (this.volScale || 10) * volatility));
            let slowLength = Math.max(fastLength + 5, Math.round((this.baseLength || 20) + (this.volScale || 10) * volatility));
            const fastMA = SMA.calculate({ period: fastLength, values: prices });
            const slowMA = EMA.calculate({ period: slowLength, values: prices });
            const rsi = this.calculateRSI(prices, this.rsiPeriod || 14);
            let currentPrice = prices[prices.length - 1];
            let currentFastMA = fastMA[fastMA.length - 1];
            let currentSlowMA = slowMA[slowMA.length - 1];
            let currentRSI = rsi[rsi.length - 1];
            let rsiStatus = 'Neutral';
            if (currentRSI >= 70) rsiStatus = 'Bullish';
            else if (currentRSI <= 30) rsiStatus = 'Bearish';
            const timestamp = new Date().toLocaleString();
            printTableCard(`${this.symbol} Market Analysis`, [
                ['Data fetched at', timestamp],
                ['Current Price', formatMoney(currentPrice)],
                [`Fast MA (${fastLength})`, formatMoney(currentFastMA)],
                [`Slow MA (${slowLength})`, formatMoney(currentSlowMA)],
                [`RSI (${this.rsiPeriod || 14})`, `${formatNumber(currentRSI)} [${rsiStatus}]`],
                ['Volatility', formatNumber(volatility, 2)]
            ]);
        } catch (error) {
            printError('❌ Error in analysis: ' + error.message);
            this.sendDesktopNotification('Analysis Error', `Error in analysis: ${error.message}`);
        }
    }

    // --- Regular Updates ---
    async displayRegularUpdate() {
        try {
            const prices = await this.getCryptoData();
            let effectiveLength = this.baseLength;
            if (prices.length < effectiveLength) {
                printWarning(`Not enough data for full MA calculation (need ${effectiveLength}, have ${prices.length}). Accumulating more data...`);
                return;
            }
            if (!prices.length || prices.some(v => v == null || isNaN(v))) {
                printError('No valid price data for MA calculation.');
                return;
            }
            await this.checkSignals(prices);
            if (userSettings.enablePositionLogging) {
                try {
                    const positions = await this.alpaca.getPositions();
                    const pos = positions.find(p => p.symbol === this.symbol.replace('/', ''));
                    if (pos) {
                        const entry = parseFloat(pos.avg_entry_price);
                        const qty = parseFloat(pos.qty);
                        const marketValue = parseFloat(pos.market_value);
                        const unrealized = parseFloat(pos.unrealized_pl);
                        const unrealizedPct = parseFloat(pos.unrealized_plpc) * 100;
                        const pnlEmoji = unrealized >= 0 ? '📈' : '📉';
                        printBanner('POSITION UPDATE - ' + this.symbol);
                        printStatus(`Quantity: ${qty.toFixed(6)} ${this.symbol.split('/')[0]}`);
                        printStatus(`Entry Price: $${entry.toFixed(2)}`);
                        printStatus(`Current Price: $${this.currentPrice ? this.currentPrice.toFixed(2) : 'N/A'}`);
                        printStatus(`Market Value: $${marketValue.toFixed(2)}`);
                        printStatus(`${pnlEmoji} P/L: $${unrealized.toFixed(2)} (${unrealizedPct.toFixed(2)}%)`);
                        printStatus(`Take Profit: ${this.takeProfit}`);
                        printStatus(`Stop Loss: ${this.stopLoss}`);
                        this.hasPrintedNoPosition = false; // Reset flag if position exists
                    } else if (!this.hasPrintedNoPosition) {
                        printWarning(`No open position for ${this.symbol}`);
                        this.hasPrintedNoPosition = true;
                    }
                } catch (e) {
                    printWarning('[POSITION] Could not fetch position info: ' + e.message);
                    this.sendDesktopNotification('Position Error', `Could not fetch position info: ${e.message}`);
                }
            }
        } catch (error) {
            printError('❌ Error in regular update: ' + error.message);
            this.sendDesktopNotification('Update Error', `Error in regular update: ${error.message}`);
        }
    }

    // --- Helper: Check Llama API ---
    async checkLlamaAPI() {
        if (!LLAMA_API_KEY) return false;
        try {
            const response = await axios.post(
                'https://api.llama.com/v1/chat/completions',
                {
                    model: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant.' },
                        { role: 'user', content: 'What is 2+2?' }
                    ],
                    max_tokens: 8
                },
                {
                    headers: {
                        'Authorization': `Bearer ${LLAMA_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            let answer = '';
            if (
                response.data &&
                response.data.completion_message &&
                response.data.completion_message.content &&
                typeof response.data.completion_message.content.text === 'string'
            ) {
                answer = response.data.completion_message.content.text.trim();
            } else if (response.data.choices && response.data.choices[0] && response.data.choices[0].message && response.data.choices[0].message.content) {
                answer = response.data.choices[0].message.content.trim();
            }
            return answer === '4' || answer === '4.' || answer.toLowerCase().includes('4');
        } catch (err) {
            return false;
        }
    }

    // --- Helper: Check Polygon News API ---
    async checkPolygonNewsAPI() {
        if (!this.polygonKey) return false;
        try {
            const url = `https://api.polygon.io/v2/reference/news?apiKey=${this.polygonKey}&limit=1`;
            const response = await fetch(url);
            const data = await response.json();
            return data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0;
        } catch (err) {
            return false;
        }
    }

    // --- Get Current Position Info ---
    async getCurrentPosition() {
        try {
            const positions = await this.alpaca.getPositions();
            const pos = positions.find(p => p.symbol === this.symbol.replace('/', ''));
            if (pos) {
                const entry = parseFloat(pos.avg_entry_price);
                const qty = parseFloat(pos.qty);
                const marketValue = parseFloat(pos.market_value);
                const unrealized = parseFloat(pos.unrealized_pl);
                const unrealizedPct = parseFloat(pos.unrealized_plpc) * 100;
                return {
                    symbol: this.symbol,
                    quantity: qty,
                    entryPrice: entry,
                    marketValue: marketValue,
                    unrealizedPL: unrealized,
                    unrealizedPLPercent: unrealizedPct,
                    exists: true
                };
            }
            return { exists: false };
        } catch (e) {
            console.warn('⚠️ [POSITION] Could not fetch position info:', e.message);
            return { exists: false, error: e.message };
        }
    }

    // --- Display Position Info ---
    displayPositionInfo(position) {
        if (!position || !position.exists) {
            if (!this.hasPrintedNoPosition) {
                printWarning(`No open position for ${this.symbol}`);
                this.hasPrintedNoPosition = true;
            }
            return;
        }
        this.hasPrintedNoPosition = false; // Reset flag if position exists
        const pnlEmoji = position.unrealizedPL >= 0 ? '📈' : '📉';
        printBanner('CURRENT POSITION - ' + this.symbol);
        printStatus(`Quantity: ${position.quantity.toFixed(6)} ${this.symbol.split('/')[0]}`);
        printStatus(`Entry Price: $${position.entryPrice.toFixed(2)}`);
        printStatus(`Market Value: $${position.marketValue.toFixed(2)}`);
        printStatus(`${pnlEmoji} P/L: $${position.unrealizedPL.toFixed(2)} (${position.unrealizedPLPercent.toFixed(2)}%)`);
        if (this.takeProfit !== 'auto' && this.stopLoss !== 'auto') {
            const tpPrice = position.entryPrice * (1 + parseFloat(this.takeProfit) / 100);
            const slPrice = position.entryPrice * (1 - parseFloat(this.stopLoss) / 100);
            printStatus(`Take Profit: $${tpPrice.toFixed(2)} (${this.takeProfit}%)`);
            printStatus(`Stop Loss: $${slPrice.toFixed(2)} (${this.stopLoss}%)`);
        } else {
            printStatus(`Take Profit: ${this.takeProfit}`);
            printStatus(`Stop Loss: ${this.stopLoss}`);
        }
    }

    // --- Save TP/SL Values ---
    saveTPSLValues(symbol, entryPrice, takeProfitPercent, stopLossPercent) {
        // Do nothing (disable logging of TP/SL)
    }

    // --- Load TP/SL Values ---
    loadTPSLValues(symbol) {
        return null; // Always use Llama
    }

    // --- Clear TP/SL Values ---
    clearTPSLValues(symbol) {
        // Do nothing
    }

    // --- Start TP/SL Monitoring for Existing Position ---
    async startExistingPositionMonitoring() {
        const position = await this.getCurrentPosition();
        if (!position.exists) return;
        this.position = position;
        let takeProfitPercent = this.takeProfit;
        let stopLossPercent = this.stopLoss;
        const savedTPSL = this.loadTPSLValues(this.symbol);
        if (savedTPSL) {
            const priceDiff = Math.abs(savedTPSL.entryPrice - position.entryPrice) / position.entryPrice;
            if (priceDiff < 0.01) {
                takeProfitPercent = savedTPSL.takeProfit;
                stopLossPercent = savedTPSL.stopLoss;
                printStatus(`Loaded saved TP/SL values: TP ${takeProfitPercent}%, SL ${stopLossPercent}%`);
            } else {
                printWarning(`Saved TP/SL values don't match current position entry price. Using defaults.`);
                this.clearTPSLValues(this.symbol);
            }
        }
        if (takeProfitPercent === 'auto') takeProfitPercent = 1;
        if (stopLossPercent === 'auto') stopLossPercent = 1;
        takeProfitPercent = parseFloat(takeProfitPercent);
        stopLossPercent = parseFloat(stopLossPercent);
        printBanner('TP/SL MONITORING STARTED');
        printStatus(`Entry: $${position.entryPrice.toFixed(2)}`);
        printStatus(`Take Profit: ${takeProfitPercent}%`);
        printStatus(`Stop Loss: ${stopLossPercent}%`);
        const { monitorTakeProfitStopLoss } = require('./tradeUtils');
        monitorTakeProfitStopLoss(this, position.entryPrice, position.quantity, takeProfitPercent, stopLossPercent);
    }

    // --- Monitoring Control ---
    async startMonitoring() {
        if (process.stdout.isTTY) {
            process.stdout.write('\x1Bc');
        }
        // --- Modern Card UI ---
        // Header Card
        printCard(
            `${this.symbol} Monitor`,
            [
                `Symbol: ${this.symbol}    Timeframe: ${this.timeframe}`,
                `Crossunder: ${statusDot(userSettings.enableCrossunderSignals)} ${boolStatus(userSettings.enableCrossunderSignals)}`,
                `Metrics: ${statusDot(userSettings.enablePerformanceMetrics)} ${boolStatus(userSettings.enablePerformanceMetrics)}`,
                `Logging: ${statusDot(userSettings.enablePositionLogging)} ${boolStatus(userSettings.enablePositionLogging)}`,
                this.hasPrintedNoPosition ? 'No open position' : ''
            ]
        );
        // Account Info Card (after Alpaca init)
        const existingPosition = await this.getCurrentPosition();
        this.displayPositionInfo(existingPosition);
        if (existingPosition.exists) {
            await this.startExistingPositionMonitoring();
        }
        this.isMonitoring = true;
        const account = await this.getAccountInfo();
        if (account) {
            printTableCard('Alpaca Paper Trading', [
                ['Buying Power', formatMoney(account.buying_power)],
                ['Portfolio Value', formatMoney(account.portfolio_value)],
                ['Cash', formatMoney(account.cash)]
            ]);
        }
        // API Status Card
        const alpacaInitialized = !!account;
        const polygonInitialized = !!this.polygonKey;
        const finnhubInitialized = !!this.finnhubKey;
        const [llamaConnected, polygonNewsConnected, geminiConnected] = await Promise.all([
            this.checkLlamaAPI(),
            this.checkPolygonNewsAPI(),
            this.checkGeminiAPI()
        ]);
        printTableCard('System Status', [
            ['Alpaca', statusDot(alpacaInitialized) + ' ' + (alpacaInitialized ? 'Connected' : 'Not Connected')],
            ['Polygon', statusDot(polygonInitialized) + ' ' + (polygonInitialized ? 'Connected' : 'Not Connected')],
            ['Finnhub', statusDot(finnhubInitialized) + ' ' + (finnhubInitialized ? 'Connected' : 'Not Connected')],
            ['Llama', statusDot(llamaConnected) + ' ' + (llamaConnected ? 'Connected' : 'Not Connected')],
            ['Polygon News', statusDot(polygonNewsConnected) + ' ' + (polygonNewsConnected ? 'Connected' : 'Not Connected')],
            ['Gemini', statusDot(geminiConnected) + ' ' + (geminiConnected ? 'Connected' : 'Not Connected')]
        ]);
        // Market Status Card
        const { polygonStatus, alpacaStatus, canMonitor } = await this.checkMarketStatus();
        printTableCard('Market Status', [
            ['Market', polygonStatus.open ? chalk.green('OPEN') : chalk.red('CLOSED')],
            [this.symbol, alpacaStatus.tradable ? chalk.green('Tradable') : chalk.red('Not Tradable')]
        ]);
        if (polygonStatus.error) {
            printWarning(`⚠️ ${polygonStatus.error}`);
            this.sendDesktopNotification('Market Error', polygonStatus.error);
        }
        if (alpacaStatus.error) {
            printWarning(`⚠️ ${alpacaStatus.error}`);
            this.sendDesktopNotification('Market Error', alpacaStatus.error);
        }
        if (!canMonitor) {
            printError('Cannot start monitoring - market conditions not met');
            this.sendDesktopNotification('Monitor Error', 'Cannot start monitoring - market conditions not met');
            this.stopMonitoring();
            process.exit(1);
            return;
        }
        const dataInitialized = await this.initializeHistoricalData();
        if (!dataInitialized) {
            printError('Cannot start monitoring - historical data unavailable');
            this.sendDesktopNotification('Data Error', 'Cannot start monitoring - historical data unavailable');
            this.stopMonitoring();
            process.exit(1);
            return;
        }
        await this.displayInitialAnalysis();
        if (this.finnhubKey) {
            this.startFinnhubWebSocket();
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        printDivider();
        printStatus(chalk.gray('Waiting for data to stabilize...'));
        await new Promise(resolve => setTimeout(resolve, 30000));
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
        // --- Heartbeat for 1Min, 5Min, 15Min timeframes ---
        if (["1Min", "5Min", "15Min"].includes(this.timeframe)) {
            this.heartbeatInterval = setInterval(() => {
                const now = new Date().toLocaleString();
                printStatus(`💓 [HEARTBEAT] Still running for ${this.symbol} at ${now}`);
            }, 10 * 60 * 1000);
        }
        // Load and print last 5 sold positions for this symbol
        const soldPositions = loadSoldPositions(this.symbol);
        if (soldPositions.length > 0) {
            printBanner(`Last 5 sold positions for ${this.symbol}`);
            soldPositions.slice(-5).forEach(pos => {
                printStatus(`Date: ${pos.exit_date}, Entry: $${pos.entry_price}, Exit: $${pos.exit_price}, PnL: $${pos.pnl}, Reason: ${pos.reason}`);
            });
        } else {
            printWarning(`No sold positions found for ${this.symbol}.`);
        }
        printBanner(`MONITORING ACTIVE - ${this.symbol}`);
        this.sendDesktopNotification('Monitor Started', `Successfully started monitoring ${this.symbol}`);
        this.listenForManualSell();
    }

    async initializeAlpaca() {
        try {
            const account = await this.alpaca.getAccount();
            console.log('\n' + '-'.repeat(50));
            console.log(`ALPACA PAPER TRADING ACCOUNT`);
            console.log('-'.repeat(50));
            console.log(`Buying Power: $${account.buying_power}`);
            console.log(`Portfolio Value: $${account.portfolio_value}`);
            console.log(`Cash: $${account.cash}`);
            console.log('-'.repeat(50));
            return true;
        } catch (error) {
            console.error('❌ Error initializing Alpaca:', error.message);
            this.sendDesktopNotification('Alpaca Error', `Error initializing Alpaca: ${error.message}`);
            return false;
        }
    }

    async getAccountInfo() {
        try {
            const account = await this.alpaca.getAccount();
            return account;
        } catch (error) {
            printError('❌ Error initializing Alpaca: ' + error.message);
            this.sendDesktopNotification('Alpaca Error', `Error initializing Alpaca: ${error.message}`);
            return null;
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
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        console.log(`\n🛑 Stopped monitoring ${this.symbol}`);
    }

    // --- Toggle Crossunder Signals ---
    toggleCrossunderSignals() {
        userSettings.enableCrossunderSignals = !userSettings.enableCrossunderSignals;
        const status = userSettings.enableCrossunderSignals ? 'ENABLED' : 'DISABLED';
        console.log(`\n🔄 Crossunder signals ${status.toLowerCase()}`);
        this.sendDesktopNotification('Setting Changed', `Crossunder signals ${status.toLowerCase()}`);
        
        // Save to user settings file
        try {
            const fs = require('fs');
            const path = require('path');
            const settingsFile = path.join(__dirname, '../user_settings.json');
            
            let settings = {};
            if (fs.existsSync(settingsFile)) {
                settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
            }
            
            settings.enableCrossunderSignals = userSettings.enableCrossunderSignals;
            fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
        } catch (error) {
            console.warn('Could not save crossunder signals setting:', error.message);
        }
    }

    async autoConfigure() {
        const params = await autoOptimizeParams(this.symbol, this.timeframe);
        this.baseLength = params.baseLength;
        this.evalPeriod = params.evalPeriod;
        this.volScale = params.volScale;
        this.rsiPeriod = params.rsiPeriod;
        this.rsiBuyMin = params.rsiBuyMin;
        this.rsiBuyMax = params.rsiBuyMax;
        this.rsiSellMin = params.rsiSellMin;
        this.rsiSellMax = params.rsiSellMax;
        console.log('Auto-configured best parameters:', params);
    }

    listenForManualSell() {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.on('line', async (input) => {
            if (input.trim().toLowerCase() === 'sell') {
                console.log(chalk.bold.bgRed.white('Manual sell command received. Attempting to close position...'));
                const pos = await this.getCurrentPosition();
                if (pos.exists && pos.quantity > 0) {
                    try {
                        await this.alpaca.createOrder({
                            symbol: this.symbol.replace('/', ''),
                            qty: pos.quantity,
                            side: 'sell',
                            type: 'market',
                            time_in_force: 'gtc'
                        });
                        await new Promise(res => setTimeout(res, 2000));
                        const exitPrice = this.currentPrice || pos.entryPrice;
                        const pnl = (exitPrice - pos.entryPrice) * pos.quantity;
                        const pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
                        console.log(chalk.greenBright(`Manual sell order placed.`));
                        console.log(chalk.bold.bgMagenta.white(`Manual Sell P/L: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) | Entry: $${pos.entryPrice} | Exit: $${exitPrice}`));
                        this.sendDesktopNotification('Manual Sell', `Manual sell order placed for ${this.symbol}. P/L: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
                    } catch (e) {
                        console.log(chalk.redBright('Manual sell failed:'), e.message);
                        this.sendDesktopNotification('Manual Sell Error', `Manual sell failed: ${e.message}`);
                    }
                } else {
                    console.log(chalk.yellowBright('No open position to sell.'));
                }
            }
        });
    }

    async checkGeminiAPI() {
        if (!GEMINI_API_KEY) return false;
        try {
            const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
            const params = new URLSearchParams({ key: GEMINI_API_KEY });
            const data = { contents: [{ parts: [{ text: 'Hello' }] }] };
            
            const response = await fetch(`${url}?${params.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                timeout: 5000
            });
            
            return response.ok;
        } catch (e) {
            return false;
        }
    }
}

// --- Helper: Run optimizer and cache best params ---
async function autoOptimizeParams(symbol, timeframe, limit = 1000) {
    const cacheFile = path.join(__dirname, `../best_strategy_params_${symbol.replace('/', '')}_${timeframe}.json`);
    // Use cache if exists and is recent (e.g., <24h old)
    if (fs.existsSync(cacheFile)) {
        const stats = fs.statSync(cacheFile);
        if (Date.now() - stats.mtimeMs < 24*60*60*1000) {
            return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        }
    }
    // Fetch data and optimize
    const BitFlow = module.exports;
    const instance = new BitFlow(symbol, 20, 20, timeframe);
    const bars = await instance.fetchAlpacaHistorical(symbol, timeframe, limit);
    const prices = bars.map(b => b.close || b.c).filter(x => !isNaN(x));
    // Inline optimizer (random search)
    let best = null, bestParams = null;
    for (let i = 0; i < 20; i++) {
        const params = {
            baseLength: Math.floor(Math.random()*20)+10,
            evalPeriod: Math.floor(Math.random()*10)+10,
            volScale: Math.random()*10+5,
            rsiPeriod: 14,
            rsiBuyMin: 50+Math.random()*10,
            rsiBuyMax: 60+Math.random()*10,
            rsiSellMin: 30+Math.random()*10,
            rsiSellMax: 40+Math.random()*10
        };
        let position = null, entry = 0, trades = [];
        for (let j = 0; j < prices.length; j++) {
            const slice = prices.slice(0, j+1);
            const volatility = instance.calculateVolatility(slice.slice(-100));
            let fastLength = Math.max(5, Math.round(params.baseLength - volatility * params.volScale));
            let slowLength = Math.max(fastLength + 5, Math.round(params.baseLength + volatility * params.volScale));
            const fastMA = SMA.calculate({ period: fastLength, values: slice });
            const slowMA = EMA.calculate({ period: slowLength, values: slice });
            const rsi = instance.calculateRSI(slice, params.rsiPeriod);
            if (fastMA.length < 2 || slowMA.length < 2 || rsi.length < 1) continue;
            const prevFast = fastMA[fastMA.length-2], prevSlow = slowMA[slowMA.length-2];
            const lastFast = fastMA[fastMA.length-1], lastSlow = slowMA[slowMA.length-1];
            const lastRSI = rsi[rsi.length-1];
            if (!position && prevFast <= prevSlow && lastFast > lastSlow && lastRSI > params.rsiBuyMin && lastRSI < params.rsiBuyMax) {
                position = { entry: slice[slice.length-2] };
                entry = slice[slice.length-2];
            }
            if (position && ((prevFast >= prevSlow && lastFast < lastSlow && lastRSI < params.rsiSellMax && lastRSI > params.rsiSellMin) || j === prices.length-1)) {
                const exit = slice[slice.length-2];
                trades.push({ entry, exit, pnl: exit - entry });
                position = null;
            }
        }
        // Performance
        let pnl = 0, wins = 0, losses = 0, maxDrawdown = 0, peak = 0, equity = 0;
        let equityCurve = [];
        for (const t of trades) {
            pnl += t.pnl;
            if (t.pnl > 0) wins++; else losses++;
            equity += t.pnl;
            peak = Math.max(peak, equity);
            maxDrawdown = Math.max(maxDrawdown, peak - equity);
            equityCurve.push(equity);
        }
        const returns = equityCurve.map((v, i, arr) => i === 0 ? 0 : (v - arr[i-1]) / arr[i-1]).filter(x => !isNaN(x));
        const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
        const std = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length || 1));
        const sharpe = std ? (mean - 0.0005) / std * Math.sqrt(252) : 0;
        if (!best || sharpe > best.sharpe) {
            best = { pnl, winRate: wins/(wins+losses||1), maxDrawdown, sharpe };
            bestParams = params;
        }
    }
    fs.writeFileSync(cacheFile, JSON.stringify(bestParams, null, 2));
    return bestParams;
}

function loadSoldPositions(symbol) {
    const csvPath = path.join(__dirname, '../positions_sold.csv');
    if (!fs.existsSync(csvPath)) return [];
    const data = fs.readFileSync(csvPath, 'utf8').split('\n');
    const headers = data[0].split(',');
    const rows = data.slice(1).filter(Boolean).map(line => {
        const vals = line.split(',');
        const obj = {};
        headers.forEach((h, i) => obj[h.trim()] = vals[i]);
        return obj;
    });
    return rows.filter(r => r.symbol === symbol);
}

module.exports = BitFlow; 