// core/ui.js
const readline = require('readline');

function promptTimeframe(validTimeframes) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log('\n=== Timeframe Configuration ===');
        console.log('Available timeframes:');
        Object.entries(validTimeframes).forEach(([key, value]) => {
            console.log(`${key}: ${value}`);
        });
        rl.question('\nSelect timeframe (default: 5Min, or type "test" to test all APIs): ', (answer) => {
            rl.close();
            const tfMap = {
                '1min': '1Min', '1 min': '1Min', '1minute': '1Min', '1 minute': '1Min', '1Min': '1Min',
                '5min': '5Min', '5 min': '5Min', '5minute': '5Min', '5 minutes': '5Min', '5Min': '5Min',
                '15min': '15Min', '15 min': '15Min', '15minute': '15Min', '15 minutes': '15Min', '15Min': '15Min',
                '1hour': '1Hour', '1 hour': '1Hour', '1hr': '1Hour', '1Hr': '1Hour', '1Hour': '1Hour',
                '1day': '1Day', '1 day': '1Day', '1Day': '1Day',
                'test': 'test', 'Test': 'test', 'TEST': 'test'
            };
            const tf = tfMap[answer.trim()] || '5Min';
            resolve(tf);
        });
    });
}

function promptTakeProfit() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log('\n=== Take Profit Configuration ===');
        rl.question('Enter take profit % (e.g., 1 for 1%), or type "auto" to let Llama decide:\n> ', answer => {
            rl.close();
            if (answer.trim().toLowerCase() === 'auto') return resolve('auto');
            const num = parseFloat(answer);
            if (!isNaN(num) && num >= 0.1 && num <= 10) return resolve(num);
            console.log('Please enter a number between 0.1 and 10, or "auto".');
            resolve(promptTakeProfit());
        });
    });
}

function promptStopLoss() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log('\n=== Stop Loss Configuration ===');
        rl.question('Enter stop loss % (e.g., 1 for 1%), or type "auto" to let Llama decide:\n> ', answer => {
            rl.close();
            if (answer.trim().toLowerCase() === 'auto') return resolve('auto');
            const num = parseFloat(answer);
            if (!isNaN(num) && num >= 0.1 && num <= 10) return resolve(num);
            console.log('Please enter a number between 0.1 and 10, or "auto".');
            resolve(promptStopLoss());
        });
    });
}

function promptUsePreviousPreferences(preferences) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log('\n=== Previous Preferences Detected ===');
        console.log(`Position Logging: ${preferences.enablePositionLogging ? 'Enabled' : 'Disabled'}`);
        console.log(`Default Take Profit: ${preferences.defaultTakeProfit}`);
        console.log(`Default Stop Loss: ${preferences.defaultStopLoss}`);
        if (preferences.defaultTimeframe) {
            console.log(`Default Timeframe: ${preferences.defaultTimeframe}`);
        }
        // Show new settings if they exist
        if (preferences.enableCrossunderSignals !== undefined) {
            console.log(`Crossunder Signals: ${preferences.enableCrossunderSignals ? 'Enabled' : 'Disabled'}`);
        }
        if (preferences.enablePerformanceMetrics !== undefined) {
            console.log(`Performance Metrics: ${preferences.enablePerformanceMetrics ? 'Enabled' : 'Disabled'}`);
        }
        rl.question('Use these previous settings? (y/n, default: y): ', answer => {
            rl.close();
            const usePrev = (answer.trim().toLowerCase() !== 'n');
            resolve(usePrev);
        });
    });
}

function promptUserPreferences(previous = {}) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log('\n=== User Preferences ===');
        const logDefault = previous.enablePositionLogging !== undefined ? (previous.enablePositionLogging ? 'y' : 'n') : 'n';
        rl.question(`Enable position and P/L logging? (y/n, default: ${logDefault}): `, answer => {
            const enableLogging = answer.trim() === '' ? (logDefault === 'y') : (answer.trim().toLowerCase() === 'y');
            const tpDefault = previous.defaultTakeProfit !== undefined ? previous.defaultTakeProfit : 'auto';
            rl.question(`Default take profit % (e.g., 1 for 1%, or type "auto", default: ${tpDefault}): `, tpAns => {
                let takeProfit = tpAns.trim() === '' ? tpDefault : (tpAns.trim().toLowerCase() === 'auto' ? 'auto' : parseFloat(tpAns));
                if (takeProfit !== 'auto' && (isNaN(takeProfit) || takeProfit < 0.1 || takeProfit > 10)) {
                    console.log('Please enter a number between 0.1 and 10, or "auto".');
                    takeProfit = tpDefault;
                }
                const slDefault = previous.defaultStopLoss !== undefined ? previous.defaultStopLoss : 'auto';
                rl.question(`Default stop loss % (e.g., 1 for 1%, or type "auto", default: ${slDefault}): `, slAns => {
                    let stopLoss = slAns.trim() === '' ? slDefault : (slAns.trim().toLowerCase() === 'auto' ? 'auto' : parseFloat(slAns));
                    if (stopLoss !== 'auto' && (isNaN(stopLoss) || stopLoss < 0.1 || stopLoss > 10)) {
                        console.log('Please enter a number between 0.1 and 10, or "auto".');
                        stopLoss = slDefault;
                    }
                    // Optionally, ask for default timeframe
                    const tfDefault = previous.defaultTimeframe || '';
                    rl.question(`Default timeframe (e.g., 1Min, 5Min, 15Min, 1Hour, 1Day${tfDefault ? `, default: ${tfDefault}` : ''}): `, tfAns => {
                        let defaultTimeframe = tfAns.trim() === '' ? tfDefault : tfAns.trim();
                        rl.close();
                        resolve({
                            enablePositionLogging: enableLogging,
                            defaultTakeProfit: takeProfit,
                            defaultStopLoss: stopLoss,
                            defaultTimeframe
                        });
                    });
                });
            });
        });
    });
}

module.exports = {
    promptTimeframe,
    promptTakeProfit,
    promptStopLoss,
    promptUserPreferences,
    promptUsePreviousPreferences
}; 