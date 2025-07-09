// API helper functions for BitFlow
const axios = require('axios');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const LLAMA_API_KEY = process.env.LLAMA_API_KEY;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function checkLlamaAPI() {
    if (!LLAMA_API_KEY) return false;
    try {
        const response = await axios.post(
            'https://api.llama.com/v1/chat/completions',
            {
                model: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'What is 2+2?' }
                ],
                max_tokens: 8
            },
            {
                headers: {
                    'Authorization': `Bearer ${LLAMA_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        let answer = '';
        if (
            response.data &&
            response.data.completion_message &&
            response.data.completion_message.content &&
            typeof response.data.completion_message.content.text === 'string'
        ) {
            answer = response.data.completion_message.content.text.trim();
        } else if (response.data.choices && response.data.choices[0] && response.data.choices[0].message && response.data.choices[0].message.content) {
            answer = response.data.choices[0].message.content.trim();
        }
        return answer === '4' || answer === '4.' || answer.toLowerCase().includes('4');
    } catch (err) {
        return false;
    }
}

async function checkPolygonNewsAPI() {
    if (!POLYGON_API_KEY) return false;
    try {
        const url = `https://api.polygon.io/v2/reference/news?apiKey=${POLYGON_API_KEY}&limit=1`;
        const response = await fetch(url);
        const data = await response.json();
        return data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0;
    } catch (err) {
        return false;
    }
}

async function fetchPolygonNews(symbol) {
    if (!POLYGON_API_KEY) return [];
    
    try {
        // Get the base symbol without the currency pair
        const baseSymbol = symbol.split('/')[0];
        
        // For crypto, we need to search for the base symbol
        const url = `https://api.polygon.io/v2/reference/news?ticker=${baseSymbol}&apiKey=${POLYGON_API_KEY}&limit=10&order=desc`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.status !== 'OK' || !data.results) return [];
        
        // Filter and format the news articles
        return data.results
            .filter(article => article.title && article.description)
            .slice(0, 5)
            .map(article => ({
                title: article.title,
                description: article.description,
                content: article.description, // Polygon doesn't provide full content
                publishedAt: article.published_utc,
                url: article.article_url
            }));
    } catch (err) {
        console.warn('Error fetching Polygon news:', err.message);
        return [];
    }
}

async function analyzeSentimentWithGemini(symbol, articles) {
    if (!GEMINI_API_KEY || !articles || articles.length === 0) {
        return { sentiment: 'neutral', score: 0, confidence: 0, articlesAnalyzed: 0 };
    }
    
    try {
        // Prepare the articles text for analysis
        const articlesText = articles.map(article => 
            `Title: ${article.title}\nDescription: ${article.description}`
        ).join('\n\n');
        
        const prompt = `Analyze the sentiment of these cryptocurrency news articles about ${symbol}. 

Articles:
${articlesText}

Please provide a sentiment analysis with the following format:
- Overall sentiment: [positive/negative/neutral]
- Sentiment score: [number between -1 and 1, where -1 is very negative, 0 is neutral, 1 is very positive]
- Confidence: [number between 0 and 1 indicating how confident you are in this analysis]
- Brief reasoning: [1-2 sentences explaining your assessment]

Only return the analysis in the exact format above.`;

        const headers = { 'Content-Type': 'application/json' };
        const params = new URLSearchParams({ key: GEMINI_API_KEY });
        const data = { contents: [{ parts: [{ text: prompt }] }] };
        
        const response = await fetch(`${GEMINI_API_URL}?${params.toString()}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.status}`);
        }
        
        const result = await response.json();
        const text = result.candidates[0].content.parts[0].text;
        
        // Parse the response
        const sentimentMatch = text.match(/Overall sentiment:\s*(positive|negative|neutral)/i);
        const scoreMatch = text.match(/Sentiment score:\s*([-]?\d*\.?\d+)/i);
        const confidenceMatch = text.match(/Confidence:\s*(\d*\.?\d+)/i);
        
        const sentiment = sentimentMatch ? sentimentMatch[1].toLowerCase() : 'neutral';
        const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
        const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0;
        
        return {
            sentiment,
            score: Math.round(score * 100) / 100,
            confidence: Math.round(confidence * 100) / 100,
            articlesAnalyzed: articles.length
        };
        
    } catch (error) {
        console.warn('Error analyzing sentiment with Gemini:', error.message);
        return { sentiment: 'neutral', score: 0, confidence: 0, articlesAnalyzed: 0 };
    }
}

async function analyzeSentiment(symbol) {
    try {
        // Fetch news from Polygon
        const articles = await fetchPolygonNews(symbol);
        if (!articles || articles.length === 0) {
            return { sentiment: 'neutral', score: 0, confidence: 0, articlesAnalyzed: 0 };
        }
        
        // Analyze sentiment using Gemini AI
        return await analyzeSentimentWithGemini(symbol, articles);
        
    } catch (error) {
        console.warn('Error analyzing sentiment:', error.message);
        return { sentiment: 'neutral', score: 0, confidence: 0, articlesAnalyzed: 0 };
    }
}

async function fetchArticleText(url) {
    try {
        const { data: html } = await axios.get(url, { timeout: 10000 });
        const $ = cheerio.load(html);
        let text = $('article').text();
        if (!text || text.length < 200) {
            let maxLen = 0, best = '';
            $('p').each((_, el) => {
                const t = $(el).text();
                if (t.length > maxLen) { maxLen = t.length; best = t; }
            });
            text = best;
        }
        if (!text || text.length < 100) {
            text = $('p').map((_, el) => $(el).text()).get().join(' ');
        }
        return text.trim().replace(/\s+/g, ' ').slice(0, 1000);
    } catch (e) {
        return '';
    }
}

function isCryptoTicker(ticker) {
    return ticker.includes('/') || [
        'BTC','ETH','LTC','XRP','DOGE','BNB','SOL','ADA','USDT','USDC','DOT','TRX','SHIB','AVAX','MATIC','WBTC','LINK','UNI','BCH','XLM','FIL','ETC','ICP','LDO','APT','CRO','ARB','QNT','VET','NEAR','OP','GRT','AAVE','MKR','ALGO','EGLD','XTZ','SAND','AXS','THETA','EOS','KAVA','MANA','SNX','RPL','FTM','XMR','FLOW','CHZ','CAKE','CRV','ENJ','ZEC','BAT','DASH','ZIL','COMP','1INCH','KSM','YFI','REN','BNT','BAL','SRM','LRC','OMG','NMR','OCEAN','BAND','STORJ','CVC','SUSHI','ANKR','SKL','GNO','GLM','REP','PAXG','CEL','RSR','REN','LPT','RUNE','SXP','HNT','DGB','KNC','CKB','ZEN','XEM','SC','LSK','STEEM','ARDR','STRAX','SYS','NXT','FCT','GAS','NAV','VTC','GAME','DCR','PIVX','XVG','BTG','BTM','QASH','WAVES','ICX','ONT','ZRX','QKC','WAN','LOOM','CENNZ','BTS','GNT','FUN','POWR','MITH','ELF','STORM','POLY','CMT','MANA','WTC','LRC','RCN','RDN','APPC','ENG','VIB','OST','LEND','TNT','FUEL','ARN','GVT','CDT','AMB','BCPT','GTO','QSP','SNM','BQX','TRIG','EVX','REQ','VIBE','WINGS','BRD','POE','TNB'
    ].includes(ticker.toUpperCase());
}

module.exports = {
    checkLlamaAPI,
    checkPolygonNewsAPI,
    fetchPolygonNews,
    fetchArticleText,
    isCryptoTicker,
    analyzeSentiment,
    analyzeSentimentWithGemini
}; 