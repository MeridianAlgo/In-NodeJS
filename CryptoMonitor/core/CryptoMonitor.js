const QuantumMA = require('../quantamMA');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const WebSocket = require('ws');
const axios = require('axios');
const { checkLlamaAPI, checkNewsAPI, fetchNewsArticles, fetchArticleText, isCryptoTicker } = require('./apiHelpers');
const { executeTrade } = require('./tradeUtils');
const fetch = require('node-fetch');
const LLAMA_API_KEY = process.env.LLAMA_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;

class CryptoMonitor {
    constructor(symbol, baseLength = 20, evalPeriod = 20, timeframe = '5Min', polygonKey = process.env.POLYGON_API_KEY, takeProfit = 'auto', stopLoss = 'auto', userPreferences = {}) {
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
        this.takeProfit = takeProfit;
        this.stopLoss = stopLoss;
        this.userPreferences = userPreferences || {};
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
        // Finnhub symbol: COINBASE:${this.symbol.replace('/', '-')}
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

    // --- Signal Generation ---
    checkSignals(currentPrices, currentMA) {
        // Only use closed candles: ignore the most recent (possibly in-progress) candle
        if (currentPrices.length < 3 || currentMA.length < 3) return;
        // Use the last two *closed* candles (not the current forming one)
        const prevPrice = currentPrices[currentPrices.length - 3];
        const prevMA = currentMA[currentMA.length - 3];
        const lastPrice = currentPrices[currentPrices.length - 2];
        const lastMA = currentMA[currentMA.length - 2];
        if (isNaN(lastPrice) || isNaN(lastMA) || isNaN(prevPrice) || isNaN(prevMA)) {
            console.log('Invalid price or MA values detected, skipping signal generation');
            return;
        }
        let signal = null;
        const analysis = this.quantumMA.analyze(currentPrices.slice(0, -1)); // Only closed candles
        if (prevPrice <= prevMA && lastPrice > lastMA) {
            signal = 'BUY';
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
            executeTrade(this, signal);
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
        const prompt = `I have $${availableCash} available cash and the current price of ${symbol} is $${price}.\nRecent news headlines and summaries:\n${newsText}\nWhat is the optimal position size in ${symbol.split('/')[0]} to buy, if I want to risk at most 1% of my cash and keep the order size under $100? Also recommend a reasonable take profit % (max 10%) and stop loss % (max 10%) for this trade. Reply as: qty, take_profit_percent, stop_loss_percent. If you don't know, use 1 for both.`;
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
                // Clamp tp/sl to 0.1-10%
                tp = Math.max(0.1, Math.min(tp, 10));
                sl = Math.max(0.1, Math.min(sl, 10));
                // No printing here
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
            // Fetch fresh data instead of using potentially stale historical data
            const freshBars = await this.fetchAlpacaHistorical(this.symbol, this.timeframe, 1000);
            if (!freshBars || freshBars.length === 0) {
                console.warn('No fresh data available for initial analysis');
                return;
            }
            
            const prices = freshBars.map(d => d.close || d.c);
            // Store prices for accumulation if not enough data
            this.accumulatedPrices = prices.slice();
            this.historicalData = freshBars;
            
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
            // Use the latest price from fresh data
            let currentPrice = prices[prices.length - 1];
            const currentMA = analysis.maValues[analysis.maValues.length - 1];
            const timestamp = new Date().toLocaleString();
            console.log('\n=== Market Analysis ===');
            console.log(`Data fetched at: ${timestamp}`);
            console.log(`Current Price: $${currentPrice.toFixed(2)}`);
            // Always print MA Type
            console.log(`MA Type: ${analysis.maType}`);
            if (prices.length < this.quantumMA.baseLength || currentMA === 0) {
                console.log('MA: N/A (insufficient data)');
            } else {
                console.log(`MA: $${currentMA.toFixed(2)}`);
            }
            console.log(`MA Length: ${analysis.length}`);
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
            // --- Position and P/L Logging ---
            if (this.userPreferences.enablePositionLogging) {
                try {
                    const positions = await this.alpaca.getPositions();
                    const pos = positions.find(p => p.symbol === this.symbol.replace('/', ''));
                    if (pos) {
                        const entry = parseFloat(pos.avg_entry_price);
                        const qty = parseFloat(pos.qty);
                        const marketValue = parseFloat(pos.market_value);
                        const unrealized = parseFloat(pos.unrealized_pl);
                        const unrealizedPct = parseFloat(pos.unrealized_plpc) * 100;
                        // Fetch current price
                        let currentPrice = this.currentPrice;
                        if (!currentPrice || isNaN(currentPrice)) {
                            // fallback: try to get latest from Alpaca
                            const bars = await this.fetchAlpacaHistorical(this.symbol, this.timeframe, 1);
                            if (bars && bars.length > 0) {
                                currentPrice = bars[bars.length - 1].close || bars[bars.length - 1].c;
                            }
                        }
                        console.log(`\n[CURRENT POSITION]`);
                        console.log(`Symbol: ${this.symbol}`);
                        console.log(`Quantity: ${qty}`);
                        console.log(`Entry Price: $${entry.toFixed(2)}`);
                        console.log(`Current Price: $${currentPrice ? currentPrice.toFixed(2) : 'N/A'}`);
                        console.log(`Market Value: $${marketValue.toFixed(2)}`);
                        console.log(`Unrealized P/L: $${unrealized.toFixed(2)} (${unrealizedPct.toFixed(2)}%)`);
                        console.log(`Take Profit: ${this.takeProfit}`);
                        console.log(`Stop Loss: ${this.stopLoss}`);
                    } else {
                        console.log(`\n[POSITION] No open position for ${this.symbol}`);
                    }
                } catch (e) {
                    console.warn('[POSITION] Could not fetch position info:', e.message);
                }
            }
            // Always check for signals (signal printing is handled in checkSignals)
            this.checkSignals(prices, analysis.maValues);
        } catch (error) {
            console.error('Error in regular update:', error.message);
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

    // --- Helper: Check NewsAPI ---
    async checkNewsAPI() {
        if (!NEWS_API_KEY) return false;
        try {
            const url = `https://newsapi.org/v2/everything?q=AAPL&sortBy=publishedAt&language=en&apiKey=${NEWS_API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();
            return data.status === 'ok' && Array.isArray(data.articles) && data.articles.length > 0;
        } catch (err) {
            return false;
        }
    }

    // --- Monitoring Control ---
    async startMonitoring() {
        console.log('\n=== Crypto Monitor Initialization ===');
        console.log(`Symbol: ${this.symbol}`);
        console.log(`Timeframe: ${this.timeframe}`);
        // Label current position if it exists
        try {
            const positions = await this.alpaca.getPositions();
            const pos = positions.find(p => p.symbol === this.symbol.replace('/', ''));
            if (pos) {
                const entry = parseFloat(pos.avg_entry_price);
                const qty = parseFloat(pos.qty);
                const marketValue = parseFloat(pos.market_value);
                const unrealized = parseFloat(pos.unrealized_pl);
                const unrealizedPct = parseFloat(pos.unrealized_plpc) * 100;
                console.log(`\n[CURRENT POSITION] ${this.symbol}: Qty=${qty}, Entry=$${entry.toFixed(2)}, Market Value=$${marketValue.toFixed(2)}, Unrealized P/L=$${unrealized.toFixed(2)} (${unrealizedPct.toFixed(2)}%)`);
            }
        } catch (e) {
            console.warn('[CURRENT POSITION] Could not fetch position info:', e.message);
        }
        this.isMonitoring = true;
        // Alpaca Paper Trading Account
        const alpacaInitialized = await this.initializeAlpaca();
        // API Status
        const polygonInitialized = !!this.polygonKey;
        const finnhubInitialized = !!this.finnhubKey;
        // Check Llama and NewsAPI
        const [llamaConnected, newsAPIConnected] = await Promise.all([
            this.checkLlamaAPI(),
            this.checkNewsAPI()
        ]);
        if (alpacaInitialized || polygonInitialized || finnhubInitialized || llamaConnected || newsAPIConnected) {
            console.log('\n=== API Status ===');
            console.log(`Alpaca: ${alpacaInitialized ? '✅ Connected' : '❌ Not Connected'}`);
            console.log(`Polygon: ${polygonInitialized ? '✅ Connected' : '❌ Not Connected'}`);
            console.log(`Finnhub: ${finnhubInitialized ? '✅ Connected' : '❌ Not Connected'}`);
            console.log(`Llama: ${llamaConnected ? '✅ Connected' : '❌ Not Connected'} (Test: What is 2+2?${llamaConnected ? ' 4' : ' Error'})`);
            console.log(`NewsAPI: ${newsAPIConnected ? '✅ Connected' : '❌ Not Connected'}`);
        }
        // Market Status
        const { polygonStatus, alpacaStatus, canMonitor } = await this.checkMarketStatus();
        if (polygonStatus || alpacaStatus) {
            console.log('\n=== Market Status ===');
            if (polygonStatus.message) {
                console.log(`Crypto market is ${polygonStatus.open ? 'OPEN' : 'CLOSED'} (Polygon)`);
            }
            if (alpacaStatus.message) {
                console.log(`${this.symbol} is ${alpacaStatus.tradable ? 'available for trading' : 'not available for trading'} (Alpaca)`);
            }
            if (polygonStatus.error) {
                console.log(polygonStatus.error);
            }
            if (alpacaStatus.error) {
                console.log(alpacaStatus.error);
            }
        }
        if (!canMonitor) {
            this.stopMonitoring();
            process.exit(1);
            return;
        }
        // Fetch historical data from Alpaca
        const dataInitialized = await this.initializeHistoricalData();
        if (!dataInitialized) {
            this.stopMonitoring();
            process.exit(1);
            return;
        }
        // Initial Analysis
        await this.displayInitialAnalysis();
        // Finnhub WebSocket
        if (this.finnhubKey) {
            this.startFinnhubWebSocket();
            // Give WebSocket a moment to connect and receive initial data
            await new Promise(resolve => setTimeout(resolve, 2000));
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

        // --- Heartbeat for 1Min, 5Min, 15Min timeframes ---
        if (["1Min", "5Min", "15Min"].includes(this.timeframe)) {
            this.heartbeatInterval = setInterval(() => {
                const now = new Date().toLocaleString();
                console.log(`\n[BOT HEARTBEAT] Still running for ${this.symbol} at ${now}`);
            }, 10 * 60 * 1000); // every 10 minutes
        }
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
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        console.log(`Stopped monitoring ${this.symbol}`);
    }
}

module.exports = CryptoMonitor; 