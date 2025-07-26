require('dotenv').config();
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
const fetch = require('node-fetch');
const fs = require('fs');
const tokenManager = require('./tokenManager');

// Constants - ONLY ONE PORT NOW
const PORT = process.env.PORT || 3000; // Single port for everything
const DATA_DIR = process.env.DATA_DIR || '/data';
const CONFIG_DIR = path.join(DATA_DIR, 'config');
const LISTS_FILE = path.join(CONFIG_DIR, 'lists.json');
const TOKENS_FILE = path.join(DATA_DIR, 'trakt_tokens.json');
const CACHE_FILE = path.join(DATA_DIR, 'poster_cache.json');

// Initialize token manager
tokenManager.startAutoRefresh();
let tokenManagerInitialized = false;

console.log(`📁 Using LISTS_FILE: ${LISTS_FILE}`);

// Express middleware
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Environment debug
console.log('🔍 Environment Variables:');
console.log(`DATA_DIR from env: "${process.env.DATA_DIR}"`);
console.log(`TRAKT_CLIENT_ID exists: ${!!process.env.TRAKT_CLIENT_ID}`);

// Volume check
console.log('🔍 Volume Mount Check:');
try {
  const volumePath = '/data';
  if (fs.existsSync(volumePath)) {
    console.log('✅ /data volume exists');
    const stats = fs.statSync(volumePath);
    console.log(`📊 /data is ${stats.isDirectory() ? 'directory' : 'file'}`);
    
    const testPath = path.join(volumePath, 'railway-volume-test.txt');
    fs.writeFileSync(testPath, `Railway volume test: ${new Date()}`);
    console.log('✅ Successfully wrote to /data volume');
  } else {
    console.log('❌ /data volume NOT found');
  }
} catch (error) {
  console.error('❌ Volume check failed:', error.message);
}

// Ensure directories exist
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  console.log(`📁 Created config directory: ${CONFIG_DIR}`);
}

if (!fs.existsSync(LISTS_FILE)) {
  fs.writeFileSync(LISTS_FILE, JSON.stringify({ lists: [] }, null, 2));
}

// ==========================================
// STREMIO ADDON ROUTES (INTEGRATED INTO EXPRESS)
// ==========================================

// Serve manifest directly through Express - NO MORE PROXY!
app.get('/manifest.json', async (req, res) => {
  try {
    console.log('📋 Direct manifest request');
    
    // Get addon interface directly
    delete require.cache[require.resolve('./addon')]; // Fresh load
    const addonModule = require('./addon');
    const addonInterface = addonModule.getAddonInterface();
    const manifest = addonInterface.manifest;
    
    res.set({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    
    res.json(manifest);
    console.log(`✅ Manifest served directly (${manifest.catalogs?.length || 0} catalogs)`);
    
  } catch (error) {
    console.error('❌ Manifest error:', error);
    res.status(500).json({ error: 'Manifest unavailable', details: error.message });
  }
});

// Handle catalog requests directly through Express
app.get('/catalog/:type/:id/:extra?', async (req, res) => {
  try {
    console.log(`📚 Catalog request: ${req.params.type}/${req.params.id}`);
    
    // Get fresh addon interface
    delete require.cache[require.resolve('./addon')];
    const addonModule = require('./addon');
    const addonInterface = addonModule.getAddonInterface();
    
    // Parse extra parameters
    const extra = {};
    if (req.params.extra) {
      const pairs = req.params.extra.split('&');
      pairs.forEach(pair => {
        const [key, value] = pair.split('=');
        if (key && value) {
          extra[decodeURIComponent(key)] = decodeURIComponent(value);
        }
      });
    }
    
    // Call catalog handler
    const args = {
      type: req.params.type,
      id: req.params.id,
      extra: extra
    };
    
    const result = await addonInterface.catalogHandler(args);
    
    res.set({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300' // 5 minute cache
    });
    
    res.json(result);
    console.log(`✅ Catalog served: ${result.metas?.length || 0} items`);
    
  } catch (error) {
    console.error('❌ Catalog error:', error);
    res.status(500).json({ error: 'Catalog unavailable', details: error.message });
  }
});

// CORS options for Stremio routes
app.options(['/manifest.json', '/catalog/*'], (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

// ==========================================
// EXISTING API ROUTES (SIMPLIFIED)
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

// SIMPLIFIED configuration saving - no server restart needed!
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
    
    // Simple cache clearing - addon routes will get fresh data automatically
    const addonPath = require.resolve('./addon');
    const tokenManagerPath = require.resolve('./tokenManager');
    
    delete require.cache[addonPath];
    delete require.cache[tokenManagerPath];
    
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

// Fix addon info endpoint
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
      manifestUrl: `${req.protocol}://${req.get('host')}/manifest.json` // Same domain, same port!
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
    const itemsUrl = `https://api.trakt.tv/users/${username}/lists/${listSlug}/items`;
    
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
    res.json({ valid: false, error: 'Failed to validate list' });
  }
});

// Preview list items
app.post('/api/preview-list', async (req, res) => {
  try {
    const { listUrl, limit = 8, type, sortBy, sortOrder } = req.body;
    
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
    
    // Helper function for poster URLs
    const getPosterUrl = async (content, itemType) => {
      if (content.ids && content.ids.tmdb && process.env.TMDB_API_KEY) {
        try {
          const tmdbType = itemType === 'movie' ? 'movie' : 'tv';
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
      
      const title = encodeURIComponent(content.title || 'Unknown');
      const year = content.year || '';
      return `data:image/svg+xml;charset=UTF-8,%3Csvg width='300' height='450' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='300' height='450' fill='%23f3f4f6'/%3E%3Ctext x='150' y='200' text-anchor='middle' font-family='Arial' font-size='16' fill='%23374151'%3E${title}%3C/text%3E%3Ctext x='150' y='230' text-anchor='middle' font-family='Arial' font-size='14' fill='%236b7280'%3E${year}%3C/text%3E%3Ctext x='150' y='280' text-anchor='middle' font-family='Arial' font-size='12' fill='%239ca3af'%3ENo Poster Available%3C/text%3E%3C/svg%3E`;
    };
    
    const previewItems = await Promise.all(items.map(async (item) => {
      const content = item.movie || item.show;
      const itemType = item.movie ? 'movie' : 'series';
      
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
      console.error('User info fetch failed:', userResponse.status);
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
    const tokenFile = path.join(__dirname, 'trakt_tokens.json');
    
    if (fs.existsSync(tokenFile)) {
      const backupFile = path.join(__dirname, `trakt_tokens.backup.${Date.now()}.json`);
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
// START SINGLE SERVER - NO MORE DUAL PORTS!
// ==========================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SINGLE SERVER running on port ${PORT}`);
  console.log(`🌐 Configuration UI: http://localhost:${PORT}/`);
  console.log(`📋 Stremio manifest: http://localhost:${PORT}/manifest.json`);
  console.log(`✅ Everything running on ONE port - no proxy needed!`);
  console.log(`🎯 Railway URL: https://profound-recreation-trakt.up.railway.app/`);
  console.log(`📱 Install URL: https://profound-recreation-trakt.up.railway.app/manifest.json`);
});