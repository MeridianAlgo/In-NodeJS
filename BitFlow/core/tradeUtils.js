// core/tradeUtils.js

// This file will contain trading/order execution logic for BitFlow.
// For now, export a placeholder. The real logic will be moved from BitFlow.js.

const fs = require('fs');
const path = require('path');
const { SMA, EMA } = require('technicalindicators');
const { printStatus, printSuccess, printWarning, printError, printBanner, printCard } = require('./ui');
const { analyzeSentiment } = require('./apiHelpers');

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

async function logPositionTrade(monitor, tradeData) {
    try {
        // Get additional market data for logging
        let additionalData = {};
        
        try {
            // Get current market data
            const prices = await monitor.getCryptoData();
            if (prices && prices.length > 0) {
                // Calculate volatility
                const volatility = monitor.calculateVolatility(prices.slice(-100));
                
                // Calculate MA lengths (adaptive)
                const volScale = monitor.volScale || 10;
                const baseLength = monitor.baseLength || 20;
                const fastLength = Math.max(5, Math.round(baseLength - volScale * volatility));
                const slowLength = Math.max(fastLength + 5, Math.round(baseLength + volScale * volatility));
                
                // Calculate current MA values
                const fastMA = SMA.calculate({ period: fastLength, values: prices });
                const slowMA = EMA.calculate({ period: slowLength, values: prices });
                const currentFastMA = fastMA.length > 0 ? fastMA[fastMA.length - 1] : null;
                const currentSlowMA = slowMA.length > 0 ? slowMA[slowMA.length - 1] : null;
                
                // Calculate RSI
                const rsi = monitor.calculateRSI(prices, monitor.rsiPeriod || 14);
                const currentRSI = rsi.length > 0 ? rsi[rsi.length - 1] : null;
                
                additionalData = {
                    volatility: Math.round(volatility * 100) / 100,
                    fastMALength: fastLength,
                    slowMALength: slowLength,
                    currentFastMA: currentFastMA ? Math.round(currentFastMA * 10000) / 10000 : null,
                    currentSlowMA: currentSlowMA ? Math.round(currentSlowMA * 10000) / 10000 : null,
                    rsiPeriod: monitor.rsiPeriod || 14,
                    currentRSI: currentRSI ? Math.round(currentRSI * 100) / 100 : null,
                    baseLength: baseLength,
                    volScale: volScale,
                    dataPoints: prices.length
                };
            }
        } catch (error) {
            printWarning('Could not calculate additional market data for logging: ' + error.message);
        }
        
        // Get sentiment analysis
        let sentimentData = {};
        try {
            sentimentData = await analyzeSentiment(monitor.symbol);
        } catch (error) {
            printWarning('Could not analyze sentiment for logging: ' + error.message);
            sentimentData = { sentiment: 'neutral', score: 0, confidence: 0, articlesAnalyzed: 0 };
        }
        
        // Combine all data
        const enhancedTradeData = {
            ...tradeData,
            ...additionalData,
            sentiment: sentimentData.sentiment,
            sentimentScore: sentimentData.score,
            sentimentConfidence: sentimentData.confidence,
            sentimentArticlesAnalyzed: sentimentData.articlesAnalyzed
        };
        
        // JSON Logging ONLY
        const jsonLogPath = path.join(__dirname, '../logs/position_log.json');
        let jsonArr = [];
        if (fs.existsSync(jsonLogPath)) {
            try {
                const raw = fs.readFileSync(jsonLogPath, 'utf8');
                jsonArr = JSON.parse(raw);
                if (!Array.isArray(jsonArr)) jsonArr = [];
            } catch (e) {
                jsonArr = [];
            }
        }
        // Append new trade
        jsonArr.push(enhancedTradeData);
        fs.writeFileSync(jsonLogPath, JSON.stringify(jsonArr, null, 2), 'utf8');
        printStatus(`📊 Position logged (JSON): ${tradeData.symbol}`);
        
        // Log sentiment info if available
        if (sentimentData.articlesAnalyzed > 0) {
            printStatus(`📰 Sentiment: ${sentimentData.sentiment} (score: ${sentimentData.score}, confidence: ${sentimentData.confidence}, articles: ${sentimentData.articlesAnalyzed})`);
        }
    } catch (error) {
        printWarning('Could not log position trade (JSON): ' + error.message);
    }
}

async function monitorTakeProfitStopLoss(monitor, entryPrice, quantity, takeProfitPercent, stopLossPercent) {
    const symbol = monitor.symbol.replace('/', '');
    const takeProfitPrice = entryPrice * (1 + takeProfitPercent / 100);
    const stopLossPrice = entryPrice * (1 - stopLossPercent / 100);
    printStatus(`TP/SL Monitor: TP $${takeProfitPrice.toFixed(2)}, SL $${stopLossPrice.toFixed(2)}`);
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
            // Use adaptive MA logic
            const volatility = monitor.calculateVolatility(prices.slice(-100));
            let fastLength = Math.max(5, Math.round((monitor.baseLength || 20) - (monitor.volScale || 10) * volatility));
            let slowLength = Math.max(fastLength + 5, Math.round((monitor.baseLength || 20) + (monitor.volScale || 10) * volatility));
            const fastMA = SMA.calculate({ period: fastLength, values: prices });
            const slowMA = EMA.calculate({ period: slowLength, values: prices });
            if (prices.length >= 2 && fastMA.length >= 2 && slowMA.length >= 2) {
                const lastFast = fastMA[fastMA.length - 1];
                const lastSlow = slowMA[slowMA.length - 1];
                const prevFast = fastMA[fastMA.length - 2];
                const prevSlow = slowMA[slowMA.length - 2];
                if (prevFast >= prevSlow && lastFast < lastSlow) {
                    // MA crossunder detected
                    printWarning(`TP/SL Monitor: MA crossunder detected. Closing position.`);
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
                        printWarning(`TP/SL Monitor: Position closed due to MA crossunder.`);
                        
                        // Calculate and display P&L
                        const exitPrice = currentPrice;
                        const pnl = (exitPrice - entryPrice) * actualQty;
                        const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
                        const pnlEmoji = pnl >= 0 ? '📈' : '📉';
                        const pnlStr = pnl >= 0 ? 'PROFIT' : 'LOSS';
                        
                        printBanner('POSITION CLOSED - ' + monitor.symbol);
                        printStatus('Reason: MA Crossunder');
                        printStatus(`Entry Price: $${entryPrice.toFixed(2)}`);
                        printStatus(`Exit Price: $${exitPrice.toFixed(2)}`);
                        printStatus(`Quantity: ${actualQty.toFixed(6)}`);
                        printStatus(`${pnlEmoji} ${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
                        
                        // Enhanced notification with full details
                        const fee = Math.abs(exitPrice * actualQty) * 0.0025; // 0.25% taker fee
                        const netPnl = pnl - fee;
                        const detailedMessage = `${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)\nEntry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}\nQuantity: ${actualQty.toFixed(6)} | Reason: MA Crossunder\nFee: $${fee.toFixed(2)} | Net P&L: $${netPnl.toFixed(2)}`;
                        monitor.sendDesktopNotification(`Position Closed - ${monitor.symbol}`, detailedMessage);
                        
                        // Log position trade (omit MA/score fields)
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
                            timeframe: monitor.timeframe,
                            currentPrice: currentPrice
                        };
                        await logPositionTrade(monitor, tradeData);
                        
                        // Clear saved TP/SL values since position is closed
                        monitor.clearTPSLValues(monitor.symbol);
                    } catch (error) {
                        logApiError('MA crossunder sell order', error);
                        printError('Error closing position at MA crossunder: ' + error.message);
                        monitor.sendDesktopNotification('Order Error', `${monitor.symbol} - Error closing position: ${error.message}`);
                    }
                    break;
                }
            }
        }
        // 2. Check for TP
        if (currentPrice >= takeProfitPrice) {
            printWarning(`TP/SL Monitor: Take profit hit. Closing position.`);
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
                printWarning(`TP/SL Monitor: Position closed at take-profit.`);
                
                // Calculate and display P&L
                const exitPrice = currentPrice;
                const pnl = (exitPrice - entryPrice) * actualQty;
                const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
                const pnlEmoji = pnl >= 0 ? '📈' : '📉';
                const pnlStr = pnl >= 0 ? 'PROFIT' : 'LOSS';
                
                printBanner('POSITION CLOSED - ' + monitor.symbol);
                printStatus('Reason: Take Profit Hit');
                printStatus(`Entry Price: $${entryPrice.toFixed(2)}`);
                printStatus(`Exit Price: $${exitPrice.toFixed(2)}`);
                printStatus(`Quantity: ${actualQty.toFixed(6)}`);
                printStatus(`${pnlEmoji} ${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
                
                // Enhanced notification with full details
                const fee = Math.abs(exitPrice * actualQty) * 0.0025; // 0.25% taker fee
                const netPnl = pnl - fee;
                const detailedMessage = `${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)\nEntry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}\nQuantity: ${actualQty.toFixed(6)} | Reason: Take Profit Hit\nFee: $${fee.toFixed(2)} | Net P&L: $${netPnl.toFixed(2)}`;
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
                    timeframe: monitor.timeframe,
                    currentPrice: currentPrice
                };
                logPositionTrade(monitor, tradeData);
                
                // Clear saved TP/SL values since position is closed
                monitor.clearTPSLValues(monitor.symbol);
            } catch (error) {
                logApiError('TP sell order', error);
                printError('Error closing position at take-profit: ' + error.message);
                monitor.sendDesktopNotification('Order Error', `${monitor.symbol} - Error closing position: ${error.message}`);
            }
            break;
        }
        // 3. Check for SL
        if (currentPrice <= stopLossPrice) {
            printWarning(`TP/SL Monitor: Stop loss hit. Closing position.`);
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
                printWarning(`TP/SL Monitor: Position closed at stop-loss.`);
                
                // Calculate and display P&L
                const exitPrice = currentPrice;
                const pnl = (exitPrice - entryPrice) * actualQty;
                const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
                const pnlEmoji = pnl >= 0 ? '📈' : '📉';
                const pnlStr = pnl >= 0 ? 'PROFIT' : 'LOSS';
                
                printBanner('POSITION CLOSED - ' + monitor.symbol);
                printStatus('Reason: Stop Loss Hit');
                printStatus(`Entry Price: $${entryPrice.toFixed(2)}`);
                printStatus(`Exit Price: $${exitPrice.toFixed(2)}`);
                printStatus(`Quantity: ${actualQty.toFixed(6)}`);
                printStatus(`${pnlEmoji} ${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
                
                // Enhanced notification with full details
                const fee = Math.abs(exitPrice * actualQty) * 0.0025; // 0.25% taker fee
                const netPnl = pnl - fee;
                const detailedMessage = `${pnlStr}: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)\nEntry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}\nQuantity: ${actualQty.toFixed(6)} | Reason: Stop Loss Hit\nFee: $${fee.toFixed(2)} | Net P&L: $${netPnl.toFixed(2)}`;
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
                    timeframe: monitor.timeframe,
                    currentPrice: currentPrice
                };
                await logPositionTrade(monitor, tradeData);
                
                // Clear saved TP/SL values since position is closed
                monitor.clearTPSLValues(monitor.symbol);
            } catch (error) {
                logApiError('SL sell order', error);
                printError('Error closing position at stop-loss: ' + error.message);
                monitor.sendDesktopNotification('Order Error', `${monitor.symbol} - Error closing position: ${error.message}`);
            }
            break;
        }
    }
}

async function executeTrade(monitor, signal) {
    try {
        if (!monitor.currentPrice || isNaN(monitor.currentPrice)) {
            printError('Invalid current price, cannot execute trade');
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
                    printError(`Insufficient cash to buy any ${monitor.symbol}. Available cash: $${availableCash}`);
                    monitor.sendDesktopNotification('Trade Error', `Insufficient cash to buy ${monitor.symbol}`);
                    monitor.stopMonitoring();
                    process.exit(1);
                    return;
                }
                if (quantity < fixedQuantity) {
                    printWarning(`Requested quantity (${fixedQuantity}) exceeds available cash. Adjusted to ${quantity}.`);
                }
                // Use manual TP/SL, clamp to 0.1-10%
                if (monitor.takeProfit !== 'auto') takeProfitPercent = Math.max(0.1, Math.min(parseFloat(monitor.takeProfit), 10));
                if (monitor.stopLoss !== 'auto') stopLossPercent = Math.max(0.1, Math.min(parseFloat(monitor.stopLoss), 10));
            }
            printCard('BUY ORDER', [
              `Symbol: ${monitor.symbol}`,
              `Quantity: ${quantity}`,
              `Current Price: $${monitor.currentPrice}`,
              `Available Cash: $${availableCash}`,
              `Position Size: $${(quantity * monitor.currentPrice).toFixed(2)}`,
              `Take Profit: ${takeProfitPercent}% | Stop Loss: ${stopLossPercent}%`
            ]);
            
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
                printSuccess(`Order placed successfully: ${order.id}`);
                monitor.sendDesktopNotification('Order Filled', `${monitor.symbol} - Buy order filled successfully`);
                // Start monitoring for TP/SL in the background
                monitorTakeProfitStopLoss(monitor, monitor.currentPrice, quantity, takeProfitPercent, stopLossPercent);
            } catch (error) {
                logApiError('BUY order', error);
                printError('Error executing buy order: ' + error.message);
                monitor.sendDesktopNotification('Order Error', `${monitor.symbol} - Error executing buy order: ${error.message}`);
                if (error.response && error.response.data) printError('Error details: ' + JSON.stringify(error.response.data));
                if (error.response && error.response.data && error.response.data.message && error.response.data.message.toLowerCase().includes('insufficient balance')) {
                    printWarning('Insufficient balance for buy order. Continuing monitoring.');
                } else {
                    return;
                }
            }
        } else if (signal === 'SELL' && currentPosition) {
            // Only sell up to what you own
            quantity = parseFloat(currentPosition.qty);
            if (quantity <= 0) {
                printError(`No position to sell for ${monitor.symbol}.`);
                monitor.sendDesktopNotification('Trade Error', `No position to sell for ${monitor.symbol}`);
                monitor.stopMonitoring();
                process.exit(1);
                return;
            }
            printCard('SELL ORDER', [
              `Symbol: ${monitor.symbol}`,
              `Quantity: ${quantity}`,
              `Current Price: $${monitor.currentPrice}`
            ]);
            
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
                printSuccess(`Order placed successfully: ${order.id}`);
                monitor.sendDesktopNotification('Order Filled', `${monitor.symbol} - Sell order filled successfully`);
            } catch (error) {
                logApiError('SELL order', error);
                printError('Error executing SELL order: ' + error.message);
                monitor.sendDesktopNotification('Order Error', `${monitor.symbol} - Error executing sell order: ${error.message}`);
                if (error.response && error.response.data) {
                    printError('Error details: ' + JSON.stringify(error.response.data));
                }
                return;
            }
            // Calculate and print profit/loss
            const entryPrice = parseFloat(currentPosition.avg_entry_price);
            const exitPrice = parseFloat(monitor.currentPrice);
            const pnl = (exitPrice - entryPrice) * quantity;
            const pnlStr = pnl >= 0 ? `Profit` : `Loss`;
            printCard('TRADE SUMMARY', [
              `Result: ${pnlStr}`,
              `PnL: $${pnl.toFixed(2)}`,
              `Entry: $${entryPrice.toFixed(2)}`,
              `Exit: $${exitPrice.toFixed(2)}`,
              `Quantity: ${quantity}`
            ]);
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
                timeframe: monitor.timeframe,
                currentPrice: monitor.currentPrice
            };
            await logPositionTrade(monitor, tradeData);
            
            // Clear saved TP/SL values since position is closed
            monitor.clearTPSLValues(monitor.symbol);
        }
    } catch (error) {
        logApiError('General trade execution', error);
        printError('Error executing trade: ' + error.message);
        monitor.sendDesktopNotification('Trade Error', `Error executing trade: ${error.message}`);
        if (error.response && error.response.data) {
            printError('Error details: ' + JSON.stringify(error.response.data));
        }
        monitor.stopMonitoring();
        process.exit(1);
    }
}

module.exports = { executeTrade, monitorTakeProfitStopLoss, logPositionTrade }; 