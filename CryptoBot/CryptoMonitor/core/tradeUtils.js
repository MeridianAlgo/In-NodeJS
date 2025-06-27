// core/tradeUtils.js

// This file will contain trading/order execution logic for CryptoMonitor.
// For now, export a placeholder. The real logic will be moved from cryptoMonitor.js.

const fs = require('fs');
const path = require('path');

function logApiError(context, error) {
    const logPath = path.join(__dirname, '../api_errors.log');
    const timestamp = new Date().toISOString();
    let details = '';
    if (error && error.response && error.response.data) {
        details = JSON.stringify(error.response.data);
    } else if (error && error.message) {
        details = error.message;
    } else {
        details = String(error);
    }
    const logEntry = `[${timestamp}] [${context}] ${details}\n`;
    fs.appendFileSync(logPath, logEntry, 'utf8');
}

async function monitorTakeProfitStopLoss(monitor, entryPrice, quantity, takeProfitPercent, stopLossPercent) {
    const symbol = monitor.symbol.replace('/', '');
    const takeProfitPrice = entryPrice * (1 + takeProfitPercent / 100);
    const stopLossPrice = entryPrice * (1 - stopLossPercent / 100);
    console.log(`[TP/SL Monitor] Monitoring for TP: $${takeProfitPrice.toFixed(2)}, SL: $${stopLossPrice.toFixed(2)}`);
    let closed = false;
    while (!closed) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // check every 5 seconds
        let currentPrice = monitor.currentPrice;
        if (!currentPrice || isNaN(currentPrice)) continue;
        // Always fetch the latest available position size before closing
        let actualQty = quantity;
        try {
            const positions = await monitor.alpaca.getPositions();
            const pos = positions.find(p => p.symbol === monitor.symbol.replace('/', ''));
            if (pos) {
                actualQty = parseFloat(pos.qty);
            }
        } catch (e) {
            // fallback: use original quantity
        }
        // 1. Check for MA crossunder (SELL signal)
        const prices = await monitor.getCryptoData();
        const analysis = monitor.quantumMA.analyze(prices);
        const maValues = analysis.maValues;
        if (prices.length >= 2 && maValues.length >= 2) {
            const lastPrice = prices[prices.length - 1];
            const lastMA = maValues[maValues.length - 1];
            const prevPrice = prices[prices.length - 2];
            const prevMA = maValues[maValues.length - 2];
            if (prevPrice >= prevMA && lastPrice < lastMA) {
                // MA crossunder detected
                console.log(`[TP/SL Monitor] sell signal detected update (MA crossunder before TP/SL). Closing position.`);
                try {
                    await monitor.alpaca.createOrder({
                        symbol,
                        qty: actualQty,
                        side: 'sell',
                        type: 'market',
                        time_in_force: 'gtc'
                    });
                    closed = true;
                    console.log(`[TP/SL Monitor] Position closed due to MA crossunder.`);
                } catch (error) {
                    logApiError('MA crossunder sell order', error);
                    console.error('Error closing position at MA crossunder:', error.message);
                }
                break;
            }
        }
        // 2. Check for TP
        if (currentPrice >= takeProfitPrice) {
            console.log(`[TP/SL Monitor] sell signal detected tp hit. Closing position.`);
            try {
                await monitor.alpaca.createOrder({
                    symbol,
                    qty: actualQty,
                    side: 'sell',
                    type: 'market',
                    time_in_force: 'gtc'
                });
                closed = true;
                console.log(`[TP/SL Monitor] Position closed at take-profit.`);
            } catch (error) {
                logApiError('TP sell order', error);
                console.error('Error closing position at take-profit:', error.message);
            }
            break;
        }
        // 3. Check for SL
        if (currentPrice <= stopLossPrice) {
            console.log(`[TP/SL Monitor] sell signal detected sl hit. Closing position.`);
            try {
                await monitor.alpaca.createOrder({
                    symbol,
                    qty: actualQty,
                    side: 'sell',
                    type: 'market',
                    time_in_force: 'gtc'
                });
                closed = true;
                console.log(`[TP/SL Monitor] Position closed at stop-loss.`);
            } catch (error) {
                logApiError('SL sell order', error);
                console.error('Error closing position at stop-loss:', error.message);
            }
            break;
        }
    }
}

async function executeTrade(monitor, signal) {
    try {
        if (!monitor.currentPrice || isNaN(monitor.currentPrice)) {
            console.error('Invalid current price, cannot execute trade');
            monitor.stopMonitoring();
            process.exit(1);
            return;
        }
        // Get current positions and account info
        const positions = await monitor.alpaca.getPositions();
        const account = await monitor.alpaca.getAccount();
        const currentPosition = positions.find(p => p.symbol === monitor.symbol.replace('/', ''));
        const availableCash = parseFloat(account.cash);
        const fixedQuantity = 0.0009; // Intended trade size
        let quantity;
        let takeProfitPercent = monitor.takeProfit;
        let stopLossPercent = monitor.stopLoss;
        if (signal === 'BUY' && !currentPosition) {
            // Use Llama API/manual for position sizing and TP/SL
            let llamaResult = null;
            if (monitor.takeProfit === 'auto' || monitor.stopLoss === 'auto') {
                llamaResult = await monitor.getPositionSizeWithLlama(availableCash, monitor.currentPrice, monitor.symbol);
            }
            if (llamaResult && llamaResult.qty > 0) {
                quantity = llamaResult.qty;
                if (monitor.takeProfit === 'auto') takeProfitPercent = llamaResult.takeProfit;
                if (monitor.stopLoss === 'auto') stopLossPercent = llamaResult.stopLoss;
            } else {
                // Calculate max affordable quantity
                const maxAffordable = availableCash / monitor.currentPrice;
                quantity = Math.min(fixedQuantity, maxAffordable);
                // Round down to 6 decimals (BTC precision)
                quantity = Math.floor(quantity * 1e6) / 1e6;
                if (quantity <= 0) {
                    console.error(`Insufficient cash to buy any ${monitor.symbol}. Available cash: $${availableCash}`);
                    monitor.stopMonitoring();
                    process.exit(1);
                    return;
                }
                if (quantity < fixedQuantity) {
                    console.warn(`Requested quantity (${fixedQuantity}) exceeds available cash. Adjusted to ${quantity}.`);
                }
                // Use manual TP/SL, clamp to 0.1-10%
                if (monitor.takeProfit !== 'auto') takeProfitPercent = Math.max(0.1, Math.min(parseFloat(monitor.takeProfit), 10));
                if (monitor.stopLoss !== 'auto') stopLossPercent = Math.max(0.1, Math.min(parseFloat(monitor.stopLoss), 10));
            }
            console.log(`\n=== Executing BUY Order ===`);
            console.log(`Symbol: ${monitor.symbol}`);
            console.log(`Quantity: ${quantity}`);
            console.log(`Current Price: $${monitor.currentPrice}`);
            console.log(`Available Cash: $${availableCash}`);
            console.log(`Position Size: $${(quantity * monitor.currentPrice).toFixed(2)}`);
            console.log(`Take Profit: ${takeProfitPercent}% | Stop Loss: ${stopLossPercent}%`);
            // --- Place a simple market order for entry ---
            let order;
            try {
                order = await monitor.alpaca.createOrder({
                    symbol: monitor.symbol.replace('/', ''),
                    qty: quantity,
                    side: 'buy',
                    type: 'market',
                    time_in_force: 'gtc'
                });
                console.log(`Order placed successfully: ${order.id}`);
                // Start monitoring for TP/SL in the background
                monitorTakeProfitStopLoss(monitor, monitor.currentPrice, quantity, takeProfitPercent, stopLossPercent);
            } catch (error) {
                logApiError('BUY order', error);
                console.error('Error executing buy order:', error.message);
                if (error.response && error.response.data) {
                    console.error('Error details:', error.response.data);
                }
                if (error.response && error.response.data && error.response.data.message && error.response.data.message.toLowerCase().includes('insufficient balance')) {
                    console.warn('Insufficient balance for buy order. Continuing monitoring.');
                } else {
                    return;
                }
            }
        } else if (signal === 'SELL' && currentPosition) {
            // Only sell up to what you own
            quantity = parseFloat(currentPosition.qty);
            if (quantity <= 0) {
                console.error(`No position to sell for ${monitor.symbol}.`);
                monitor.stopMonitoring();
                process.exit(1);
                return;
            }
            console.log(`\n=== Executing SELL Order ===`);
            console.log(`Symbol: ${monitor.symbol}`);
            console.log(`Quantity: ${quantity}`);
            console.log(`Current Price: $${monitor.currentPrice}`);
            let order;
            try {
                order = await monitor.alpaca.createOrder({
                    symbol: monitor.symbol.replace('/', ''),
                    qty: quantity,
                    side: 'sell',
                    type: 'market',
                    time_in_force: 'gtc'
                });
                console.log(`Order placed successfully: ${order.id}`);
            } catch (error) {
                logApiError('SELL order', error);
                console.error('Error executing SELL order:', error.message);
                if (error.response && error.response.data) {
                    console.error('Error details:', error.response.data);
                }
                return;
            }
            // Calculate and print profit/loss
            const entryPrice = parseFloat(currentPosition.avg_entry_price);
            const exitPrice = parseFloat(monitor.currentPrice);
            const pnl = (exitPrice - entryPrice) * quantity;
            const pnlStr = pnl >= 0 ? `Profit` : `Loss`;
            console.log(`${pnlStr}: $${pnl.toFixed(2)} (Entry: $${entryPrice.toFixed(2)}, Exit: $${exitPrice.toFixed(2)}, Qty: ${quantity})`);
        }
    } catch (error) {
        logApiError('General trade execution', error);
        console.error('Error executing trade:', error.message);
        if (error.response && error.response.data) {
            console.error('Error details:', error.response.data);
        }
        monitor.stopMonitoring();
        process.exit(1);
    }
}

module.exports = { executeTrade }; 