# News Sentiment Analysis Tool

This Node.js tool fetches the latest news for a given asset or keyword using NewsAPI, extracts the main content from each article, and performs an overall sentiment analysis using Meta's Llama API. The result is displayed with a sentiment meter for easy interpretation.

---

## Features
- Search for news articles by keyword or asset (e.g., BTC/USD)
- Extracts and analyzes the main content of each article
- Uses Llama API for advanced sentiment analysis
- Displays a visual sentiment meter (bearish/bullish scale)

---

## Installation

1. **Clone or download this repository**

2. **Install Node.js** (if not already installed)
   - [Download Node.js](https://nodejs.org/)

3. **Install dependencies**
   ```sh
   npm install dotenv node-fetch@2 axios cheerio
   ```

4. **Create a `.env` file** in the project directory with the following content:
   ```env
   NEWS_API_KEY=your_newsapi_key_here
   LLAMA_API_KEY=your_llama_api_key_here
   ```
   - Get your NewsAPI key from [newsapi.org](https://newsapi.org/)
   - Get your Llama API key from [Meta Llama API](https://llama.developer.meta.com/)

---

## Usage

Run the script from your terminal:
```sh
node news_search.js
```
- Enter the asset or keyword when prompted (e.g., `BTC/USD`).
- The script will fetch news, analyze sentiment, and display a sentiment meter.

---

## Example Output
```
============================================================
Top news articles for 'BTC/USD':
------------------------------------------------------------
1. Bitcoin Price Turns Higher — Relief Rally Follows Reduction In Global Risk
   Source: newsBTC
   Published: 2025-06-24T02:25:29Z
   URL: http://www.newsbtc.com/analysis/btc/bitcoin-price-turns-higher-105k/
...
============================================================
SENTIMENT ANALYSIS
------------------------------------------------------------
Overall Sentiment Summary:
------------------------------------------------------------
Score: 60 Label: Bullish Explanation: The overall sentiment is bullish due to the prevalence of articles discussing potential rallies and bullish catalysts for Bitcoin, despite some mentions of crashes and declines.
------------------------------------------------------------
Sentiment Meter: Bullish (60/100)
  [───────────────────────█────────────────]
============================================================
```

---

## Notes
- The script respects NewsAPI's free plan rate limit (1000 requests per 15 hours).
- Llama API cannot browse the web; the script fetches article content for analysis.
- For best results, use valid API keys and a stable internet connection.
- As of this development LLAMA API is currently waitlisted so signing up will be nessacary however it is free to use for now
  (June 25, 2025)

---
