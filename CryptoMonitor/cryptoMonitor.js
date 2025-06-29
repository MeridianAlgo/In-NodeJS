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
const LLAMA_API_KEY = process.env.LLAMA_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const cheerio = require('cheerio');
const { promptTimeframe, promptTakeProfit, promptStopLoss, promptUserPreferences, promptUsePreviousPreferences } = require('./core/ui');
const CryptoMonitor = require('./core/CryptoMonitor');
const { executeTrade } = require('./core/tradeUtils');
const fs = require('fs');
const path = require('path');

// Suppress Yahoo Finance survey notice
yahooFinance.suppressNotices(['yahooSurvey']);

const SETTINGS_FILE = path.join(__dirname, 'user_settings.json');

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
                console.warn('Could not read user_settings.json, will prompt for preferences.');
                userPreferences = await promptUserPreferences();
                fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userPreferences, null, 2), 'utf8');
                usePrev = true; // treat as if we just set new preferences, so skip further prompts
            }
        } else {
            userPreferences = await promptUserPreferences();
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userPreferences, null, 2), 'utf8');
            usePrev = true;
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
        
        // Only prompt for new settings if NOT using previous preferences
        if (!usePrev) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            
            // Ask about crossunder signals (new setting)
            const crossunderAnswer = await new Promise((resolve) => {
                rl.question(`Enable MA crossunder signals for selling? (y/n, default: ${enableCrossunderSignals ? 'y' : 'n'})? Press Enter to accept, or enter y/n: `, ans => {
                    if (ans.trim() === '') return resolve(enableCrossunderSignals);
                    const enable = ans.trim().toLowerCase() === 'y' || ans.trim().toLowerCase() === 'yes';
                    resolve(enable);
                });
            });
            enableCrossunderSignals = crossunderAnswer;
            
            // Ask about performance metrics (new setting)
            const perfMetricsAnswer = await new Promise((resolve) => {
                rl.question(`Enable advanced performance metrics (Sharpe ratio, drawdown, win rate)? (y/n, default: ${enablePerformanceMetrics ? 'y' : 'n'})? Press Enter to accept, or enter y/n: `, ans => {
                    if (ans.trim() === '') return resolve(enablePerformanceMetrics);
                    const enable = ans.trim().toLowerCase() === 'y' || ans.trim().toLowerCase() === 'yes';
                    resolve(enable);
                });
            });
            enablePerformanceMetrics = perfMetricsAnswer;
            
            rl.close();
            
            // Update preferences with new settings
            let updated = false;
            if (enableCrossunderSignals !== userPreferences.enableCrossunderSignals) {
                userPreferences.enableCrossunderSignals = enableCrossunderSignals;
                updated = true;
            }
            if (enablePerformanceMetrics !== userPreferences.enablePerformanceMetrics) {
                userPreferences.enablePerformanceMetrics = enablePerformanceMetrics;
                updated = true;
            }
            if (updated) {
                fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userPreferences, null, 2), 'utf8');
            }
        }
        async function startMonitoring() {
            try {
                const monitorPreferences = {
                    ...userPreferences,
                    enableCrossunderSignals: enableCrossunderSignals,
                    enablePerformanceMetrics: enablePerformanceMetrics
                };
                const monitor = new CryptoMonitor(symbol, 20, 20, timeframe, undefined, undefined, takeProfit, stopLoss, monitorPreferences);
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