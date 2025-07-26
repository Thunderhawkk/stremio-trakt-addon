// ==========================================
// IMPORTS AND DEPENDENCIES
// ==========================================

const { addonBuilder } = require('stremio-addon-sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './file.env' });

// Import fetch helper
const { fetch } = require('./utils/fetchHelper');

// ==========================================
// GLOBAL VARIABLES
// ==========================================

let posterCache = {};
const POSTER_CACHE_FILE = path.join(__dirname, 'poster_cache.json');
const DATA_DIR = process.env.DATA_DIR || './data';
const LISTS_FILE = path.join(DATA_DIR, 'config', 'lists.json');

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function loadPosterCache() {
  try {
    if (fs.existsSync(POSTER_CACHE_FILE)) {
      const data = fs.readFileSync(POSTER_CACHE_FILE, 'utf8');
      posterCache = JSON.parse(data);
      console.log(`📦 Loaded ${Object.keys(posterCache).length} cached posters`);
    }
  } catch (error) {
    console.error('❌ Error loading poster cache:', error);
    posterCache = {};
  }
}

function savePosterCache() {
  try {
    fs.writeFileSync(POSTER_CACHE_FILE, JSON.stringify(posterCache, null, 2));
  } catch (error) {
    console.error('❌ Error saving poster cache:', error);
  }
}

function loadConfig() {
  try {
    if (!fs.existsSync(LISTS_FILE)) {
      console.log('📄 No lists.json found, creating empty config');
      const emptyConfig = { lists: [] };
      fs.mkdirSync(path.dirname(LISTS_FILE), { recursive: true });
      fs.writeFileSync(LISTS_FILE, JSON.stringify(emptyConfig, null, 2));
      return emptyConfig;
    }

    const data = fs.readFileSync(LISTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Error loading config:', error);
    return { lists: [] };
  }
}

function generateManifest(config) {
  const enabledLists = config.lists.filter(l => l.enabled !== false);
  
  enabledLists.sort((a, b) => {
    const oa = typeof a.order === 'number' ? a.order : Infinity;
    const ob = typeof b.order === 'number' ? b.order : Infinity;
    if (oa !== ob) return oa - ob;
    return (a.name || '').localeCompare(b.name || '');
  });

  const catalogs = enabledLists.map((list, index) => {
    const nameSlug = list.name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    return {
      type: list.type || 'movie',
      id: `trakt-list-${nameSlug}`,
      name: list.name,
      extra: [
        { name: 'skip', isRequired: false },
        { name: 'genre', isRequired: false }
      ]
    };
  });

  console.log('📋 Generated ordered catalogs:', catalogs.map(c => c.id));

  const version = require('./package.json').version.split('.');
  version[2] = String((+version[2] || 0) + 1);
  const bumpedVersion = version.join('.');

  return {
    id: 'org.stremio.trakt.addon',
    version: bumpedVersion,
    name: 'Stremio Trakt Lists',
    description: 'Access your Trakt.tv lists in Stremio',
    logo: 'https://walter.trakt.tv/hotlink-ok/public/logos/trakt-icon-red-white_200x200.png',
    resources: ['catalog'],
    types: ['movie', 'series'],
    catalogs: catalogs,
    idPrefixes: ['tt', 'trakt:'],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}

async function fetchPosterUrlOptimized(content, itemType) {
  const cacheKey = `${content.ids?.imdb || content.ids?.trakt}-${itemType}`;
  
  if (posterCache[cacheKey]) {
    return posterCache[cacheKey];
  }

  let posterUrl = null;

  // Try TMDB first
  if (process.env.TMDB_API_KEY) {
    posterUrl = await fetchTMDBPoster(content, itemType);
  }

  // Fallback to OMDB
  if (!posterUrl && process.env.OMDB_API_KEY) {
    posterUrl = await fetchOMDBPoster(content);
  }

  // Default poster
  if (!posterUrl) {
    posterUrl = 'https://via.placeholder.com/300x450/333333/FFFFFF?text=No+Poster';
  }

  posterCache[cacheKey] = posterUrl;
  
  if (Object.keys(posterCache).length % 10 === 0) {
    savePosterCache();
  }

  return posterUrl;
}

async function fetchTMDBPoster(content, itemType) {
  try {
    let searchQuery = encodeURIComponent(content.title);
    let tmdbUrl;
    
    if (itemType === 'movie') {
      tmdbUrl = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${searchQuery}`;
      if (content.year) tmdbUrl += `&year=${content.year}`;
    } else {
      tmdbUrl = `https://api.themoviedb.org/3/search/tv?api_key=${process.env.TMDB_API_KEY}&query=${searchQuery}`;
      if (content.year) tmdbUrl += `&first_air_date_year=${content.year}`;
    }

    const response = await fetch(tmdbUrl);
    if (response.ok) {
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        const posterPath = data.results[0].poster_path;
        if (posterPath) {
          return `https://image.tmdb.org/t/p/w500${posterPath}`;
        }
      }
    }
  } catch (error) {
    console.error(`❌ TMDB error for ${content.title}:`, error.message);
  }
  return null;
}

async function fetchOMDBPoster(content) {
  try {
    const imdbId = content.ids?.imdb;
    let omdbUrl;
    
    if (imdbId) {
      omdbUrl = `https://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&i=${imdbId}`;
    } else {
      const searchQuery = encodeURIComponent(content.title);
      omdbUrl = `https://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&t=${searchQuery}`;
      if (content.year) omdbUrl += `&y=${content.year}`;
    }

    const response = await fetch(omdbUrl);
    if (response.ok) {
      const data = await response.json();
      if (data.Poster && data.Poster !== 'N/A') {
        return data.Poster;
      }
    }
  } catch (error) {
    console.error(`❌ OMDB error for ${content.title}:`, error.message);
  }
  return null;
}

// ==========================================
// MAIN ADDON BUILDER FUNCTION
// ==========================================

function buildAddon() {
  loadPosterCache();
  
  let addonConfig;
  try {
    addonConfig = loadConfig();
    if (!addonConfig.lists || addonConfig.lists.length === 0) {
      console.warn('⚠️ No lists configured in lists.json');
    }
  } catch (error) {
    console.error('❌ Failed to load config during addon build:', error);
    addonConfig = { lists: [] };
  }

  const manifest = generateManifest(addonConfig);
  const addonBuilderInstance = new addonBuilder(manifest);

  // ==========================================
  // SINGLE CATALOG HANDLER (FIXED)
  // ==========================================

  addonBuilderInstance.defineCatalogHandler(async (args) => {
    console.log(`📋 Catalog request for: ${args.id}`);
    
    try {
      const { type, id, extra } = args;
      const currentConfig = loadConfig();

      // Find matching list
      let matchedList = null;
      for (let i = 0; i < currentConfig.lists.length; i++) {
        const list = currentConfig.lists[i];
        if (list.enabled === false) continue;

        const nameSlug = list.name
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        const nameBasedId = `trakt-list-${nameSlug}`;
        
        if (nameBasedId === id) {
          matchedList = list;
          console.log(`✅ Found matching list: "${list.name}" (ID: ${id})`);
          break;
        }
      }

      if (!matchedList) {
        console.log(`❌ No list found for catalog ID: ${id}`);
        return { metas: [] };
      }

      // Extract username and list slug
      const urlMatch = matchedList.url.match(/trakt\.tv\/users\/([^\/]+)\/lists\/([^\/\?]+)/);
      if (!urlMatch) {
        console.error(`❌ Invalid URL format: ${matchedList.url}`);
        return { metas: [] };
      }

      const [, username, listSlug] = urlMatch;
      console.log(`🎯 List details: ${username}/${listSlug}`);

      // Pagination
      const skip = parseInt(extra?.skip || 0);
      const limit = 100;
      let page = Math.floor(skip / 95) + 1;
      if (page < 1) page = 1;

      console.log(`🔗 Fetching from Trakt: ${username}/${listSlug} (page ${page})`);

      // Build API URL
      const apiUrl = `https://api.trakt.tv/users/${username}/lists/${listSlug}/items/movie,show?extended=full&limit=${limit}&page=${page}`;
      console.log(`🌐 API URL: ${apiUrl}`);

      // Get access token
      const tokenManager = require('./tokenManager');
      const accessToken = await tokenManager.getAccessToken();
      if (!accessToken) {
        console.error('❌ No access token available');
        return { metas: [] };
      }

      // Fetch data
      const response = await fetch(apiUrl, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': process.env.TRAKT_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        console.error(`❌ Trakt API error: ${response.status} ${response.statusText}`);
        return { metas: [] };
      }

      const items = await response.json();
      console.log(`📦 Fetched ${items.length} items for "${matchedList.name}"`);

      // Filter by type
      const filteredItems = items.filter(item => {
        const itemType = item.movie ? 'movie' : 'series';
        return type === itemType;
      });

      console.log(`🎬 Filtered to ${filteredItems.length} ${type} items`);

      // Process items
      const metas = [];
      const batchSize = 5;
      
      for (let i = 0; i < filteredItems.length; i += batchSize) {
        const batch = filteredItems.slice(i, i + batchSize);
        console.log(`🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(filteredItems.length / batchSize)}`);

        const batchPromises = batch.map(async (item) => {
          const content = item.movie || item.show;
          const itemType = item.movie ? 'movie' : 'series';
          const posterUrl = await fetchPosterUrlOptimized(content, itemType);

          return {
            id: content.ids.imdb || `trakt:${content.ids.trakt}`,
            type: itemType,
            name: content.title,
            poster: posterUrl,
            year: content.year?.toString(),
            imdbRating: content.rating,
            description: content.overview || content.tagline || `${content.title} from your Trakt list`,
            genres: content.genres || [],
            runtime: content.runtime,
            country: content.country,
            language: content.language
          };
        });

        const batchResults = await Promise.all(batchPromises);
        metas.push(...batchResults);

        if (i + batchSize < filteredItems.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`✅ Generated ${metas.length} metas for catalog "${matchedList.name}"`);
      savePosterCache();
      return { metas };

    } catch (error) {
      console.error(`❌ Catalog handler error for ID ${args.id}:`, error);
      return { metas: [] };
    }
  });

  console.log('✅ Addon built successfully');
  return addonBuilderInstance.getInterface();
}

function getAddonInterface() {
  try {
    console.log('🔧 Building addon interface...');
    const addonInterface = buildAddon();
    console.log('✅ Addon interface created successfully');
    return addonInterface;
  } catch (error) {
    console.error('❌ Failed to build addon interface:', error);
    throw error;
  }
}

// ==========================================
// CLEANUP AND EXPORTS
// ==========================================

process.on('exit', () => {
  savePosterCache();
});

process.on('SIGINT', () => {
  savePosterCache();
  process.exit();
});

module.exports = {
  buildAddon,
  getAddonInterface
};
