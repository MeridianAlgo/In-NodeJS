// BitFlow.js
require('dotenv').config();
const yahooFinance = require('yahoo-finance2').default;
const cron = require('node-cron');
const readline = require('readline');
const WebSocket = require('ws');
const axios = require('axios');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const fetch = require('node-fetch'); // Add at the top for Cryptowatch REST API
const LLAMA_API_KEY = process.env.LLAMA_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const cheerio = require('cheerio');
const { 
    promptTimeframe, 
    promptTakeProfit, 
    promptStopLoss, 
    promptUserPreferences, 
    promptUsePreviousPreferences, 
    promptCrossunderSignals, 
    promptPerformanceMetrics, 
    printBanner, 
    printStatus, 
    printSuccess, 
    printWarning, 
    printError, 
    printSection 
} = require('./core/ui');
const BitFlow = require('./core/BitFlow');
const { executeTrade } = require('./core/tradeUtils');
const fs = require('fs');
const path = require('path');
const runBacktest = require('./core/backtest.js').runBacktest;

// Suppress Yahoo Finance survey notice
yahooFinance.suppressNotices(['yahooSurvey']);

const SETTINGS_FILE = path.join(__dirname, 'user_settings.json');

// --- CLI ---
if (require.main === module) {
    (async () => {
        const symbol = process.argv[2];
        if (!symbol) {
            printError('Please provide a crypto trading pair as a command line argument');
            printStatus('Example: node BitFlow.js BTC/USD');
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
            printError('\nMissing required environment variables:');
            missingVars.forEach(varName => printStatus(`- ${varName}`));
            printStatus('\nPlease create a .env file with these variables:');
            printStatus('ALPACA_API_KEY_ID=your_key_here');
            printStatus('ALPACA_SECRET_KEY=your_secret_here');
            printStatus('POLYGON_API_KEY=your_key_here');
            printStatus('FINNHUB_API_KEY=your_key_here');
            process.exit(1);
        }
        // --- Load or prompt for user preferences ---
        let userPreferences = {};
        let usePrev = false;
        if (fs.existsSync(SETTINGS_FILE)) {
            try {
                userPreferences = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
                usePrev = await promptUsePreviousPreferences(userPreferences);
                if (!usePrev) {
                    // User said no to previous preferences, prompt for new ones
                    userPreferences = await promptUserPreferences(userPreferences);
                    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userPreferences, null, 2), 'utf8');
                }
            } catch (e) {
                printWarning('Could not read user_settings.json, will prompt for preferences.');
                userPreferences = await promptUserPreferences();
                fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userPreferences, null, 2), 'utf8');
                usePrev = true; // treat as if we just set new preferences, so skip further prompts
            }
        } else {
            userPreferences = await promptUserPreferences();
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userPreferences, null, 2), 'utf8');
            usePrev = true;
        }
        
        // Wait 1 second after preferences initialization, then read fresh data
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Read fresh preferences from file to ensure we have the latest data
        if (fs.existsSync(SETTINGS_FILE)) {
            try {
                userPreferences = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            } catch (e) {
                printWarning('Could not read updated user_settings.json, using in-memory preferences.');
            }
        }
        
        // Use preferences for defaults
        const validTimeframes = {
            '1Min': '1 Minute',
            '5Min': '5 Minutes',
            '15Min': '15 Minutes',
            '1Hour': '1 Hour',
            '1Day': '1 Day'
        };
        let timeframe = userPreferences.defaultTimeframe || undefined;
        if (!timeframe) {
            timeframe = await promptTimeframe(validTimeframes);
            if (timeframe && timeframe !== userPreferences.defaultTimeframe) {
                userPreferences.defaultTimeframe = timeframe;
                fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userPreferences, null, 2), 'utf8');
            }
        }
        let takeProfit = userPreferences.defaultTakeProfit ?? 'auto';
        let stopLoss = userPreferences.defaultStopLoss ?? 'auto';
        let enableCrossunderSignals = userPreferences.enableCrossunderSignals ?? true;
        let enablePerformanceMetrics = userPreferences.enablePerformanceMetrics ?? false;
        
        // No need for separate prompts since they're now included in promptUserPreferences
        // The values are already set from userPreferences above
        const limit = 1000; // Reasonable default for backtesting
        let positionCount = 0;
        let maParams = null;

        async function getPreviousPositionCount(symbol) {
            const csvPath = path.join(__dirname, 'positions_sold.csv');
            if (!fs.existsSync(csvPath)) return 0;
            const data = fs.readFileSync(csvPath, 'utf8').split('\n');
            const headers = data[0].split(',');
            const symbolIdx = headers.indexOf('symbol');
            if (symbolIdx === -1) return 0;
            return data.slice(1).filter(line => {
                const vals = line.split(',');
                return vals[symbolIdx] && vals[symbolIdx].trim() === symbol.trim();
            }).length;
        }

        async function startMonitoring() {
            try {
                // Use user-selected values
                console.log('Checking previous positions for symbol:', symbol);
                const prevCount = await getPreviousPositionCount(symbol);
                let maParams;
                if (prevCount > 10) {
                    console.log(`[Backtest] Found ${prevCount} previous positions for ${symbol}. Running backtest...`);
                    maParams = await runBacktest(symbol, timeframe, limit);
                } else {
                    console.log(`[Backtest] Found ${prevCount} previous positions for ${symbol}. Using default MA values.`);
                    maParams = { baseLength: 20, evalPeriod: 20 };
                }
                console.log('Using MA params:', maParams);
                // Pass these params to BitFlow
                const monitorPreferences = {
                    ...userPreferences,
                    enableCrossunderSignals: enableCrossunderSignals,
                    enablePerformanceMetrics: enablePerformanceMetrics
                };
                
                // Debug: Log what preferences are being passed (explicit flush)
                const debugUserPrefs = 'DEBUG: userPreferences from file: ' + JSON.stringify(userPreferences, null, 2) + '\n';
                const debugMonitorPrefs = 'DEBUG: monitorPreferences being passed: ' + JSON.stringify(monitorPreferences, null, 2) + '\n';
                process.stdout.write(debugUserPrefs);
                process.stdout.write(debugMonitorPrefs);
                process.stdout.write('DEBUG LOG FLUSHED\n');
                
                const monitor = new BitFlow(symbol, maParams.baseLength, maParams.evalPeriod, timeframe, undefined, undefined, takeProfit, stopLoss, monitorPreferences);
                process.on('SIGINT', () => {
                    monitor.stopMonitoring();
                    process.exit(0);
                });
                // Patch monitor to track positions and adapt MA values
                const originalExecuteTrade = require('./core/tradeUtils').executeTrade;
                require('./core/tradeUtils').executeTrade = async function(...args) {
                    const result = await originalExecuteTrade.apply(this, args);
                    positionCount++;
                    if (positionCount === 10) {
                        console.log('[Adaptive] 10 positions reached. Rerunning backtest for adaptive MA values...');
                        maParams = await runBacktest(symbol, timeframe, limit);
                        console.log('[Adaptive] New MA params:', maParams);
                        // Optionally update monitor's MA values if possible
                        monitor.baseLength = maParams.baseLength;
                        monitor.evalPeriod = maParams.evalPeriod;
                    }
                    return result;
                };
                await monitor.startMonitoring();
            } catch (error) {
                printError('Error starting monitor: ' + error.message);
                process.exit(1);
            }
        }
        startMonitoring();
    })();
}

module.exports = BitFlow; 