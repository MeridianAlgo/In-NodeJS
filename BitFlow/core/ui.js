// core/ui.js
const { prompt, Select, Confirm, Input } = require('enquirer');
let chalk;
try {
    chalk = require('chalk');
    if (typeof chalk.cyan !== 'function') {
        // Chalk v5+ ESM loaded in CJS, fallback to no color
        chalk = new Proxy({}, { get: () => (x) => x });
    }
} catch (e) {
    // Fallback: no color
    chalk = new Proxy({}, { get: () => (x) => x });
}

// Simple CLI loader
let loaderInterval = null;
function startLoader(message = 'Loading') {
    const frames = ['|', '/', '-', '\\'];
    let i = 0;
    process.stdout.write(chalk.cyan(message + ' '));
    loaderInterval = setInterval(() => {
        process.stdout.write('\r' + chalk.cyan(message + ' ' + frames[i = ++i % frames.length]));
    }, 120);
}
function stopLoader() {
    if (loaderInterval) {
        clearInterval(loaderInterval);
        loaderInterval = null;
        process.stdout.write('\r' + ' '.repeat(40) + '\r');
    }
}

// --- PROMPTS ---
async function promptTimeframe(validTimeframes) {
    const choices = Object.entries(validTimeframes).map(([key, value]) => ({ name: key, message: value }));
    const { timeframe } = await prompt({
        type: 'select',
        name: 'timeframe',
        message: chalk.bold('Select timeframe:'),
        choices
    });
    return timeframe;
}

async function promptTakeProfit() {
    // Always auto, but show info
    await prompt({
        type: 'input',
        name: 'tp',
        message: chalk.magenta('Take profit % (auto, Llama AI will decide):'),
        initial: 'auto',
        validate: () => true
    });
    return 'auto';
}

async function promptStopLoss() {
    await prompt({
        type: 'input',
        name: 'sl',
        message: chalk.red('Stop loss % (auto, Llama AI will decide):'),
        initial: 'auto',
        validate: () => true
    });
    return 'auto';
}

async function promptUsePreviousPreferences(preferences) {
    // Modern UI: Show all preferences in a card
    const lines = [];
    if (preferences.enablePositionLogging !== undefined)
        lines.push('Position Logging: ' + (preferences.enablePositionLogging ? chalk.green('Enabled') : chalk.red('Disabled')));
    if (preferences.defaultTakeProfit !== undefined)
        lines.push('Take Profit: ' + chalk.magenta(preferences.defaultTakeProfit));
    if (preferences.defaultStopLoss !== undefined)
        lines.push('Stop Loss: ' + chalk.red(preferences.defaultStopLoss));
    if (preferences.defaultTimeframe)
        lines.push('Timeframe: ' + chalk.cyan(preferences.defaultTimeframe));
    if (preferences.enableCrossunderSignals !== undefined)
        lines.push('Crossunder Signals: ' + (preferences.enableCrossunderSignals ? chalk.green('Enabled') : chalk.red('Disabled')));
    if (preferences.enablePerformanceMetrics !== undefined)
        lines.push('Performance Metrics: ' + (preferences.enablePerformanceMetrics ? chalk.green('Enabled') : chalk.red('Disabled')));
    printCard('Previous Preferences', lines);
    const { usePrev } = await prompt({
        type: 'confirm',
        name: 'usePrev',
        message: chalk.bold('Use these settings?'),
        initial: true
    });
    return usePrev;
}

async function promptUserPreferences(previous = {}) {
    const { enablePositionLogging } = await prompt({
        type: 'confirm',
        name: 'enablePositionLogging',
        message: chalk.bold('Enable position logging?'),
        initial: previous.enablePositionLogging !== undefined ? previous.enablePositionLogging : true
    });
    const { defaultTakeProfit } = await prompt({
        type: 'input',
        name: 'defaultTakeProfit',
        message: chalk.magenta('Default take profit % (0.1-10, or "auto"): '),
        initial: previous.defaultTakeProfit || 'auto',
        validate: val => val === 'auto' || (!isNaN(val) && parseFloat(val) >= 0.1 && parseFloat(val) <= 10) || 'Enter 0.1-10 or "auto"'
    });
    const { defaultStopLoss } = await prompt({
        type: 'input',
        name: 'defaultStopLoss',
        message: chalk.red('Default stop loss % (0.1-10, or "auto"): '),
        initial: previous.defaultStopLoss || 'auto',
        validate: val => val === 'auto' || (!isNaN(val) && parseFloat(val) >= 0.1 && parseFloat(val) <= 10) || 'Enter 0.1-10 or "auto"'
    });
    const { defaultTimeframe } = await prompt({
        type: 'input',
        name: 'defaultTimeframe',
        message: chalk.cyan('Default timeframe (e.g., 1Min, 5Min, 15Min, 1Hour, 1Day):'),
        initial: previous.defaultTimeframe || '5Min',
        validate: val => val in { '1Min':1, '5Min':1, '15Min':1, '1Hour':1, '1Day':1 } || 'Enter a valid timeframe.'
    });
    const { enableCrossunderSignals } = await prompt({
        type: 'confirm',
        name: 'enableCrossunderSignals',
        message: chalk.bold('Enable MA crossunder signals for selling?'),
        initial: previous.enableCrossunderSignals !== undefined ? previous.enableCrossunderSignals : true
    });
    const { enablePerformanceMetrics } = await prompt({
        type: 'confirm',
        name: 'enablePerformanceMetrics',
        message: chalk.bold('Enable advanced performance metrics (Sharpe, drawdown, win rate)?'),
        initial: previous.enablePerformanceMetrics !== undefined ? previous.enablePerformanceMetrics : false
    });
    return {
        enablePositionLogging,
        defaultTakeProfit,
        defaultStopLoss,
        defaultTimeframe,
        enableCrossunderSignals,
        enablePerformanceMetrics
    };
}

async function promptCrossunderSignals(current = true) {
    const { enableCrossunderSignals } = await prompt({
        type: 'confirm',
        name: 'enableCrossunderSignals',
        message: chalk.bold('Enable MA crossunder signals for selling?'),
        initial: current
    });
    return enableCrossunderSignals;
}

async function promptPerformanceMetrics(current = false) {
    const { enablePerformanceMetrics } = await prompt({
        type: 'confirm',
        name: 'enablePerformanceMetrics',
        message: chalk.bold('Enable advanced performance metrics (Sharpe, drawdown, win rate)?'),
        initial: current
    });
    return enablePerformanceMetrics;
}

// --- OUTPUT HELPERS ---
function printBanner(text) {
    console.log('==== ' + text + ' ====' );
}
function printStatus(text) {
    console.log(text);
}
function printSuccess(text) {
    // Use green only for major successes
    console.log('\x1b[32m%s\x1b[0m', text);
}
function printWarning(text) {
    // Use yellow only for major warnings
    console.log('\x1b[33m%s\x1b[0m', text);
}
function printError(text) {
    // Use red only for errors
    console.log('\x1b[31m%s\x1b[0m', text);
}
function printSection(title) {
    console.log('--- ' + title + ' ---');
}

// --- NOTIFICATION HELPER ---
function notify(title, message) {
    // Monochrome notification
    console.log(`[${title}] ${message}`);
}

// --- MODERN CLI UI HELPERS ---

// Color dots for status
function statusDot(connected) {
    return connected ? chalk.green('●') : chalk.red('●');
}

// Format numbers with commas and fixed decimals
function formatMoney(val, decimals = 2) {
    if (typeof val !== 'number') val = parseFloat(val);
    if (isNaN(val)) return '-';
    return '$' + val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function formatNumber(val, decimals = 2) {
    if (typeof val !== 'number') val = parseFloat(val);
    if (isNaN(val)) return '-';
    return val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Improved box drawing for perfect alignment
function printCard(title, lines, options = {}) {
    // Find the widest line (including title) - strip ANSI color codes for accurate width calculation
    const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');
    const allLines = [title, ...lines];
    const width = Math.max(...allLines.map(l => stripAnsi(l).length)) + 4;
    
    const top = '┌' + '─'.repeat(width - 2) + '┐';
    const bottom = '└' + '─'.repeat(width - 2) + '┘';
    const titleLine = '│ ' + chalk.bold(title) + ' '.repeat(width - stripAnsi(title).length - 3) + '│';
    const content = lines.map(l => '│ ' + l + ' '.repeat(width - stripAnsi(l).length - 3) + '│').join('\n');
    console.log(top + '\n' + titleLine + '\n' + content + '\n' + bottom);
}

function printTableCard(title, rows, options = {}) {
    // Strip ANSI color codes for accurate width calculation
    const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');
    
    // Calculate max width for key and value columns
    const keyWidth = Math.max(...rows.map(([k]) => stripAnsi(k).length), stripAnsi(title).length);
    const valWidth = Math.max(...rows.map(([,v]) => stripAnsi('' + v).length), 8);
    
    // Calculate total width needed
    const totalWidth = keyWidth + valWidth + 7; // 7 for borders and spacing
    
    // Create the title line
    const titleLine = '│ ' + chalk.bold(title) + ' '.repeat(totalWidth - stripAnsi(title).length - 3) + '│';
    
    // Create the divider line
    const dividerLine = '│' + '─'.repeat(keyWidth + 2) + '│' + '─'.repeat(valWidth + 2) + '│';
    
    // Create row lines
    const rowLines = rows.map(([k, v]) => {
        const keyPart = '│ ' + k + ' '.repeat(keyWidth - stripAnsi(k).length) + ' │';
        const valPart = ' ' + v + ' '.repeat(valWidth - stripAnsi('' + v).length) + ' │';
        return keyPart + valPart;
    });
    
    // Create top and bottom borders
    const top = '┌' + '─'.repeat(totalWidth - 2) + '┐';
    const bottom = '└' + '─'.repeat(totalWidth - 2) + '┘';
    
    // Build the output
    let output = top + '\n' + titleLine;
    if (options.divider !== false) {
        output += '\n' + dividerLine;
    }
    output += '\n' + rowLines.join('\n') + '\n' + bottom;
    
    console.log(output);
}

// Section divider
function printDivider() {
    console.log(chalk.gray(' '.repeat(2) + '─'.repeat(40)));
}

module.exports = {
    promptTimeframe,
    promptTakeProfit,
    promptStopLoss,
    promptUserPreferences,
    promptUsePreviousPreferences,
    promptCrossunderSignals,
    promptPerformanceMetrics,
    startLoader,
    stopLoader,
    printBanner,
    printStatus,
    printSuccess,
    printWarning,
    printError,
    printSection,
    notify,
    // Modern UI helpers
    statusDot,
    formatMoney,
    formatNumber,
    printCard,
    printTableCard,
    printDivider
}; 