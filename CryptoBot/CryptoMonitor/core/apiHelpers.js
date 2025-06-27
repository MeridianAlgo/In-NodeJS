// API helper functions for CryptoMonitor
const axios = require('axios');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const LLAMA_API_KEY = process.env.LLAMA_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;

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

async function checkNewsAPI() {
    if (!NEWS_API_KEY) return false;
    try {
        const url = `https://newsapi.org/v2/everything?q=AAPL&sortBy=publishedAt&language=en&apiKey=${NEWS_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        return data.status === 'ok' && Array.isArray(data.articles) && data.articles.length > 0;
    } catch (err) {
        return false;
    }
}

async function fetchNewsArticles(symbol) {
    if (!NEWS_API_KEY) return [];
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(symbol)}&sortBy=publishedAt&language=en&apiKey=${NEWS_API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.status !== 'ok' || !data.articles) return [];
        return data.articles.slice(0, 3);
    } catch (err) {
        return [];
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
    checkNewsAPI,
    fetchNewsArticles,
    fetchArticleText,
    isCryptoTicker
}; 