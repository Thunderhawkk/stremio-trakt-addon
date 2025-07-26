require('dotenv').config();
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
const fetch = require('node-fetch');
const fs = require('fs');
const tokenManager = require('./tokenManager');
const { getRouter } = require('stremio-addon-sdk');

// Constants - ONLY ONE PORT NOW
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const CONFIG_DIR = path.join(DATA_DIR, 'config');
const LISTS_FILE = path.join(CONFIG_DIR, 'lists.json');

// Initialize token manager
tokenManager.startAutoRefresh();

console.log(`📁 Using LISTS_FILE: ${LISTS_FILE}`);

// Express middleware
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories exist
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  console.log(`📁 Created config directory: ${CONFIG_DIR}`);
}

if (!fs.existsSync(LISTS_FILE)) {
  fs.writeFileSync(LISTS_FILE, JSON.stringify({ lists: [] }, null, 2));
}

// ==========================================
// STREMIO ADDON INTEGRATION (FIXED APPROACH)
// ==========================================

// Function to get fresh addon interface
function getFreshAddonInterface() {
  // Clear cache to get latest configuration
  const addonPath = require.resolve('./addon');
  delete require.cache[addonPath];
  
  const addonModule = require('./addon');
  return addonModule.getAddonInterface();
}

// Mount Stremio addon routes using the SDK's getRouter
app.use('/', (req, res, next) => {
  try {
    // Get fresh addon for each request to pick up config changes
    const addonInterface = getFreshAddonInterface();
    const addonRouter = getRouter(addonInterface);
    
    // Only handle Stremio-specific routes
    if (req.path === '/manifest.json' || req.path.startsWith('/catalog/')) {
      console.log(`📋 Stremio request: ${req.method} ${req.path}`);
      addonRouter(req, res, next);
    } else {
      next();
    }
  } catch (error) {
    console.error('❌ Addon router error:', error);
    if (req.path === '/manifest.json' || req.path.startsWith('/catalog/')) {
      res.status(500).json({ error: 'Addon temporarily unavailable', details: error.message });
    } else {
      next();
    }
  }
});

// ==========================================
// YOUR EXISTING API ROUTES
// ==========================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/config', (req, res) => {
  try {
    if (!fs.existsSync(LISTS_FILE)) {
      console.log('📄 No config file found, returning empty');
      return res.json({ lists: [] });
    }
    
    const data = fs.readFileSync(LISTS_FILE, 'utf8');
    const config = JSON.parse(data);
    res.json(config);
  } catch (error) {
    console.error('❌ Error reading config:', error);
    res.status(500).json({ error: 'Failed to read configuration' });
  }
});

// SIMPLIFIED configuration saving
app.post('/api/config', async (req, res) => {
  try {
    const { lists } = req.body;
    console.log(`💾 Saving ${lists.length} lists to configuration`);
    
    // Ensure directory exists
    fs.mkdirSync(path.dirname(LISTS_FILE), { recursive: true });
    
    // Save the configuration
    const configData = { lists: lists || [] };
    fs.writeFileSync(LISTS_FILE, JSON.stringify(configData, null, 2));
    console.log(`✅ Saved configuration to ${LISTS_FILE}`);
    
    // Clear addon cache so next request picks up new config
    const addonPath = require.resolve('./addon');
    delete require.cache[addonPath];
    console.log('🔄 Cleared addon cache - changes effective immediately');
    
    res.json({ 
      success: true, 
      message: `Configuration saved with ${lists.length} lists. Changes effective immediately.`
    });
    
  } catch (error) {
    console.error('❌ Error saving configuration:', error);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

// Fixed addon info endpoint
app.get('/api/addon-info', (req, res) => {
  try {
    let enabledCount = 0;
    if (fs.existsSync(LISTS_FILE)) {
      const config = JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8'));
      enabledCount = config.lists.filter(list => list.enabled !== false).length;
    }
    
    res.json({
      status: 'online',
      catalogCount: enabledCount,
      addonName: 'Stremio Trakt Addon',
      version: '1.0.0',
      manifestUrl: `${req.protocol}://${req.get('host')}/manifest.json`
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Validate Trakt list URL
app.post('/api/validate-list', async (req, res) => {
  try {
    const { url } = req.body;
    
    const urlMatch = url.match(/trakt\.tv\/users\/([^\/]+)\/lists\/([^\/\?]+)/);
    if (!urlMatch) {
      return res.json({ valid: false, error: 'Invalid Trakt list URL format' });
    }
    
    const [, username, listSlug] = urlMatch;
    const listUrl = `https://api.trakt.tv/users/${username}/lists/${listSlug}`;
    
    const listResponse = await fetch(listUrl, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': process.env.TRAKT_CLIENT_ID
      }
    });
    
    if (!listResponse.ok) {
      return res.json({ valid: false, error: 'List not found or not accessible' });
    }
    
    const listData = await listResponse.json();
    
    res.json({
      valid: true,
      listName: listData.name,
      listDescription: listData.description,
      privacy: listData.privacy
    });
  } catch (error) {
    console.error('List validation error:', error);
    res.json({ valid: false, error: 'Failed to validate list' });
  }
});

// Preview list items
app.post('/api/preview-list', async (req, res) => {
  try {
    const { listUrl, limit = 8, type } = req.body;
    
    const urlMatch = listUrl.match(/trakt\.tv\/users\/([^\/]+)\/lists\/([^\/\?]+)/);
    if (!urlMatch) {
      return res.status(400).json({ error: 'Invalid Trakt list URL format' });
    }
    
    const [, username, listSlug] = urlMatch;
    const itemsUrl = `https://api.trakt.tv/users/${username}/lists/${listSlug}/items/movie,show?extended=full&limit=${limit}`;
    
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
    
    const items = await response.json();
    
    const previewItems = items.map((item) => {
      const content = item.movie || item.show;
      const itemType = item.movie ? 'movie' : 'series';
      
      if (type && itemType !== type) return null;
      
      return {
        id: content.ids.imdb || content.ids.trakt,
        type: itemType,
        name: content.title,
        year: content.year,
        poster: content.ids.imdb ? 
          `https://images.metahub.space/poster/medium/${content.ids.imdb}/img` : 
          `data:image/svg+xml;charset=UTF-8,%3Csvg width='300' height='450' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='300' height='450' fill='%23f3f4f6'/%3E%3Ctext x='150' y='225' text-anchor='middle' font-family='Arial' font-size='16' fill='%23374151'%3E${encodeURIComponent(content.title)}%3C/text%3E%3C/svg%3E`,
        imdbRating: content.rating || 0
      };
    }).filter(Boolean);
    
    res.json(previewItems.slice(0, limit));
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

// ==========================================
// ALL YOUR EXISTING AUTHENTICATION ROUTES
// ==========================================

app.post('/api/refresh-token', async (req, res) => {
  try {
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
    
    if (!response.ok) {
      throw new Error(`Trakt API error: ${response.status}`);
    }
    
    const data = await response.json();
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
    
    const data = await response.json();
    
    if (response.ok && data.access_token) {
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
    const tokens = tokenManager.loadTokens();
    if (!tokens || !tokens.access_token) {
      return res.json({ authenticated: false });
    }
    
    const now = Date.now();
    const expiresAt = tokens.expires_at || 0;
    const needsRefresh = (expiresAt - now) < (60 * 60 * 1000);
    
    let accessToken = tokens.access_token;
    
    if (needsRefresh && tokens.refresh_token) {
      try {
        const newTokens = await tokenManager.refreshTokens();
        accessToken = newTokens.access_token;
      } catch (refreshError) {
        console.error('Token refresh failed during auth check:', refreshError);
        return res.json({ authenticated: false });
      }
    }
    
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
      res.json({ authenticated: false });
    }
  } catch (error) {
    console.error('Auth check error:', error);
    res.json({ authenticated: false });
  }
});

app.post('/api/clear-tokens', (req, res) => {
  try {
    console.log('Token clear requested');
    const tokenFile = path.join(DATA_DIR, 'trakt_tokens.json');
    
    if (fs.existsSync(tokenFile)) {
      const backupFile = path.join(DATA_DIR, `trakt_tokens.backup.${Date.now()}.json`);
      fs.copyFileSync(tokenFile, backupFile);
      console.log('Token backup created:', backupFile);
      
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

// ==========================================
// START SINGLE SERVER
// ==========================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SINGLE SERVER running on port ${PORT}`);
  console.log(`🌐 Configuration UI: http://localhost:${PORT}/`);
  console.log(`📋 Stremio manifest: http://localhost:${PORT}/manifest.json`);
  console.log(`✅ Everything running on ONE port using Stremio SDK router!`);
  console.log(`🎯 Railway URL: https://profound-recreation-trakt.up.railway.app/`);
  console.log(`📱 Install URL: https://profound-recreation-trakt.up.railway.app/manifest.json`);
});