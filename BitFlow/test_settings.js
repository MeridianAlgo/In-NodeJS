const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'user_settings.json');

function loadSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            console.log('Loaded user_settings.json:', settings);
            // Simulate how BitFlow would use them
            const userPreferences = {
                ...settings,
                enablePositionLogging: settings.enablePositionLogging !== undefined ? settings.enablePositionLogging : true,
                enableCrossunderSignals: settings.enableCrossunderSignals !== undefined ? settings.enableCrossunderSignals : false,
                enablePerformanceMetrics: settings.enablePerformanceMetrics !== undefined ? settings.enablePerformanceMetrics : false
            };
            console.log('Simulated BitFlow userPreferences:', userPreferences);
        } catch (e) {
            console.error('Error reading user_settings.json:', e);
        }
    } else {
        console.warn('user_settings.json does not exist.');
    }
}

loadSettings(); 