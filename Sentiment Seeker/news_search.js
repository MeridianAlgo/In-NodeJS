// news_search.js
// Node.js script to search NewsAPI for news about a user-specified asset/keyword
// Requires: node-fetch (install with `npm install node-fetch@2`)
// Also requires: dotenv (install with `npm install dotenv`)
// Also requires: axios (install with `npm install axios`)
// Also requires: cheerio (install with `npm install cheerio`)
// Usage: node news_search.js
//
// Create a .env file in the same directory with the following content:
// NEWS_API_KEY=YOUR_NEWSAPI_KEY_HERE
// LLAMA_API_KEY=YOUR_LLAMA_API_KEY_HERE

require('dotenv').config();
const fetch = require('node-fetch');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const LLAMA_API_KEY = process.env.LLAMA_API_KEY;

if (!NEWS_API_KEY) {
  console.error('Error: NEWS_API_KEY not set in .env file.');
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Rate limit config
const RATE_LIMIT_FILE = path.join(__dirname, 'rate_limit.json');
const MAX_REQUESTS = 1000;
const WINDOW_HOURS = 15;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

function getRequestTimestamps() {
  try {
    const data = fs.readFileSync(RATE_LIMIT_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function saveRequestTimestamps(timestamps) {
  fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(timestamps), 'utf8');
}

function isRateLimited() {
  const now = Date.now();
  let timestamps = getRequestTimestamps();
  // Remove timestamps older than 15 hours
  timestamps = timestamps.filter(ts => now - ts < WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS) {
    return true;
  }
  // Save cleaned timestamps
  saveRequestTimestamps(timestamps);
  return false;
}

function logRequest() {
  const now = Date.now();
  let timestamps = getRequestTimestamps();
  timestamps.push(now);
  // Keep only recent timestamps
  timestamps = timestamps.filter(ts => now - ts < WINDOW_MS);
  saveRequestTimestamps(timestamps);
}

// Helper to fetch and extract main text from a news article URL
async function fetchArticleText(url) {
  try {
    const { data: html } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(html);
    // Try to extract main content heuristically
    let text = $('article').text();
    if (!text || text.length < 200) {
      // Fallback: get largest <p> block
      let maxLen = 0, best = '';
      $('p').each((_, el) => {
        const t = $(el).text();
        if (t.length > maxLen) { maxLen = t.length; best = t; }
      });
      text = best;
    }
    // Fallback: get all <p> text
    if (!text || text.length < 100) {
      text = $('p').map((_, el) => $(el).text()).get().join(' ');
    }
    // Limit to 1000 chars for prompt
    return text.trim().replace(/\s+/g, ' ').slice(0, 1000);
  } catch (e) {
    return '';
  }
}

async function analyzeSentimentWithLlama(text) {
  if (!LLAMA_API_KEY) {
    return 'Llama API key not set';
  }
  try {
    const response = await axios.post(
      'https://api.llama.meta.com/v1/chat/completions',
      {
        model: 'llama-3-70b-chat',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that performs sentiment analysis by reading news headlines and descriptions from links given to you. Reply with only one word: Positive, Negative, or Neutral and give a short description of the sentiment.'
          },
          {
            role: 'user',
            content: `Analyze the sentiment of the following news headline and description:\n${text}`
          }
        ],
        max_tokens: 1
      },
      {
        headers: {
          'Authorization': `Bearer ${LLAMA_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    // Extract the sentiment from the response
    const sentiment = response.data.choices[0].message.content.trim();
    return sentiment;
  } catch (err) {
    return 'Sentiment analysis failed';
  }
}

// Helper to display a sentiment progress bar with a 0-100 scale
function displaySentimentBarScaled(sentimentText, score) {
  // Clamp score between 0 and 100
  const s = Math.max(0, Math.min(100, score));
  const barLength = 40;
  const pos = Math.round((s / 100) * (barLength - 1));
  let bar = '';
  for (let i = 0; i < barLength; i++) {
    if (i === pos) bar += '\x1b[32m█\x1b[0m';
    else bar += '─';
  }
  let label = 'Neutral';
  if (s < 20) label = 'Strongly Bearish';
  else if (s < 40) label = 'Bearish';
  else if (s < 48) label = 'Slightly Bearish';
  else if (s <= 52) label = 'Neutral';
  else if (s < 60) label = 'Slightly Bullish';
  else if (s < 80) label = 'Bullish';
  else label = 'Strongly Bullish';
  console.log(`\nSentiment Meter: ${label} (${s}/100)`);
  console.log(`  [${bar}]`);
}

async function analyzeOverallSentimentWithLlama(articles) {
  if (!LLAMA_API_KEY) {
    console.error('Llama API key not set. Please add LLAMA_API_KEY to your .env file.');
    return 'Sentiment analysis failed (missing API key)';
  }
  try {
    // Concatenate all titles, descriptions, and main text
    const combinedText = articles.map((article, idx) => {
      return `${idx + 1}. ${article.title}\n${article.description || ''}\n${article.mainText || ''}`;
    }).join('\n\n');
    const response = await axios.post(
      'https://api.llama.com/v1/chat/completions',
      {
        model: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that performs sentiment analysis by reading news headlines, descriptions, and main article content from links given to you. Reply with a sentiment score from 0 (strongly bearish) to 100 (strongly bullish), a one-word label (e.g., Bearish, Bullish, Neutral), and a short explanation. Format your answer as: Score: <number> Label: <word> Explanation: <short sentence>.'
          },
          {
            role: 'user',
            content: `Analyze the overall sentiment of the following news articles about a financial asset. Reply with a sentiment score from 0 (strongly bearish) to 100 (strongly bullish), a one-word label (e.g., Bearish, Bullish, Neutral), and a short explanation. Format your answer as: Score: <number> Label: <word> Explanation: <short sentence>.\n\n${combinedText}`
          }
        ],
        max_tokens: 64
      },
      {
        headers: {
          'Authorization': `Bearer ${LLAMA_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    if (
      response.data &&
      response.data.completion_message &&
      response.data.completion_message.content &&
      typeof response.data.completion_message.content.text === 'string'
    ) {
      return response.data.completion_message.content.text.trim();
    } else {
      console.error('Llama API response did not contain expected completion_message.content.text. Full response:', response.data);
      return 'Sentiment analysis failed (unexpected API response structure)';
    }
  } catch (err) {
    // Detailed error handling
    if (err.response) {
      console.error('Llama API responded with an error:', err.response.status, err.response.statusText);
      console.error('Response data:', err.response.data);
      if (err.response.status === 401) {
        console.error('Possible reason: Invalid or missing API key.');
      } else if (err.response.status === 429) {
        console.error('Possible reason: Rate limit or quota exceeded.');
      } else if (err.response.status === 404) {
        console.error('Possible reason: Endpoint URL is incorrect.');
      }
    } else if (err.request) {
      console.error('No response received from Llama API. Possible network issue or endpoint is down.');
    } else {
      console.error('Error setting up the request:', err.message);
    }
    return 'Sentiment analysis failed (see error details above)';
  }
}

rl.question('Enter the asset or keyword to search news for: ', async (keyword) => {
  if (!keyword) {
    console.log('No keyword entered. Exiting.');
    rl.close();
    return;
  }

  // Rate limit check
  if (isRateLimited()) {
    console.error(`Rate limit exceeded: You have made ${MAX_REQUESTS} requests in the last ${WINDOW_HOURS} hours. Please wait before making more requests.`);
    rl.close();
    return;
  }

  // Build the NewsAPI URL
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(keyword)}&sortBy=publishedAt&language=en&apiKey=${NEWS_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.status !== 'ok') {
      console.error('Error from NewsAPI:', data.message);
    } else {
      logRequest();
      console.log('\n' + '='.repeat(60));
      console.log(`Top news articles for '${keyword}':`);
      console.log('-'.repeat(60));
      const articles = data.articles.slice(0, 5);
      // Fetch article content for each article
      const articlesWithContent = await Promise.all(articles.map(async (article, idx) => {
        const mainText = await fetchArticleText(article.url);
        return {
          ...article,
          mainText
        };
      }));
      articlesWithContent.forEach((article, idx) => {
        console.log(`\n${idx + 1}. ${article.title}`);
        console.log(`   Source: ${article.source.name}`);
        console.log(`   Published: ${article.publishedAt}`);
        console.log(`   URL: ${article.url}`);
      });
      if (articlesWithContent.length === 0) {
        console.log('No articles found.');
      } else {
        console.log('\n' + '='.repeat(60));
        console.log('SENTIMENT ANALYSIS');
        console.log('-'.repeat(60));
        // Overall sentiment analysis for all 5 articles, including main text
        const sentiment = await analyzeOverallSentimentWithLlama(articlesWithContent);
        // Try to extract a score from the Llama response
        let score = 50; // Default neutral
        const scoreMatch = sentiment.match(/score\s*[:=\-]?\s*(-?\d{1,3})/i);
        if (scoreMatch) {
          score = parseInt(scoreMatch[1], 10);
          if (score < 0) score = 0;
          if (score > 100) score = 100;
        } else {
          // Try to infer from words
          const t = sentiment.toLowerCase();
          if (t.includes('strong') && t.includes('bear')) score = 5;
          else if (t.includes('bear')) score = 25;
          else if (t.includes('neutral')) score = 50;
          else if (t.includes('bull') && t.includes('strong')) score = 95;
          else if (t.includes('bull')) score = 75;
        }
        console.log(`\nOverall Sentiment Summary:`);
        console.log('-'.repeat(60));
        console.log(sentiment);
        console.log('-'.repeat(60));
        displaySentimentBarScaled(sentiment, score);
        console.log('='.repeat(60) + '\n');
      }
    }
  } catch (err) {
    console.error('Failed to fetch news:', err);
  }
  rl.close();
}); 