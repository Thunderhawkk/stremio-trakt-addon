// server.js
require('dotenv').config();
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
const { serveHTTP } = require('stremio-addon-sdk');
const tokenManager = require('./tokenManager')
const { fetch } = require('./utils/fetchHelper');
const DATA_DIR = process.env.DATA_DIR || './';
const CONFIG_DIR = path.join(DATA_DIR, 'config');
const LISTS_FILE = path.join(CONFIG_DIR, 'lists.json');
const addonInterface = require('./addon').getAddonInterface();
tokenManager.startAutoRefresh();
let tokenManagerInitialized = false;

const TOKENS_FILE = path.join(DATA_DIR, 'trakt_tokens.json');
const CACHE_FILE = path.join(DATA_DIR, 'poster_cache.json');
const PUBLIC_PORT = process.env.PORT || 3000;
const UI_PORT = process.env.PORT || 3000;
const ADDON_PORT = 7000;
app.listen(UI_PORT, '0.0.0.0', () => {
    console.log(`Express running on port ${UI_PORT}`);
});

app.use(express.json());
app.use(express.static('public'));

/* proxy addon manifest so it’s reachable via the public port */
app.get('/manifest.json', async (req, res, next) => {
  try {
    const r = await fetch(`http://127.0.0.1:${ADDON_PORT}/manifest.json`);
    const body = await r.text();
    res.type('application/json').send(body);
  } catch (e) {
    next(e);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () =>
  console.log(`🌐 Express UI on :${PORT}`)
);

const fs = require('fs');
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  console.log(`📁 Created config directory: ${CONFIG_DIR}`);
}

if (!fs.existsSync(LISTS_FILE)) {
  fs.writeFileSync(LISTS_FILE, JSON.stringify({ lists: [] }, null, 2));
}

console.log(`📂 Data directory: ${DATA_DIR}`);
console.log(`📋 Lists file: ${LISTS_FILE}`);
console.log(`🔑 Tokens file: ${TOKENS_FILE}`);

if (!tokenManagerInitialized) {
    tokenManager.startAutoRefresh();
    tokenManagerInitialized = true;
}

// Enhanced debugging - add this immediately after dotenv config
console.log('=== ENVIRONMENT DEBUG ===');
console.log('Current working directory:', process.cwd());
console.log('__dirname:', __dirname);
console.log('Looking for .env file at:', path.join(__dirname, '.env'));
console.log('File exists:', fs.existsSync(path.join(__dirname, '.env')));

if (fs.existsSync(path.join(__dirname, '.env'))) {
    const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    console.log('.env file content preview:');
    console.log(envContent.substring(0, 100) + '...');
}

console.log('CLIENT_ID loaded:', process.env.TRAKT_CLIENT_ID ? 'YES' : 'NO');
console.log('CLIENT_SECRET loaded:', process.env.TRAKT_CLIENT_SECRET ? 'YES' : 'NO');
console.log('CLIENT_ID value length:', process.env.TRAKT_CLIENT_ID?.length || 0);
console.log('=======================');

app.use(bodyParser.json());


const CONFIG_PATH = path.join(__dirname, 'config', 'lists.json');

// Ensure config directory and file exist
function ensureConfigExists() {
  const configDir = path.dirname(CONFIG_PATH);
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = {
      lists: [
        {
          id: 'trending-movies',
          name: 'Trending Movies',
          url: 'https://trakt.tv/movies/trending',
          type: 'movie',
          sortBy: 'rank',
          sortOrder: 'asc',
          enabled: true,
          order: 0
        }
      ]
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
  }
}

ensureConfigExists();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/config', (req, res) => {
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(content);
    res.json(config);
  } catch (error) {
    console.error('Error reading config:', error);
    const defaultConfig = { lists: [] };
    res.json(defaultConfig);
  }
});

// Fix the addon info endpoint to count only enabled lists
app.get('/api/addon-info', (req, res) => {
    try {
        const configPath = path.join(__dirname, 'config', 'lists.json');
        let enabledCount = 0;
        
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            enabledCount = config.lists.filter(list => list.enabled === true).length;
        }
        
        res.json({
            status: 'online',
            catalogCount: enabledCount, // Only count enabled lists
            addonName: 'Stremio Trakt Addon',
            version: '1.0.0',
            manifestUrl: `${req.protocol}://${req.get('host').replace('3000', '7000')}/manifest.json`
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// Validate Trakt list URL and get info
app.post('/api/validate-list', async (req, res) => {
    try {
        const { url } = req.body;
        
        // Extract username and list name from URL
        const urlMatch = url.match(/trakt\.tv\/users\/([^\/]+)\/lists\/([^\/\?]+)/);
        if (!urlMatch) {
            return res.json({ 
                valid: false, 
                error: 'Invalid Trakt list URL format' 
            });
        }
        
        const [, username, listSlug] = urlMatch;
        const listUrl = `https://api.trakt.tv/users/${username}/lists/${listSlug}`;
        const itemsUrl = `https://api.trakt.tv/users/${username}/lists/${listSlug}/items`;
        
        // Get list info
        const listResponse = await fetch(listUrl, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': process.env.TRAKT_CLIENT_ID
            }
        });
        
        if (!listResponse.ok) {
            return res.json({ 
                valid: false, 
                error: 'List not found or not accessible' 
            });
        }
        
        const listData = await listResponse.json();
        
        // Get item count
        const itemsResponse = await fetch(`${itemsUrl}?limit=1`, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': process.env.TRAKT_CLIENT_ID
            }
        });
        
        let itemCount = 0;
        if (itemsResponse.ok) {
            const paginationHeader = itemsResponse.headers.get('x-pagination-item-count');
            itemCount = paginationHeader ? parseInt(paginationHeader) : '?';
        }
        
        res.json({
            valid: true,
            listName: listData.name,
            listDescription: listData.description,
            itemCount: itemCount,
            privacy: listData.privacy
        });
        
    } catch (error) {
        console.error('List validation error:', error);
        res.json({ 
            valid: false, 
            error: 'Failed to validate list' 
        });
    }
});

// Preview list items for UI
app.post('/api/preview-list', async (req, res) => {
    try {
        const { listUrl, limit = 8, type, sortBy, sortOrder } = req.body;
        
        // Extract username and list name from URL
        const urlMatch = listUrl.match(/trakt\.tv\/users\/([^\/]+)\/lists\/([^\/\?]+)/);
        if (!urlMatch) {
            return res.status(400).json({ error: 'Invalid Trakt list URL format' });
        }
        
        const [, username, listSlug] = urlMatch;
        const itemsUrl = `https://api.trakt.tv/users/${username}/lists/${listSlug}/items/movie,show?extended=full&limit=${limit}`;
        
        const tokenManager = require('./tokenManager');
        let accessToken;
        try {
            accessToken = await tokenManager.getAccessToken();
        } catch (tokenError) {
            console.error('Failed to get access token for preview:', tokenError);
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const response = await fetch(itemsUrl, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': process.env.TRAKT_CLIENT_ID,
                'Authorization': `Bearer ${accessToken}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Trakt API error: ${response.status}`);
        }

        setInterval(async () => {
        try {
            const tokens = this.loadTokens();
            if (!tokens || !tokens.access_token) return;

            const now = Date.now();
            const expiresAt = tokens.expires_at || 0;
            const needsRefresh = (expiresAt - now) < REFRESH_BUFFER; // 1 hour buffer

            if (needsRefresh && tokens.refresh_token && !this.refreshing) {
                console.log('Background token refresh triggered');
                await this.refreshTokens();
            }
        } catch (error) {
            console.error('Background token refresh failed:', error);
        }
    }, 60 * 60 * 1000); // Check every 1 hour

      console.log('🔄 Automatic token refresh enabled');
      console.log('   • Checks every 30 minutes');
      console.log('   • Refreshes when <2 hour until expiry');
      console.log('   • Trakt tokens expire every 24 hours');
      
        const items = await response.json();
        
        // Helper function to get poster URL with TMDB integration
        const getPosterUrl = async (content, itemType) => {
    // Trakt doesn't provide poster URLs, need to use TMDB
    if (content.ids && content.ids.tmdb) {
        const tmdbType = itemType === 'movie' ? 'movie' : 'tv';
        
        // You'll need a TMDB API key for this to work
        if (process.env.TMDB_API_KEY) {
            try {
                const tmdbResponse = await fetch(
                    `https://api.themoviedb.org/3/${tmdbType}/${content.ids.tmdb}?api_key=${process.env.TMDB_API_KEY}`
                );
                
                if (tmdbResponse.ok) {
                    const tmdbData = await tmdbResponse.json();
                    if (tmdbData.poster_path) {
                        return `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`;
                    }
                }
            } catch (error) {
                console.error('TMDB fetch error:', error);
            }
        }
    }
    
    // Fallback: Generate a clean placeholder with movie/show info
    const title = encodeURIComponent(content.title || 'Unknown');
    const year = content.year || '';
    return `data:image/svg+xml;charset=UTF-8,%3Csvg width='300' height='450' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='300' height='450' fill='%23f3f4f6'/%3E%3Ctext x='150' y='200' text-anchor='middle' font-family='Arial' font-size='16' fill='%23374151'%3E${title}%3C/text%3E%3Ctext x='150' y='230' text-anchor='middle' font-family='Arial' font-size='14' fill='%236b7280'%3E${year}%3C/text%3E%3Ctext x='150' y='280' text-anchor='middle' font-family='Arial' font-size='12' fill='%239ca3af'%3ENo Poster Available%3C/text%3E%3C/svg%3E`;
};
        
        // Transform to preview format
        const previewItems = await Promise.all(items.map(async (item) => {
            const content = item.movie || item.show;
            const itemType = item.movie ? 'movie' : 'series';
            
            // Filter by type if specified
            if (type && itemType !== type) return null;
            
            return {
                id: content.ids.imdb || content.ids.trakt,
                type: itemType,
                name: content.title,
                year: content.year,
                poster: await getPosterUrl(content, itemType),
                imdbRating: content.rating
            };
        }));
        
        const filteredItems = previewItems.filter(Boolean);
        
        // Apply sorting
        if (sortBy && sortBy !== 'rank') {
            filteredItems.sort((a, b) => {
                let aVal = a[sortBy];
                let bVal = b[sortBy];
                
                if (typeof aVal === 'string') {
                    aVal = aVal.toLowerCase();
                    bVal = bVal.toLowerCase();
                }
                
                if (sortOrder === 'desc') {
                    return bVal > aVal ? 1 : -1;
                } else {
                    return aVal > bVal ? 1 : -1;
                }
            });
        }
        
        res.json(filteredItems.slice(0, limit));
        
    } catch (error) {
        console.error('Preview error:', error);
        res.status(500).json({ error: 'Failed to generate preview' });
    }
});

app.post('/api/config', (req, res) => {
    try {
        const config = req.body;
        const configPath = path.join(__dirname, 'config', 'lists.json');
        
        // Ensure config directory exists
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        // Save configuration
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        
        // FORCE complete cache clearing
        const addonPath = require.resolve('./addon');
        delete require.cache[addonPath];
        
        // Clear poster cache too
        const posterCachePath = path.join(__dirname, 'poster_cache.json');
        if (fs.existsSync(posterCachePath)) {
            // Don't delete cache, just force rebuild
        }
        
        console.log('💾 Configuration saved and addon cache cleared');
        
        res.json({ 
            success: true, 
            message: 'Configuration saved successfully',
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Config save error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/validate-list', async (req, res) => {
  const { url } = req.body;
  try {
    const urlPattern = /trakt\.tv\/(users\/[^\/]+\/lists\/[^\/]+|movies\/[^\/]+|shows\/[^\/]+)/;
    const match = url.match(urlPattern);
    
    if (!match) {
      return res.json({ valid: false, error: 'Invalid Trakt URL format' });
    }

    res.json({ valid: true, type: url.includes('/movies/') ? 'movie' : 'series' });
  } catch (error) {
    res.json({ valid: false, error: error.message });
  }
});

// Manual token refresh endpoint
app.post('/api/refresh-token', async (req, res) => {
    try {
        const tokenManager = require('./tokenManager');
        const tokens = tokenManager.loadTokens();
        
        if (!tokens || !tokens.refresh_token) {
            return res.status(401).json({ 
                success: false, 
                error: 'No refresh token available. Please re-authenticate with Trakt.' 
            });
        }
        
        console.log('Manual token refresh requested');
        const newTokens = await tokenManager.refreshTokens();
        
        res.json({ 
            success: true, 
            expiresAt: newTokens.expires_at,
            message: 'Token refreshed successfully'
        });
    } catch (error) {
        console.error('Manual token refresh failed:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Token refresh failed' 
        });
    }
});

app.get('/api/token-status', (req, res) => {
    try {
        console.log('Token status check requested');
        
        const tokenManager = require('./tokenManager');
        let tokens;
        
        try {
            tokens = tokenManager.loadTokens();
            console.log('Tokens loaded:', tokens ? 'Found' : 'Not found');
        } catch (loadError) {
            console.error('Error loading tokens:', loadError);
            return res.json({ 
                hasToken: false, 
                error: 'Failed to load token file',
                message: 'Token file may be corrupted or missing' 
            });
        }
        
        if (!tokens || !tokens.access_token) {
            console.log('No tokens or access token found');
            return res.json({ 
                hasToken: false, 
                message: 'No authentication tokens found' 
            });
        }
        
        const now = Date.now();
        const expiresAt = tokens.expires_at || 0;
        const isExpired = expiresAt < now;
        const hoursUntilExpiry = Math.max(0, Math.floor((expiresAt - now) / (1000 * 60 * 60)));
        const minutesUntilExpiry = Math.max(0, Math.floor((expiresAt - now) / (1000 * 60)));
        
        console.log('Token status:', {
            isExpired,
            hoursUntilExpiry,
            hasRefreshToken: !!tokens.refresh_token
        });
        
        res.json({
            hasToken: true,
            hasRefreshToken: !!tokens.refresh_token,
            isExpired: isExpired,
            expiresAt: new Date(expiresAt).toISOString(),
            hoursUntilExpiry: hoursUntilExpiry,
            minutesUntilExpiry: minutesUntilExpiry,
            canRefresh: !!tokens.refresh_token,
            tokenPreview: tokens.access_token ? tokens.access_token.substring(0, 20) + '...' : null
        });
    } catch (error) {
        console.error('Token status check failed:', error);
        res.status(500).json({ 
            error: 'Failed to check token status',
            details: error.message,
            hasToken: false
        });
    }
});

// Enhanced debug endpoint
app.get('/debug-env', (req, res) => {
  res.json({
    workingDirectory: process.cwd(),
    dirname: __dirname,
    envFilePath: path.join(__dirname, '.env'),
    envFileExists: fs.existsSync(path.join(__dirname, '.env')),
    clientId: process.env.TRAKT_CLIENT_ID ? 'Present' : 'Missing',
    clientSecret: process.env.TRAKT_CLIENT_SECRET ? 'Present' : 'Missing',
    clientIdLength: process.env.TRAKT_CLIENT_ID?.length || 0,
    allEnvVars: Object.keys(process.env).filter(key => key.startsWith('TRAKT_'))
  });
});

// Trakt OAuth endpoints
app.post('/auth', async (req, res) => {
    try {
        console.log('Initializing Trakt authentication...');
        
        const response = await fetch('https://api.trakt.tv/oauth/device/code', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': process.env.TRAKT_CLIENT_ID
            },
            body: JSON.stringify({
                client_id: process.env.TRAKT_CLIENT_ID
            })
        });

        console.log('Auth init response status:', response.status);

        if (!response.ok) {
            throw new Error(`Trakt API error: ${response.status}`);
        }

        const data = await response.json();
        console.log('Auth init successful');
        
        res.json({
            device_code: data.device_code,
            user_code: data.user_code,
            verification_url: data.verification_url,
            expires_in: data.expires_in,
            interval: data.interval
        });
    } catch (error) {
        console.error('Trakt auth initialization error:', error);
        res.status(500).json({ 
            error: 'Failed to initialize Trakt authentication',
            details: error.message 
        });
    }
});

// Update /poll endpoint
app.post('/poll', async (req, res) => {
    try {
        const { device_code } = req.body;
        console.log('Polling for authentication...');
        
        const response = await fetch('https://api.trakt.tv/oauth/device/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': process.env.TRAKT_CLIENT_ID
            },
            body: JSON.stringify({
                code: device_code,
                client_id: process.env.TRAKT_CLIENT_ID,
                client_secret: process.env.TRAKT_CLIENT_SECRET
            })
        });

        console.log('Poll response status:', response.status);
        const data = await response.json();

        if (response.ok && data.access_token) {
            console.log('Authentication successful');
            const tokenManager = require('./tokenManager');
            await tokenManager.saveTokens({
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_at: Date.now() + (data.expires_in * 1000),
                expires_in: data.expires_in,
                created_at: data.created_at
            });

            res.json({ success: true });
        } else if (data.error === 'authorization_pending') {
            res.json({ success: false, pending: true });
        } else {
            res.json({ success: false, error: data.error });
        }
    } catch (error) {
        console.error('Trakt auth polling error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Polling failed',
            details: error.message 
        });
    }
});

app.get('/api/check-auth', async (req, res) => {
    try {
        const tokenManager = require('./tokenManager');
        const tokens = tokenManager.loadTokens();
        
        if (!tokens || !tokens.access_token) {
            return res.json({ authenticated: false });
        }

        // Check if token needs refresh (within 1 hour of expiry)
        const now = Date.now();
        const expiresAt = tokens.expires_at || 0;
        const needsRefresh = (expiresAt - now) < (60 * 60 * 1000); // 1 hour buffer

        let accessToken = tokens.access_token;

        // Refresh token if needed
        if (needsRefresh && tokens.refresh_token) {
            try {
                const newTokens = await tokenManager.refreshTokens();
                accessToken = newTokens.access_token;
            } catch (refreshError) {
                console.error('Token refresh failed during auth check:', refreshError);
                return res.json({ authenticated: false });
            }
        }

        // Verify token is still valid by getting user info
        const userResponse = await fetch('https://api.trakt.tv/users/me', {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': process.env.TRAKT_CLIENT_ID,
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (userResponse.ok) {
            const userData = await userResponse.json();
            res.json({ 
                authenticated: true, 
                user: userData.username || userData.name || 'User',
                tokenExpiresAt: tokens.expires_at
            });
        } else {
            console.error('User info fetch failed:', userResponse.status);
            res.json({ authenticated: false });
        }
    } catch (error) {
        console.error('Auth check error:', error);
        res.json({ authenticated: false });
    }
});

app.get('/auth', async (req, res) => {
  if (!process.env.TRAKT_CLIENT_ID || !process.env.TRAKT_CLIENT_SECRET) {
    return res.send(`<h1>❌ Configuration Error</h1><p>Environment variables not loaded.</p>`);
  }

  try {
    const body = {
      client_id: process.env.TRAKT_CLIENT_ID,
      client_secret: process.env.TRAKT_CLIENT_SECRET
    };
    
    const authRes = await fetch('https://api.trakt.tv/oauth/device/code', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'Stremio-Trakt-Addon/1.0.0'
      },
      body: JSON.stringify(body)
    });
    
    if (!authRes.ok) {
      throw new Error(`Device code request failed: ${authRes.status}`);
    }
    
    const data = await authRes.json();
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Trakt Authentication</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .step { background: #f8f9fa; padding: 20px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #2196F3; }
          .code { font-size: 28px; font-weight: bold; color: #2196F3; padding: 20px; background: #e3f2fd; border-radius: 8px; text-align: center; margin: 15px 0; letter-spacing: 2px; }
          .status { margin: 20px 0; padding: 15px; border-radius: 8px; font-weight: 500; }
          .waiting { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }
          .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
          .error { background: #f8d7da; color: #721c24; border: 1px solid #f1aeb5; }
          .btn { display: inline-block; padding: 12px 24px; background: #2196F3; color: white; text-decoration: none; border-radius: 6px; margin: 10px 5px; font-weight: 500; }
          .btn-success { background: #28a745; }
          .btn-secondary { background: #6c757d; }
          .countdown { font-size: 18px; color: #666; }
        </style>
      </head>
      <body>
        <h1>🎬 Trakt Device Authentication</h1>
        
        <div class="step">
          <h3>Step 1: Open Trakt Authorization</h3>
          <p>Click this button to open the Trakt authorization page:</p>
          <a href="${data.verification_url}" target="_blank" class="btn">📱 Open Trakt Authorization</a>
        </div>

        <div class="step">
          <h3>Step 2: Enter This Code</h3>
          <p>Copy and paste this code on the Trakt page:</p>
          <div class="code">${data.user_code}</div>
        </div>

        <div class="step">
          <h3>Step 3: Click When Done</h3>
          <p>After entering the code and authorizing on Trakt, click this button:</p>
          <button onclick="startPolling()" class="btn btn-success">✅ I've Authorized on Trakt</button>
        </div>
        
        <div id="status" class="status waiting" style="display: none;">
          ⏳ Checking authorization status...
        </div>

        <div id="countdown" class="countdown" style="display: none;"></div>
        
        <script>
          let pollCount = 0;
          let maxPolls = 30; // 5 minutes with 10-second intervals
          let pollInterval = 10; // 10 seconds between polls
          let isPolling = false;
          
          function updateStatus(message, type = 'waiting') {
            const statusEl = document.getElementById('status');
            statusEl.style.display = 'block';
            statusEl.className = 'status ' + type;
            statusEl.innerHTML = message;
          }
          
          function startPolling() {
            if (isPolling) return;
            isPolling = true;
            
            updateStatus('🔍 Checking if authorization was successful...', 'waiting');
            poll();
          }
          
          function poll() {
            if (pollCount++ > maxPolls) {
              updateStatus('⏰ Timeout reached. The authorization might have worked - check your <a href="http://localhost:3000">configuration page</a> to continue.', 'error');
              return;
            }
            
            // Show countdown
            const countdownEl = document.getElementById('countdown');
            countdownEl.style.display = 'block';
            let timeLeft = pollInterval;
            const countdownInterval = setInterval(() => {
              countdownEl.textContent = 'Next check in ' + timeLeft + ' seconds... (Attempt ' + pollCount + '/' + maxPolls + ')';
              timeLeft--;
              if (timeLeft < 0) {
                clearInterval(countdownInterval);
                countdownEl.style.display = 'none';
              }
            }, 1000);
            
            fetch('/poll?device_code=${data.device_code}', {
              method: 'GET',
              headers: { 'Accept': 'application/json' }
            })
            .then(response => response.json())
            .then(data => {
              console.log('Poll response:', data);
              
              if (data.success && data.access_token) {
                clearInterval(countdownInterval);
                countdownEl.style.display = 'none';
                updateStatus('✅ Authentication successful! <a href="/" class="btn">Go to Configuration</a>', 'success');
              } else if (data.error && !data.error.includes('authorization_pending')) {
                clearInterval(countdownInterval);
                countdownEl.style.display = 'none';
                updateStatus('❌ Error: ' + data.error, 'error');
              } else {
                // Continue polling
                setTimeout(poll, pollInterval * 1000);
              }
            })
            .catch(error => {
              console.error('Poll error:', error);
              clearInterval(countdownInterval);
              countdownEl.style.display = 'none';
              updateStatus('❌ Connection error. Check if authorization worked: <a href="/" class="btn btn-secondary">Check Configuration</a>', 'error');
            });
          }
          
          // Auto-detect successful authentication by checking for token file
          function checkExistingAuth() {
            fetch('/api/check-auth')
              .then(response => response.json())
              .then(data => {
                if (data.authenticated) {
                  updateStatus('✅ Already authenticated! <a href="/" class="btn">Go to Configuration</a>', 'success');
                }
              })
              .catch(() => {
                // Ignore errors - user just needs to authenticate normally
              });
          }
          
          // Check if already authenticated on page load
          checkExistingAuth();
        </script>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Auth setup error:', error);
    res.send(`<h1>❌ Setup Error</h1><p>${error.message}</p>`);
  }
});


app.get('/poll', async (req, res) => {
  const { device_code } = req.query;
  
  res.setHeader('Content-Type', 'application/json');
  
  try {
    // Check if we already have tokens (user completed auth)
    if (fs.existsSync('trakt_tokens.json')) {
      const existingTokens = JSON.parse(fs.readFileSync('trakt_tokens.json', 'utf8'));
      if (existingTokens.access_token) {
        return res.json({ success: true, access_token: existingTokens.access_token });
      }
    }

    const body = {
      client_id: process.env.TRAKT_CLIENT_ID,
      client_secret: process.env.TRAKT_CLIENT_SECRET,
      code: device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    };
    
    const tokenRes = await fetch('https://api.trakt.tv/oauth/device/token', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'Stremio-Trakt-Addon/1.0.0'
      },
      body: JSON.stringify(body)
    });
    
    if (!tokenRes.ok) {
      console.log(`Trakt API returned ${tokenRes.status}`);
      return res.json({ error: `Trakt API returned ${tokenRes.status}` });
    }

    const tokens = await tokenRes.json();
    
    if (tokens.access_token) {
      tokens.expires_at = Date.now() + tokens.expires_in * 1000;
      fs.writeFileSync('trakt_tokens.json', JSON.stringify(tokens, null, 2));
      console.log('✅ Authentication completed successfully!');
      return res.json({ success: true, access_token: tokens.access_token });
    }
    
    if (tokens.error === 'authorization_pending') {
      return res.json({ pending: true });
    }
    
    if (tokens.error) {
      return res.json({ error: tokens.error });
    }
    
    return res.json({ pending: true });
    
  } catch (error) {
    console.error('Polling error:', error.message);
    return res.json({ error: error.message });
  }
});

app.get('/api/check-auth', (req, res) => {
  try {
    if (fs.existsSync('trakt_tokens.json')) {
      const tokens = JSON.parse(fs.readFileSync('trakt_tokens.json', 'utf8'));
      if (tokens.access_token) {
        return res.json({ authenticated: true });
      }
    }
    res.json({ authenticated: false });
  } catch (error) {
    res.json({ authenticated: false });
  }
});

app.post('/api/refresh-addon', (req, res) => {
  try {
    console.log('🔄 Refreshing addon configuration...');
    
    // Clear the require cache for addon.js to force reload
    delete require.cache[require.resolve('./addon')];
    
    // Re-require the addon to get fresh configuration
    const freshAddon = require('./addon');
    
    console.log('✅ Addon configuration refreshed');
    res.json({ success: true, message: 'Addon configuration refreshed' });
  } catch (error) {
    console.error('❌ Failed to refresh addon:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual token refresh endpoint
app.post('/api/refresh-token', async (req, res) => {
    try {
        console.log('Manual token refresh requested');
        
        const tokenManager = require('./tokenManager');
        const currentTokens = tokenManager.loadTokens();
        
        if (!currentTokens || !currentTokens.refresh_token) {
            return res.status(401).json({ 
                success: false, 
                error: 'No refresh token available. Please re-authenticate with Trakt.' 
            });
        }
        
        console.log('Current token expires at:', new Date(currentTokens.expires_at || 0).toISOString());
        
        const newTokens = await tokenManager.refreshTokens();
        console.log('Token refreshed successfully. New expiry:', new Date(newTokens.expires_at).toISOString());
        
        res.json({ 
            success: true, 
            expiresAt: newTokens.expires_at,
            hoursValid: Math.floor((newTokens.expires_at - Date.now()) / (1000 * 60 * 60)),
            message: 'Token refreshed successfully'
        });
    } catch (error) {
        console.error('Manual token refresh failed:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Token refresh failed',
            needsReauth: error.message && error.message.includes('invalid_grant')
        });
    }
});

// Clear tokens endpoint
app.post('/api/clear-tokens', (req, res) => {
    try {
        console.log('Token clear requested');
        
        const fs = require('fs');
        const path = require('path');
        const tokenFile = path.join(__dirname, 'trakt_tokens.json');
        
        if (fs.existsSync(tokenFile)) {
            // Backup before clearing
            const backupFile = path.join(__dirname, `trakt_tokens.backup.${Date.now()}.json`);
            fs.copyFileSync(tokenFile, backupFile);
            console.log('Token backup created:', backupFile);
            
            // Clear the file
            fs.unlinkSync(tokenFile);
            console.log('Token file cleared');
        }
        
        res.json({ 
            success: true, 
            message: 'Tokens cleared successfully' 
        });
    } catch (error) {
        console.error('Clear tokens failed:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to clear tokens' 
        });
    }
});

// Debug endpoint for troubleshooting

// Force save new tokens endpoint (for troubleshooting)
app.post('/api/save-token', (req, res) => {
    try {
        const { access_token, refresh_token, expires_in } = req.body;
        
        if (!access_token) {
            return res.status(400).json({ 
                success: false, 
                error: 'Access token is required' 
            });
        }
        
        const tokenManager = require('./tokenManager');
        const tokenData = {
            access_token,
            refresh_token: refresh_token || null,
            expires_at: Date.now() + ((expires_in || 86400) * 1000), // Default 24h
            expires_in: expires_in || 86400,
            created_at: Date.now()
        };
        
        tokenManager.saveTokens(tokenData);
        console.log('Tokens manually saved');
        
        res.json({ 
            success: true, 
            message: 'Tokens saved successfully',
            expiresAt: tokenData.expires_at 
        });
    } catch (error) {
        console.error('Save token failed:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to save token' 
        });
    }
});

app.listen(3000, () => {
  console.log('🌐 Configuration UI available at http://localhost:3000');
  console.log('🔑 First-time setup: visit http://localhost:3000/auth');
});

setTimeout(() => {
    try {
        console.log('🎬 Starting Stremio addon server...');
        
        // Clear the require cache to ensure fresh addon loading
        delete require.cache[require.resolve('./addon')];
        
        // Require the addon module and get the interface
        const addonModule = require('./addon');
        // Validate that we have a proper interface
        if (!addonInterface) {
            throw new Error('getAddonInterface returned null or undefined');
        }
        
        console.log('✅ Addon interface loaded successfully');

        // Start the Stremio addon server
        serveHTTP(addonInterface, { port: ADDON_PORT, hostname: '0.0.0.0' });
        
        console.log('🎬 Stremio add-on running at http://localhost:7000/manifest.json');
        console.log('HTTP addon accessible at: http://127.0.0.1:7000/manifest.json');

        console.log('Rebuilding addon interface due to config changes...');
        global.addonInterface = addonModule.getAddonInterface();
        console.log('✅ Addon interface rebuilt successfully');
        
    } catch (error) {
        console.error('❌ Failed to start Stremio addon:', error);
        console.error('Stack trace:', error.stack);
        console.error('Failed to rebuild addon interface:', error)
    }
}, 2000); // Increased delay to 2 seconds