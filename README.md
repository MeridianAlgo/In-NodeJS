# MeridianAlgo - Ourtake

**MeridianAlgo** offers our unique take on popular trading bot strategies. As a non-profit, we leverage Alpaca's paper trading features for all "buy and sell" orders, focusing solely on research and development without financial gain.

## 🌟 Overview

The `QuantumMA` module is a core component of MeridianAlgo's research, designed to identify optimal moving average (MA) strategies adaptively. Unlike traditional moving averages with fixed lengths, `QuantumMA` dynamically determines the best-performing MA type and length for a given set of price data. This adaptive approach aims to provide more responsive and insightful trend analysis. We implment this into our bots which then do all the work for you.

## ✨ Features

* **Adaptive Moving Average Selection:** Automatically evaluates multiple MA types (SMA, EMA, WMA, Hull, ALMA, RMA, LINREG, VWMA) and various lengths to find the best fit.
* **Performance Scoring:** Utilizes a custom scoring mechanism to evaluate the effectiveness of different MA configurations based on historical price movements.
* **R-squared Calculation:** Provides an R-squared value to indicate how well the chosen moving average fits the price data.
* **Trend Direction Analysis:** Offers a clear "Bullish," "Bearish," or "Neutral" trend indication based on the optimal MA.
* **Flexible Configuration:** Customizable `baseLength`, `evalPeriod`, `almaOffset`, and `almaSigma` parameters for fine-tuning the analysis.
* **Node.js & Python Compatibility:** While the primary implementation provided here is in Node.js, the core logic is designed to be easily translatable and integrated into our Python-based trading infrastructure.

## 🚀 How it Works (Node.js)

The `QuantumMA` class takes historical price data and analyzes it to determine the most effective moving average. It calculates various MA types across different lengths (short, mid, long relative to the `baseLength`) and assigns a "score" based on how well each MA would have captured price movements within the `evalPeriod`. The MA configuration with the highest score is then selected as the "best MA" for the given data.

### Installation

No special installation is required beyond having Node.js installed.
