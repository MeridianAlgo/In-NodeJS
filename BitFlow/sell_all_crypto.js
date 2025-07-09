const Alpaca = require('@alpacahq/alpaca-trade-api');

const alpaca = new Alpaca({
    keyId: process.env.ALPACA_API_KEY_ID,
    secretKey: process.env.ALPACA_SECRET_KEY,
    paper: true,
    usePolygon: false
});

async function sellAllCryptoPositions() {
    try {
        const positions = await alpaca.getPositions();
        const cryptoPositions = positions.filter(p => p.asset_class === 'crypto');
        if (cryptoPositions.length === 0) {
            console.log('No open crypto positions to sell.');
            return;
        }
        for (const pos of cryptoPositions) {
            try {
                await alpaca.closePosition(pos.symbol);
                console.log(`Sold all of ${pos.symbol}`);
            } catch (e) {
                console.log(`Error selling ${pos.symbol}:`, e.message);
            }
        }
    } catch (e) {
        console.log('Error fetching positions:', e.message);
    }
}

sellAllCryptoPositions(); 