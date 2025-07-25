const fs = require('fs');
const path = require('path');
const { fetch } = require('./utils/fetchHelper');
const DATA_DIR = process.env.DATA_DIR || './';
const TOKEN_FILE = path.join(DATA_DIR, 'trakt_tokens.json');
const REFRESH_BUFFER = 2 * 60 * 60 * 1000; // Refresh 2 hour before expiry
let autoRefreshStarted = false;

class TokenManager {
    constructor() {
        this.refreshing = false;
        this.refreshPromise = null;
    }

    loadTokens() {
        try {
            if (fs.existsSync(TOKEN_FILE)) {
                const data = fs.readFileSync(TOKEN_FILE, 'utf8');
                const tokens = JSON.parse(data);
                console.log('Tokens loaded successfully');
                return tokens;
            }
            console.log('No token file found');
        } catch (error) {
            console.error('Error loading tokens:', error);
        }
        return null;
    }

    saveTokens(tokens) {
    try {
        // Ensure expires_at is set
        if (tokens.expires_in && !tokens.expires_at) {
            tokens.expires_at = Date.now() + (tokens.expires_in * 1000);
        }
        
        // Add timestamp
        tokens.saved_at = Date.now();
        
        // Create/replace single backup file
        const backupFile = TOKEN_FILE.replace('.json', '.backup.json');
        if (fs.existsSync(TOKEN_FILE)) {
            try {
                fs.copyFileSync(TOKEN_FILE, backupFile);
                console.log('Token backup updated:', backupFile);
            } catch (backupError) {
                console.warn('Failed to create backup:', backupError.message);
            }
        }
        
        // Write new tokens
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
        console.log('Tokens saved successfully at:', new Date().toISOString());
        console.log('Token expires at:', new Date(tokens.expires_at).toISOString());
        
    } catch (error) {
        console.error('Error saving tokens:', error);
        throw error;
    }
}

    async getAccessToken() {
    const tokens = this.loadTokens();
    
    if (!tokens || !tokens.access_token) {
        throw new Error('No tokens available');
    }

    const now = Date.now();
    const expiresAt = tokens.expires_at || 0;
    const timeUntilExpiry = expiresAt - now;
    const hoursUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60 * 60));
    const minutesUntilExpiry = Math.floor((timeUntilExpiry % (1000 * 60 * 60)) / (1000 * 60));
    const needsRefresh = timeUntilExpiry < REFRESH_BUFFER;

    // Only log token check occasionally, not every time
    const shouldLog = Math.random() < 0.1; // Log only 10% of checks
    if (shouldLog) {
        console.log('🔍 Token Access Check:', {
            timeUntilExpiry: `${hoursUntilExpiry}h ${minutesUntilExpiry}m`,
            refreshBuffer: `${REFRESH_BUFFER / (1000 * 60 * 60)}h`,
            needsRefresh: needsRefresh,
            hasRefreshToken: !!tokens.refresh_token
        });
    }

    if (needsRefresh && tokens.refresh_token) {
        if (this.refreshing) {
            if (this.refreshPromise) {
                await this.refreshPromise;
                return this.loadTokens().access_token;
            }
        }

        try {
            console.log('🔄 Starting token refresh due to buffer check...');
            const newTokens = await this.refreshTokens();
            return newTokens.access_token;
        } catch (error) {
            console.error('Token refresh failed:', error);
            if (expiresAt > now) {
                console.warn('Using potentially expired token due to refresh failure');
                return tokens.access_token;
            }
            throw error;
        }
    }

    if (shouldLog) {
        console.log('✅ Token OK, no refresh needed');
    }
    return tokens.access_token;
}

    async refreshTokens() {
        if (this.refreshing) {
            return this.refreshPromise;
        }

        this.refreshing = true;
        this.refreshPromise = this._performRefresh();

        try {
            const result = await this.refreshPromise;
            return result;
        } finally {
            this.refreshing = false;
            this.refreshPromise = null;
        }
    }

    async _performRefresh() {
        const tokens = this.loadTokens();
        
        if (!tokens || !tokens.refresh_token) {
            throw new Error('No refresh token available');
        }

        console.log('Refreshing Trakt access token...');

        try {
            const requestBody = {
                refresh_token: tokens.refresh_token,
                client_id: process.env.TRAKT_CLIENT_ID,
                client_secret: process.env.TRAKT_CLIENT_SECRET,
                grant_type: 'refresh_token'
            };

            console.log('Making refresh request to Trakt API...');

            const response = await fetch('https://api.trakt.tv/oauth/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'trakt-api-version': '2',
                    'trakt-api-key': process.env.TRAKT_CLIENT_ID
                },
                body: JSON.stringify(requestBody)
            });

            console.log('Refresh response status:', response.status);

            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch (parseError) {
                    errorData = { error: 'Unknown error' };
                }
                throw new Error(`Token refresh failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
            }

            const data = await response.json();
            console.log('Token refresh successful');
            
            const newTokens = {
                access_token: data.access_token,
                refresh_token: data.refresh_token || tokens.refresh_token,
                expires_at: Date.now() + (data.expires_in * 1000),
                expires_in: data.expires_in,
                created_at: data.created_at || Date.now()
            };

            this.saveTokens(newTokens);
            console.log('Token refreshed successfully, expires in:', data.expires_in, 'seconds');
            
            return newTokens;
        } catch (error) {
            console.error('Token refresh error details:', error);
            throw error;
        }
    }

    startAutoRefresh() {
    // Prevent multiple auto-refresh instances
    if (autoRefreshStarted) {
        return;
    }
    
    autoRefreshStarted = true;
    
    const CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes
    
    console.log('🔄 Starting background token refresh scheduler...');
    console.log(`   • Checks every 30 minutes`);
    console.log(`   • Refreshes when <2 hours until expiry`);
    console.log(`   • Trakt tokens expire every 24 hours`);
    
    setInterval(async () => {
        try {
            const tokens = this.loadTokens();
            if (!tokens || !tokens.access_token) return;

            const now = Date.now();
            const expiresAt = tokens.expires_at || 0;
            const timeUntilExpiry = expiresAt - now;
            const needsRefresh = timeUntilExpiry < REFRESH_BUFFER;

            if (needsRefresh && tokens.refresh_token && !this.refreshing) {
                console.log('🔄 Background token refresh triggered');
                await this.refreshTokens();
            }
        } catch (error) {
            console.error('❌ Background token refresh failed:', error);
        }
    }, CHECK_INTERVAL);
}

// Also reduce logging in loadTokens
loadTokens() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            const data = fs.readFileSync(TOKEN_FILE, 'utf8');
            const tokens = JSON.parse(data);
            // Remove the "Tokens loaded successfully" log to reduce spam
            return tokens;
        }
    } catch (error) {
        console.error('Error loading tokens:', error);
    }
    return null;
}

}

const tokenManager = new TokenManager();

module.exports = {
    loadTokens: () => tokenManager.loadTokens(),
    saveTokens: (tokens) => tokenManager.saveTokens(tokens),
    getAccessToken: () => tokenManager.getAccessToken(),
    refreshTokens: () => tokenManager.refreshTokens(),
    startAutoRefresh: () => tokenManager.startAutoRefresh(),
    isTokenValid: () => tokenManager.isTokenValid()
};