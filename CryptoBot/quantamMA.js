class QuantumMA {
    constructor(baseLength = 20, evalPeriod = 20, almaOffset = 0.85, almaSigma = 6.0) {
        this.baseLength = baseLength;
        this.evalPeriod = evalPeriod;
        this.almaOffset = almaOffset;
        this.almaSigma = almaSigma;
        this.MA_TYPES = ['SMA', 'Hull', 'EMA', 'WMA', 'RMA', 'LINREG', 'ALMA', 'VWMA'];
    }

    calculateSMA(prices, length) {
        if (prices.length < length) return 0;
        const sum = prices.slice(-length).reduce((a, b) => a + b, 0);
        return sum / length;
    }

    calculateEMA(prices, length) {
        if (prices.length < length) return 0;
        const multiplier = 2 / (length + 1);
        let ema = this.calculateSMA(prices, length);
        
        for (let i = length; i < prices.length; i++) {
            ema = (prices[i] - ema) * multiplier + ema;
        }
        return ema;
    }

    calculateWMA(prices, length) {
        if (prices.length < length) return 0;
        const weights = Array.from({length}, (_, i) => i + 1);
        const sumWeights = weights.reduce((a, b) => a + b, 0);
        let sum = 0;
        
        for (let i = 0; i < length; i++) {
            sum += prices[prices.length - length + i] * weights[i];
        }
        return sum / sumWeights;
    }

    calculateHMA(prices, length) {
        if (prices.length < length) return 0;
        const halfLength = Math.floor(length / 2);
        const sqrtLength = Math.floor(Math.sqrt(length));
        
        const wma1 = this.calculateWMA(prices, halfLength);
        const wma2 = this.calculateWMA(prices, length);
        const rawHMA = 2 * wma1 - wma2;
        
        return this.calculateWMA([...prices.slice(0, -1), rawHMA], sqrtLength);
    }

    calculateALMA(prices, length) {
        if (prices.length < length) return 0;
        const m = this.almaOffset * (length - 1);
        const s = length / this.almaSigma;
        let sum = 0;
        let sumWeights = 0;
        
        for (let i = 0; i < length; i++) {
            const weight = Math.exp(-Math.pow(i - m, 2) / (2 * s * s));
            sum += prices[prices.length - length + i] * weight;
            sumWeights += weight;
        }
        return sum / sumWeights;
    }

    calculateRMA(prices, length) {
        if (prices.length < length) return 0;
        let rma = this.calculateSMA(prices, length);
        for (let i = length; i < prices.length; i++) {
            rma = (rma * (length - 1) + prices[i]) / length;
        }
        return rma;
    }

    calculateLINREG(prices, length) {
        if (prices.length < length) return 0;
        const x = Array.from({length}, (_, i) => i);
        const y = prices.slice(-length);
        
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
        const sumXX = x.reduce((a, b) => a + b * b, 0);
        
        const slope = (length * sumXY - sumX * sumY) / (length * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / length;
        
        return slope * (length - 1) + intercept;
    }

    calculateVWMA(prices, length) {
        if (prices.length < length) return 0;
        // Since we don't have volume data, we'll use a simple WMA as fallback
        return this.calculateWMA(prices, length);
    }

    calculateMA(prices, type, length) {
        switch(type) {
            case 'SMA': return this.calculateSMA(prices, length);
            case 'EMA': return this.calculateEMA(prices, length);
            case 'WMA': return this.calculateWMA(prices, length);
            case 'Hull': return this.calculateHMA(prices, length);
            case 'ALMA': return this.calculateALMA(prices, length);
            case 'RMA': return this.calculateRMA(prices, length);
            case 'LINREG': return this.calculateLINREG(prices, length);
            case 'VWMA': return this.calculateVWMA(prices, length);
            default: return this.calculateSMA(prices, length);
        }
    }

    calculateScore(prices, maValues, length) {
        let score = 0;
        for (let i = 1; i < this.evalPeriod; i++) {
            const longSignal = prices[i] > maValues[i] && prices[i-1] <= maValues[i-1];
            const shortSignal = prices[i] < maValues[i] && prices[i-1] >= maValues[i-1];
            
            if (longSignal) {
                score += prices[i-1] - prices[i];
            } else if (shortSignal) {
                score += prices[i] - prices[i-1];
            }
        }
        return score / length;
    }

    calculateRSquared(prices, maValues, length) {
        const yMean = prices.slice(-length).reduce((a, b) => a + b, 0) / length;
        const maMean = maValues.slice(-length).reduce((a, b) => a + b, 0) / length;
        
        let ssTot = 0;
        let ssRes = 0;
        
        for (let i = 0; i < length; i++) {
            ssTot += Math.pow(prices[prices.length - length + i] - yMean, 2);
            ssRes += Math.pow(prices[prices.length - length + i] - maValues[maValues.length - length + i], 2);
        }
        
        return 1 - (ssRes / (ssTot === 0 ? 1 : ssTot));
    }

    analyze(prices) {
        const shortLength = Math.round(this.baseLength * 0.5);
        const midLength = this.baseLength;
        const longLength = Math.round(this.baseLength * 2);
        
        let bestMA = [];
        let bestMAType = 'EMA';
        let bestLength = midLength;
        let bestScore = -Infinity;
        
        // Calculate and compare all MA combinations
        for (const maType of this.MA_TYPES) {
            for (const length of [shortLength, midLength, longLength]) {
                const maValues = prices.map((_, i) => 
                    this.calculateMA(prices.slice(0, i + 1), maType, length));
                const score = this.calculateScore(prices, maValues, length);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestMA = maValues;
                    bestMAType = maType;
                    bestLength = length;
                }
            }
        }
        
        const rSquared = this.calculateRSquared(prices, bestMA, this.evalPeriod);
        const trendDirection = prices[prices.length - 1] > bestMA[bestMA.length - 1] ? 
            'Bullish' : prices[prices.length - 1] < bestMA[bestMA.length - 1] ? 
            'Bearish' : 'Neutral';
        
        return {
            maType: bestMAType,
            length: bestLength,
            score: bestScore,
            rSquared,
            trendDirection,
            maValues: bestMA
        };
    }
}

module.exports = QuantumMA;
