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

// --- Position Logging Function ---
function logPositionTrade(monitor, tradeData) {
    try {
        const logPath = path.join(__dirname, '../position_log.json');
        let positionLog = [];
        
        // Load existing log if it exists
        if (fs.existsSync(logPath)) {
            positionLog = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        }
        
        // Add timestamp if not provided
        if (!tradeData.timestamp) {
            tradeData.timestamp = new Date().toISOString();
        }
        
        // Add to log
        positionLog.push(tradeData);
        
        // Keep only last 1000 trades to prevent file from getting too large
        if (positionLog.length > 1000) {
            positionLog = positionLog.slice(-1000);
        }
        
        // Save updated log
        fs.writeFileSync(logPath, JSON.stringify(positionLog, null, 2), 'utf8');
        
        console.log(`📊 Position logged: ${tradeData.symbol} - ${tradeData.pnl >= 0 ? 'PROFIT' : 'LOSS'} $${tradeData.pnl.toFixed(2)}`);
    } catch (error) {
        console.warn('Could not log position trade:', error.message);
    }
}

async function monitorTakeProfitStopLoss(monitor, entryPrice, quantity, takeProfitPercent, stopLossPercent) {
    const symbol = monitor.symbol.replace('/', '');
    const takeProfitPrice = entryPrice * (1 + takeProfitPercent / 100);
    const stopLossPrice = entryPrice * (1 - stopLossPercent / 100);
    console.log(`TP/SL Monitor: TP $${takeProfitPrice.toFixed(2)}, SL $${stopLossPrice.toFixed(2)}`);
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
        // 1. Check for MA crossunder (SELL signal) - only if enabled in preferences
        if (monitor.userPreferences.enableCrossunderSignals) {
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
                    console.log(`TP/SL Monitor: MA crossunder detected. Closing position.`);
                    monitor.sendDesktopNotification('MA Crossunder', `${monitor.symbol} - MA crossunder detected, closing position`);
                    try {
                        await monitor.alpaca.createOrder({
                            symbol,
                            qty: actualQty,
                            side: 'sell',
                            type: 'market',
                            time_in_force: 'gtc'
                        });
                        closed = true;
                        console.log(`TP/SL Monitor: Position closed due to MA crossunder.`);
                        
                        // Calculate and display P&L
                        const exitPrice = currentPrice;
                        const pnl = (exitPrice - entryPrice) * actualQty;
                        const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
                        const pnlEmoji = pnl >= 0 ? '📈' : '📉';
                        const pnlStr = pnl >= 0 ? 'PROFIT' : 'LOSS';
                        
                        console.log('\n' + '-'.repeat(50));
                        console.log(`POSITION CLOSED - ${monitor.symbol}`);
                        console.log('-'.repeat(50));
                        console.log(`Reason: MA Crossunder`);
                        console.log(`Entry Price: $${entryPrice.toFixed(2)}`);
                        console.log(`Exit Price: $${exitPrice.toFixed(2)}`);
                        console.log(`Quantity: ${actualQty.toFixed(6)}`);
                        console.log(`${pnlEmoji} ${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
                        console.log('-'.repeat(50));
                        
                        // Enhanced notification with full details
                        const detailedMessage = `${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)\nEntry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}\nQuantity: ${actualQty.toFixed(6)} | Reason: MA Crossunder`;
                        monitor.sendDesktopNotification(`Position Closed - ${monitor.symbol}`, detailedMessage);
                        
                        // Log position trade with comprehensive data for training
                        const tradeData = {
                            symbol: monitor.symbol,
                            timestamp: new Date().toISOString(),
                            entryPrice: entryPrice,
                            exitPrice: exitPrice,
                            quantity: actualQty,
                            pnl: pnl,
                            pnlPercent: pnlPercent,
                            closeReason: 'MA Crossunder',
                            takeProfitPercent: takeProfitPercent,
                            stopLossPercent: stopLossPercent,
                            takeProfitPrice: takeProfitPrice,
                            stopLossPrice: stopLossPrice,
                            maType: monitor.quantumMA.maType || 'Unknown',
                            maLength: monitor.quantumMA.baseLength,
                            timeframe: monitor.timeframe,
                            currentPrice: currentPrice,
                            trendDirection: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([currentPrice]).trendDirection : 'Unknown',
                            score: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([currentPrice]).score : 0,
                            rSquared: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([currentPrice]).rSquared : 0
                        };
                        logPositionTrade(monitor, tradeData);
                        
                        // Clear saved TP/SL values since position is closed
                        monitor.clearTPSLValues(monitor.symbol);
                    } catch (error) {
                        logApiError('MA crossunder sell order', error);
                        console.error('Error closing position at MA crossunder:', error.message);
                        monitor.sendDesktopNotification('Order Error', `${monitor.symbol} - Error closing position: ${error.message}`);
                    }
                    break;
                }
            }
        }
        // 2. Check for TP
        if (currentPrice >= takeProfitPrice) {
            console.log(`TP/SL Monitor: Take profit hit. Closing position.`);
            monitor.sendDesktopNotification('Take Profit Hit', `${monitor.symbol} - Take profit target reached at $${currentPrice.toFixed(2)}`);
            try {
                await monitor.alpaca.createOrder({
                    symbol,
                    qty: actualQty,
                    side: 'sell',
                    type: 'market',
                    time_in_force: 'gtc'
                });
                closed = true;
                console.log(`TP/SL Monitor: Position closed at take-profit.`);
                
                // Calculate and display P&L
                const exitPrice = currentPrice;
                const pnl = (exitPrice - entryPrice) * actualQty;
                const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
                const pnlEmoji = pnl >= 0 ? '📈' : '📉';
                const pnlStr = pnl >= 0 ? 'PROFIT' : 'LOSS';
                
                console.log('\n' + '-'.repeat(50));
                console.log(`POSITION CLOSED - ${monitor.symbol}`);
                console.log('-'.repeat(50));
                console.log(`Reason: Take Profit Hit`);
                console.log(`Entry Price: $${entryPrice.toFixed(2)}`);
                console.log(`Exit Price: $${exitPrice.toFixed(2)}`);
                console.log(`Quantity: ${actualQty.toFixed(6)}`);
                console.log(`${pnlEmoji} ${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
                console.log('-'.repeat(50));
                
                // Enhanced notification with full details
                const detailedMessage = `${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)\nEntry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}\nQuantity: ${actualQty.toFixed(6)} | Reason: Take Profit Hit`;
                monitor.sendDesktopNotification(`Position Closed - ${monitor.symbol}`, detailedMessage);
                
                // Log position trade with comprehensive data for training
                const tradeData = {
                    symbol: monitor.symbol,
                    timestamp: new Date().toISOString(),
                    entryPrice: entryPrice,
                    exitPrice: exitPrice,
                    quantity: actualQty,
                    pnl: pnl,
                    pnlPercent: pnlPercent,
                    closeReason: 'Take Profit Hit',
                    takeProfitPercent: takeProfitPercent,
                    stopLossPercent: stopLossPercent,
                    takeProfitPrice: takeProfitPrice,
                    stopLossPrice: stopLossPrice,
                    maType: monitor.quantumMA.maType || 'Unknown',
                    maLength: monitor.quantumMA.baseLength,
                    timeframe: monitor.timeframe,
                    currentPrice: currentPrice,
                    trendDirection: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([currentPrice]).trendDirection : 'Unknown',
                    score: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([currentPrice]).score : 0,
                    rSquared: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([currentPrice]).rSquared : 0
                };
                logPositionTrade(monitor, tradeData);
                
                // Clear saved TP/SL values since position is closed
                monitor.clearTPSLValues(monitor.symbol);
            } catch (error) {
                logApiError('TP sell order', error);
                console.error('Error closing position at take-profit:', error.message);
                monitor.sendDesktopNotification('Order Error', `${monitor.symbol} - Error closing position: ${error.message}`);
            }
            break;
        }
        // 3. Check for SL
        if (currentPrice <= stopLossPrice) {
            console.log(`TP/SL Monitor: Stop loss hit. Closing position.`);
            monitor.sendDesktopNotification('Stop Loss Hit', `${monitor.symbol} - Stop loss triggered at $${currentPrice.toFixed(2)}`);
            try {
                await monitor.alpaca.createOrder({
                    symbol,
                    qty: actualQty,
                    side: 'sell',
                    type: 'market',
                    time_in_force: 'gtc'
                });
                closed = true;
                console.log(`TP/SL Monitor: Position closed at stop-loss.`);
                
                // Calculate and display P&L
                const exitPrice = currentPrice;
                const pnl = (exitPrice - entryPrice) * actualQty;
                const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
                const pnlEmoji = pnl >= 0 ? '📈' : '📉';
                const pnlStr = pnl >= 0 ? 'PROFIT' : 'LOSS';
                
                console.log('\n' + '-'.repeat(50));
                console.log(`POSITION CLOSED - ${monitor.symbol}`);
                console.log('-'.repeat(50));
                console.log(`Reason: Stop Loss Hit`);
                console.log(`Entry Price: $${entryPrice.toFixed(2)}`);
                console.log(`Exit Price: $${exitPrice.toFixed(2)}`);
                console.log(`Quantity: ${actualQty.toFixed(6)}`);
                console.log(`${pnlEmoji} ${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
                console.log('-'.repeat(50));
                
                // Enhanced notification with full details
                const detailedMessage = `${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)\nEntry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}\nQuantity: ${actualQty.toFixed(6)} | Reason: Stop Loss Hit`;
                monitor.sendDesktopNotification(`Position Closed - ${monitor.symbol}`, detailedMessage);
                
                // Log position trade with comprehensive data for training
                const tradeData = {
                    symbol: monitor.symbol,
                    timestamp: new Date().toISOString(),
                    entryPrice: entryPrice,
                    exitPrice: exitPrice,
                    quantity: actualQty,
                    pnl: pnl,
                    pnlPercent: pnlPercent,
                    closeReason: 'Stop Loss Hit',
                    takeProfitPercent: takeProfitPercent,
                    stopLossPercent: stopLossPercent,
                    takeProfitPrice: takeProfitPrice,
                    stopLossPrice: stopLossPrice,
                    maType: monitor.quantumMA.maType || 'Unknown',
                    maLength: monitor.quantumMA.baseLength,
                    timeframe: monitor.timeframe,
                    currentPrice: currentPrice,
                    trendDirection: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([currentPrice]).trendDirection : 'Unknown',
                    score: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([currentPrice]).score : 0,
                    rSquared: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([currentPrice]).rSquared : 0
                };
                logPositionTrade(monitor, tradeData);
                
                // Clear saved TP/SL values since position is closed
                monitor.clearTPSLValues(monitor.symbol);
            } catch (error) {
                logApiError('SL sell order', error);
                console.error('Error closing position at stop-loss:', error.message);
                monitor.sendDesktopNotification('Order Error', `${monitor.symbol} - Error closing position: ${error.message}`);
            }
            break;
        }
    }
}

async function executeTrade(monitor, signal) {
    try {
        if (!monitor.currentPrice || isNaN(monitor.currentPrice)) {
            console.error('Invalid current price, cannot execute trade');
            monitor.sendDesktopNotification('Trade Error', 'Invalid current price, cannot execute trade');
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
                
                // Save TP/SL values generated by Llama
                monitor.saveTPSLValues(monitor.symbol, monitor.currentPrice, takeProfitPercent, stopLossPercent);
            } else {
                // Calculate max affordable quantity
                const maxAffordable = availableCash / monitor.currentPrice;
                quantity = Math.min(fixedQuantity, maxAffordable);
                // Round down to 6 decimals (BTC precision)
                quantity = Math.floor(quantity * 1e6) / 1e6;
                if (quantity <= 0) {
                    console.error(`Insufficient cash to buy any ${monitor.symbol}. Available cash: $${availableCash}`);
                    monitor.sendDesktopNotification('Trade Error', `Insufficient cash to buy ${monitor.symbol}`);
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
            console.log('\n' + '-'.repeat(50));
            console.log(`EXECUTING BUY ORDER`);
            console.log('-'.repeat(50));
            console.log(`Symbol: ${monitor.symbol}`);
            console.log(`Quantity: ${quantity}`);
            console.log(`Current Price: $${monitor.currentPrice}`);
            console.log(`Available Cash: $${availableCash}`);
            console.log(`Position Size: $${(quantity * monitor.currentPrice).toFixed(2)}`);
            console.log(`Take Profit: ${takeProfitPercent}% | Stop Loss: ${stopLossPercent}%`);
            console.log('-'.repeat(50));
            
            // Desktop notification for buy order
            monitor.sendDesktopNotification('Buy Order', `${monitor.symbol} - Buying ${quantity} at $${monitor.currentPrice.toFixed(2)}`);
            
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
                monitor.sendDesktopNotification('Order Filled', `${monitor.symbol} - Buy order filled successfully`);
                // Start monitoring for TP/SL in the background
                monitorTakeProfitStopLoss(monitor, monitor.currentPrice, quantity, takeProfitPercent, stopLossPercent);
            } catch (error) {
                logApiError('BUY order', error);
                console.error('Error executing buy order:', error.message);
                monitor.sendDesktopNotification('Order Error', `${monitor.symbol} - Error executing buy order: ${error.message}`);
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
                monitor.sendDesktopNotification('Trade Error', `No position to sell for ${monitor.symbol}`);
                monitor.stopMonitoring();
                process.exit(1);
                return;
            }
            console.log('\n' + '-'.repeat(50));
            console.log(`EXECUTING SELL ORDER`);
            console.log('-'.repeat(50));
            console.log(`Symbol: ${monitor.symbol}`);
            console.log(`Quantity: ${quantity}`);
            console.log(`Current Price: $${monitor.currentPrice}`);
            console.log('-'.repeat(50));
            
            // Desktop notification for sell order
            monitor.sendDesktopNotification('Sell Order', `${monitor.symbol} - Selling ${quantity} at $${monitor.currentPrice.toFixed(2)}`);
            
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
                monitor.sendDesktopNotification('Order Filled', `${monitor.symbol} - Sell order filled successfully`);
            } catch (error) {
                logApiError('SELL order', error);
                console.error('Error executing SELL order:', error.message);
                monitor.sendDesktopNotification('Order Error', `${monitor.symbol} - Error executing sell order: ${error.message}`);
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
            monitor.sendDesktopNotification('Trade Complete', `${monitor.symbol} - ${pnlStr}: $${pnl.toFixed(2)}`);
            
            // Log position trade with comprehensive data for training
            const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
            const tradeData = {
                symbol: monitor.symbol,
                timestamp: new Date().toISOString(),
                entryPrice: entryPrice,
                exitPrice: exitPrice,
                quantity: quantity,
                pnl: pnl,
                pnlPercent: pnlPercent,
                closeReason: 'Manual SELL',
                takeProfitPercent: monitor.takeProfit,
                stopLossPercent: monitor.stopLoss,
                takeProfitPrice: monitor.takeProfit !== 'auto' ? entryPrice * (1 + parseFloat(monitor.takeProfit) / 100) : null,
                stopLossPrice: monitor.stopLoss !== 'auto' ? entryPrice * (1 - parseFloat(monitor.stopLoss) / 100) : null,
                maType: monitor.quantumMA.maType || 'Unknown',
                maLength: monitor.quantumMA.baseLength,
                timeframe: monitor.timeframe,
                currentPrice: monitor.currentPrice,
                trendDirection: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([monitor.currentPrice]).trendDirection : 'Unknown',
                score: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([monitor.currentPrice]).score : 0,
                rSquared: monitor.quantumMA.analyze ? monitor.quantumMA.analyze([monitor.currentPrice]).rSquared : 0
            };
            logPositionTrade(monitor, tradeData);
            
            // Clear saved TP/SL values since position is closed
            monitor.clearTPSLValues(monitor.symbol);
        }
    } catch (error) {
        logApiError('General trade execution', error);
        console.error('Error executing trade:', error.message);
        monitor.sendDesktopNotification('Trade Error', `Error executing trade: ${error.message}`);
        if (error.response && error.response.data) {
            console.error('Error details:', error.response.data);
        }
        monitor.stopMonitoring();
        process.exit(1);
    }
}

module.exports = { executeTrade, monitorTakeProfitStopLoss, logPositionTrade }; 