const yahooFinance = require('yahoo-finance2').default;
const cron = require('node-cron');
const QuantumMA = require('./quantamMA');
const readline = require('readline');
const WebSocket = require('ws');
const axios = require('axios');
const Alpaca = require('@alpacahq/alpaca-trade-api');

// Suppress Yahoo Finance survey notice
yahooFinance.suppressNotices(['yahooSurvey']);

class StockMonitor {
    constructor(symbol, baseLength = 20, evalPeriod = 20, timeframe = '1d', polygonKey = process.env.POLYGON_API_KEY) {
        this.symbol = symbol.toUpperCase();
        this.quantumMA = new QuantumMA(baseLength, evalPeriod);
        this.previousPrices = [];
        this.previousMA = [];
        this.isMonitoring = false;
        this.timeframe = timeframe;
        this.validTimeframes = {
            '1m': '1 Minute',
            '5m': '5 Minutes',
            '15m': '15 Minutes',
            '1h': '1 Hour',
            '1d': '1 Day'
        };
        this.finnhubKey = process.env.FINNHUB_API_KEY;
        this.ws = null;
        this.currentPrice = null;
        this.isMarketOpen = false;
        this.polygonKey = polygonKey;
        this.marketStatus = null;
        this.lastPrice = null;
        this.lastVolume = null;
        this.lastUpdate = null;
        this.monitorInterval = null;
        this.historicalData = [];
        this.exchangeMap = {
            'XNAS': 'nasdaq',
            'XNYS': 'nyse',
            'XASE': 'amex',
            'XNCM': 'nasdaq',
            'XNGS': 'nasdaq',
            'XNMS': 'nasdaq'
        };

        // Initialize Alpaca client
        this.alpaca = new Alpaca({
            keyId: process.env.ALPACA_API_KEY_ID,
            secretKey: process.env.ALPACA_SECRET_KEY,
            paper: true, // Use paper trading
            usePolygon: false
        });
        
        this.position = null;
        this.lastSignal = null;
    }

    static async configureTimeframe() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('\n=== Timeframe Configuration ===');
        console.log('Available timeframes:');
        Object.entries({
            '1m': '1 Minute',
            '5m': '5 Minutes',
            '15m': '15 Minutes',
            '1h': '1 Hour',
            '1d': '1 Day'
        }).forEach(([key, value]) => {
            console.log(`${key}: ${value}`);
        });

        return new Promise((resolve) => {
            rl.question('\nSelect timeframe (default: 1d): ', (answer) => {
                rl.close();
                // Convert user-friendly input to timeframe code
                const timeframeMap = {
                    '1 minute': '1m',
                    '1 min': '1m',
                    '1m': '1m',
                    '5 minutes': '5m',
                    '5 mins': '5m',
                    '5m': '5m',
                    '15 minutes': '15m',
                    '15 mins': '15m',
                    '15m': '15m',
                    '1 hour': '1h',
                    '1 hr': '1h',
                    '1h': '1h',
                    '1 day': '1d',
                    '1d': '1d'
                };
                
                const timeframe = timeframeMap[answer.toLowerCase()] || '1d';
                console.log(`\nSelected timeframe: ${timeframe}`);
                resolve(timeframe);
            });
        });
    }

    async checkBasicMarketStatus() {
        try {
            const quote = await yahooFinance.quote(this.symbol);
            const now = new Date();
            const marketTime = new Date(quote.regularMarketTime * 1000);
            const marketOpen = quote.regularMarketOpen;
            const marketClose = quote.regularMarketClose;
            
            const isWeekday = now.getDay() !== 0 && now.getDay() !== 6;
            const currentTime = now.getHours() * 100 + now.getMinutes();
            const marketOpenTime = marketOpen;
            const marketCloseTime = marketClose;
            
            this.isMarketOpen = isWeekday && 
                               currentTime >= marketOpenTime && 
                               currentTime <= marketCloseTime;

            if (!this.isMarketOpen) {
                console.log(`\nMarket is currently closed for ${this.symbol}`);
                console.log(`Market hours: ${marketOpenTime} - ${marketCloseTime}`);
                console.log('Monitoring will resume when market opens');
            } else {
                console.log(`\nMarket is open for ${this.symbol}`);
            }

            return this.isMarketOpen;
        } catch (error) {
            console.error('Error checking basic market status:', error.message);
            return false;
        }
    }

    async checkMarketStatus() {
        try {
            if (!this.polygonKey) {
                return this.checkBasicMarketStatus();
            }

            const marketResponse = await axios.get(
                'https://api.polygon.io/v1/marketstatus/now',
                { 
                    headers: { 
                        'Authorization': `Bearer ${this.polygonKey}`,
                        'Accept': 'application/json'
                    }
                }
            );

            if (!marketResponse.data) {
                throw new Error('No data received from Polygon market status API');
            }

            const marketStatus = marketResponse.data;
            
            const tickerResponse = await axios.get(
                `https://api.polygon.io/v3/reference/tickers/${this.symbol}`,
                { 
                    headers: { 
                        'Authorization': `Bearer ${this.polygonKey}`,
                        'Accept': 'application/json'
                    }
                }
            );

            if (!tickerResponse.data || !tickerResponse.data.results) {
                throw new Error('No data received from Polygon ticker API');
            }

            const exchange = tickerResponse.data.results.primary_exchange;
            const mappedExchange = this.exchangeMap[exchange] || exchange.toLowerCase();
            const exchangeStatus = marketStatus.exchanges[mappedExchange];

            if (!exchangeStatus) {
                return this.checkBasicMarketStatus();
            }

            const isMarketOpen = marketStatus.market === 'open';
            const isExchangeOpen = exchangeStatus === 'open';
            const isPreMarket = marketStatus.earlyHours;
            const isAfterHours = marketStatus.afterHours;
            
            this.marketStatus = {
                isOpen: isMarketOpen || isExchangeOpen || isPreMarket || isAfterHours,
                isPreMarket: isPreMarket,
                isAfterHours: isAfterHours,
                nextOpen: exchangeStatus.next_market_open ? new Date(exchangeStatus.next_market_open) : null,
                nextClose: exchangeStatus.next_market_close ? new Date(exchangeStatus.next_market_close) : null
            };

            // Only print detailed status on initial check
            if (!this.lastMarketCheck) {
                console.log(`\n=== Market Status for ${this.symbol} ===`);
                console.log(`Exchange: ${mappedExchange}`);
                console.log(`Overall Market Status: ${marketStatus.market}`);
                console.log(`Exchange Status: ${exchangeStatus}`);
                
                if (this.marketStatus.isPreMarket) {
                    console.log('🕒 Currently in Pre-Market');
                } else if (this.marketStatus.isAfterHours) {
                    console.log('🌙 Currently in After-Hours');
                } else if (this.marketStatus.isOpen) {
                    console.log('✅ Market is Open');
                } else {
                    console.log('❌ Market is Closed');
                    if (this.marketStatus.nextOpen) {
                        console.log(`Next Open: ${this.marketStatus.nextOpen.toLocaleString()}`);
                    }
                }
                this.lastMarketCheck = true;
            }

            return this.marketStatus.isOpen;
        } catch (error) {
            console.error('Error checking market status:', error.message);
            return this.checkBasicMarketStatus();
        }
    }

    async startMonitoring() {
        console.log('\n=== Stock Monitor Initialization ===');
        console.log(`Symbol: ${this.symbol}`);
        
        this.isMonitoring = true;

        // Initialize APIs
        console.log('\n=== API Status ===');
        
        // Initialize Alpaca
        const alpacaInitialized = await this.initializeAlpaca();
        console.log(`Alpaca: ${alpacaInitialized ? '✅ Connected' : '❌ Not Connected'}`);
        
        // Initialize Polygon
        const polygonInitialized = !!this.polygonKey;
        console.log(`Polygon: ${polygonInitialized ? '✅ Connected' : '❌ Not Connected'}`);
        
        // Initialize Finnhub
        const finnhubInitialized = !!this.finnhubKey;
        console.log(`Finnhub: ${finnhubInitialized ? '✅ Connected' : '❌ Not Connected'}`);

        // Initialize with historical data
        const dataInitialized = await this.initializeHistoricalData();
        if (!dataInitialized) {
            console.error('❌ Failed to initialize market data');
            this.stopMonitoring();
            return;
        }

        // Display initial analysis
        await this.displayInitialAnalysis();

        // Start Finnhub WebSocket for real-time price updates
        if (this.finnhubKey) {
            this.startFinnhubWebSocket();
        }

        // Wait for initial data to stabilize (skip first few updates)
        console.log('\nWaiting for data to stabilize...');
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

        // Schedule regular updates based on timeframe
        let updateInterval;
        switch(this.timeframe) {
            case '1m':
                updateInterval = 60000; // 1 minute
                break;
            case '5m':
                updateInterval = 300000; // 5 minutes
                break;
            case '15m':
                updateInterval = 900000; // 15 minutes
                break;
            case '1h':
                updateInterval = 3600000; // 1 hour
                break;
            case '1d':
                updateInterval = 86400000; // 1 day
                break;
            default:
                updateInterval = 86400000;
        }

        // Display initial update
        await this.displayRegularUpdate();

        // Set up regular updates
        setInterval(async () => {
            if (this.isMonitoring) {
                await this.displayRegularUpdate();
            }
        }, updateInterval);

        console.log('\n✅ Monitoring Active\n');
    }

    async initializeHistoricalData() {
        try {
            // Map our intervals to Yahoo Finance compatible intervals
            const intervalMap = {
                '1m': '1m',
                '5m': '5m',
                '15m': '15m',
                '1h': '1h',
                '1d': '1d'
            };

            const yahooInterval = intervalMap[this.timeframe];
            
            // Calculate date range based on timeframe
            const endDate = new Date();
            const startDate = new Date();
            
            // Get more historical data to ensure accurate MA calculation
            switch(this.timeframe) {
                case '1m':
                    startDate.setDate(startDate.getDate() - 7); // 7 days for 1m
                    break;
                case '5m':
                    startDate.setDate(startDate.getDate() - 14); // 14 days for 5m
                    break;
                case '15m':
                    startDate.setDate(startDate.getDate() - 21); // 21 days for 15m
                    break;
                case '1h':
                    startDate.setDate(startDate.getDate() - 30); // 30 days for 1h
                    break;
                case '1d':
                default:
                    startDate.setDate(startDate.getDate() - 60); // 60 days for 1d
                    break;
            }
            
            const historicalData = await yahooFinance.chart(this.symbol, {
                period1: startDate,
                period2: endDate,
                interval: yahooInterval
            });

            if (!historicalData || !historicalData.quotes || historicalData.quotes.length === 0) {
                throw new Error('No historical data received');
            }

            // Store the full historical data
            this.historicalData = historicalData.quotes;
            
            // Extract just the closing prices for MA calculation
            const prices = this.historicalData.map(quote => quote.close);
            
            // Calculate moving averages
            const result = this.quantumMA.analyze(prices);
            this.previousMA = result.maValues;
            
            return true;
        } catch (error) {
            console.error('❌ Error initializing historical data:', error.message);
            return false;
        }
    }

    startFinnhubWebSocket() {
        const ws = new WebSocket(`wss://ws.finnhub.io?token=${this.finnhubKey}`);
        
        ws.on('open', () => {
            console.log('Connected to Finnhub WebSocket');
            ws.send(JSON.stringify({'type':'subscribe', 'symbol': this.symbol}));
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
            // Attempt to reconnect after 5 seconds
            setTimeout(() => this.startFinnhubWebSocket(), 5000);
        });

        this.ws = ws;
    }

    async getStockData() {
        try {
            const endDate = new Date();
            const startDate = new Date();
            
            // Get more historical data for better MA calculation
            switch(this.timeframe) {
                case '1m':
                    startDate.setDate(startDate.getDate() - 7); // 7 days for 1m
                    break;
                case '5m':
                    startDate.setDate(startDate.getDate() - 14); // 14 days for 5m
                    break;
                case '15m':
                    startDate.setDate(startDate.getDate() - 21); // 21 days for 15m
                    break;
                case '1h':
                    startDate.setDate(startDate.getDate() - 30); // 30 days for 1h
                    break;
                case '1d':
                default:
                    startDate.setDate(startDate.getDate() - 60); // 60 days for 1d
                    break;
            }

            const result = await yahooFinance.chart(this.symbol, {
                period1: startDate,
                period2: endDate,
                interval: this.timeframe
            });

            if (!result.quotes || result.quotes.length === 0) {
                throw new Error('No data received from Yahoo Finance');
            }

            // Update historical data
            this.historicalData = result.quotes;
            
            // Update current price from the latest quote
            this.currentPrice = result.quotes[result.quotes.length - 1].close;
            
            // Return just the closing prices
            return result.quotes.map(quote => quote.close);
        } catch (error) {
            console.error(`Error fetching data for ${this.symbol}:`, error.message);
            return [];
        }
    }

    checkSignals(currentPrices, currentMA) {
        if (currentPrices.length < 2 || currentMA.length < 2) return;

        const lastPrice = currentPrices[currentPrices.length - 1];
        const lastMA = currentMA[currentMA.length - 1];
        const prevPrice = currentPrices[currentPrices.length - 2];
        const prevMA = currentMA[currentMA.length - 2];

        // Only generate signals if price and MA are valid numbers
        if (isNaN(lastPrice) || isNaN(lastMA) || isNaN(prevPrice) || isNaN(prevMA)) {
            console.log('Invalid price or MA values detected, skipping signal generation');
            return;
        }

        let signal = null;

        // Get MA analysis
        const analysis = this.quantumMA.analyze(currentPrices);

        // Check for crossover/crossunder (matching Pine Script logic)
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

    stopMonitoring() {
        this.isMonitoring = false;
        if (this.ws) {
            this.ws.close();
        }
        console.log(`Stopped monitoring ${this.symbol}`);
    }

    async initializeAlpaca() {
        try {
            // Get account information
            const account = await this.alpaca.getAccount();
            console.log(`\n=== Alpaca Paper Trading Account ===`);
            console.log(`Buying Power: $${account.buying_power}`);
            console.log(`Portfolio Value: $${account.portfolio_value}`);
            console.log(`Cash: $${account.cash}`);
            
            // Get current positions
            const positions = await this.alpaca.getPositions();
            if (positions && positions.length > 0) {
                console.log('\n=== Current Positions ===');
                positions.forEach(position => {
                    console.log(`\nSymbol: ${position.symbol}`);
                    console.log(`Quantity: ${position.qty}`);
                    console.log(`Entry Price: $${position.avg_entry_price}`);
                    console.log(`Current Price: $${position.current_price}`);
                    console.log(`Market Value: $${position.market_value}`);
                    console.log(`Unrealized P/L: $${position.unrealized_pl}`);
                    console.log(`Side: ${position.side}`);
                });
            } else {
                console.log('\nNo current positions');
            }
            
            return true;
        } catch (error) {
            console.error('Error initializing Alpaca:', error.message);
            return false;
        }
    }

    async executeTrade(signal) {
        try {
            // Ensure we have a valid current price
            if (!this.currentPrice || isNaN(this.currentPrice)) {
                console.error('Invalid current price, cannot execute trade');
                return;
            }

            // Get current positions
            const positions = await this.alpaca.getPositions();
            const currentPosition = positions.find(p => p.symbol === this.symbol);

            if (signal === 'BUY' && !currentPosition) {
                // Fixed quantity of 1 share
                const quantity = 1;

                console.log(`\n=== Executing BUY Order ===`);
                console.log(`Symbol: ${this.symbol}`);
                console.log(`Quantity: ${quantity}`);
                console.log(`Price: $${this.currentPrice}`);
                console.log(`Position Size: $${(quantity * this.currentPrice).toFixed(2)}`);
                console.log(`Risk: $${(quantity * this.currentPrice * 0.01).toFixed(2)} (1% stop loss)`);
                
                // Create market order
                const order = await this.alpaca.createOrder({
                    symbol: this.symbol,
                    qty: quantity,
                    side: 'buy',
                    type: 'market',
                    time_in_force: 'day',
                    extended_hours: false // Only trade during regular market hours
                });
                
                console.log(`Order placed successfully: ${order.id}`);
                
                // Wait for order to fill
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Get updated position
                const updatedPositions = await this.alpaca.getPositions();
                const newPosition = updatedPositions.find(p => p.symbol === this.symbol);
                
                if (newPosition) {
                    // Set stop loss and take profit orders
                    const entryPrice = parseFloat(newPosition.avg_entry_price);
                    const stopLossPrice = entryPrice * 0.99; // 1% stop loss
                    const takeProfitPrice = entryPrice * 1.01; // 1% take profit
                    
                    // Place stop loss order
                    await this.alpaca.createOrder({
                        symbol: this.symbol,
                        qty: quantity,
                        side: 'sell',
                        type: 'stop',
                        time_in_force: 'gtc',
                        stop_price: stopLossPrice,
                        extended_hours: false
                    });
                    
                    // Place take profit order
                    await this.alpaca.createOrder({
                        symbol: this.symbol,
                        qty: quantity,
                        side: 'sell',
                        type: 'limit',
                        time_in_force: 'gtc',
                        limit_price: takeProfitPrice,
                        extended_hours: false
                    });
                    
                    console.log(`Stop Loss set at: $${stopLossPrice.toFixed(2)}`);
                    console.log(`Take Profit set at: $${takeProfitPrice.toFixed(2)}`);
                }
            } 
            else if (signal === 'SELL' && currentPosition) {
                console.log(`\n=== Executing SELL Order ===`);
                console.log(`Symbol: ${this.symbol}`);
                console.log(`Quantity: ${currentPosition.qty}`);
                console.log(`Price: $${this.currentPrice}`);
                
                const order = await this.alpaca.createOrder({
                    symbol: this.symbol,
                    qty: currentPosition.qty,
                    side: 'sell',
                    type: 'market',
                    time_in_force: 'day',
                    extended_hours: false
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

    async displayInitialAnalysis() {
        try {
            if (!this.historicalData || this.historicalData.length === 0) {
                return;
            }

            const prices = this.historicalData.map(d => d.close);
            const analysis = this.quantumMA.analyze(prices);
            
            const currentPrice = this.historicalData[this.historicalData.length - 1].close;
            const currentMA = analysis.maValues[analysis.maValues.length - 1];

            console.log('\n=== Market Analysis ===');
            console.log(`Current Price: $${currentPrice.toFixed(2)}`);
            console.log(`MA: $${currentMA.toFixed(2)}`);
            console.log(`Trend: ${analysis.trendDirection}`);
            
        } catch (error) {
            console.error('❌ Error in analysis:', error.message);
        }
    }

    async displayRegularUpdate() {
        try {
            const prices = await this.getStockData();
            if (prices.length === 0) return;

            const analysis = this.quantumMA.analyze(prices);
            const currentPrice = prices[prices.length - 1];
            const currentMA = analysis.maValues[analysis.maValues.length - 1];
            const timestamp = new Date().toLocaleString();

            // Only print regular updates for 1h or 1d timeframes
            if (this.timeframe === '1h' || this.timeframe === '1d') {
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
            }

            // Check for signals (always process signals and trades)
            this.checkSignals(prices, analysis.maValues);
        } catch (error) {
            console.error('Error in regular update:', error.message);
        }
    }
}

if (require.main === module) {
    require('dotenv').config();
    const symbol = process.argv[2];
    
    if (!symbol) {
        console.log('Please provide a stock symbol as a command line argument');
        console.log('Example: node stockMonitor.js AAPL');
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

    async function startMonitoring() {
        try {
            const timeframe = await StockMonitor.configureTimeframe();
            const monitor = new StockMonitor(symbol, 20, 20, timeframe);
            
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
}

module.exports = StockMonitor;
