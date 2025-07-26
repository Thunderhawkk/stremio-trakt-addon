// ==========================================
// IMPORTS AND DEPENDENCIES
// ==========================================
const { addonBuilder } = require('stremio-addon-sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './file.env' });

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

/**
 * Load poster cache from file
 */
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

/**
 * Save poster cache to file
 */
function savePosterCache() {
  try {
    fs.writeFileSync(POSTER_CACHE_FILE, JSON.stringify(posterCache, null, 2));
  } catch (error) {
    console.error('❌ Error saving poster cache:', error);
  }
}

/**
 * Load configuration from lists.json
 */
function loadConfig() {
  try {
    if (!fs.existsSync(LISTS_FILE)) {
      console.log('📄 No lists.json found, creating empty config');
      const emptyConfig = { lists: [] };
      fs.mkdirSync(path.dirname(LISTS_FILE), { recursive: true });
      fs.writeFileSync(LISTS_FILE, JSON.stringify(emptyConfig, null, 2));
      return emptyConfig;
    }
    
    const data = fs.readFileSync(LISTS_FILE, 'utf8'); // ✅ LISTS_FILE
    return JSON.parse(data);
    
  } catch (error) {
    console.error('❌ Error loading config:', error);
    return { lists: [] };
  }
}

/**
 * Generate manifest for Stremio addon
 */
function generateManifest(config) {
  // 1. Filter out disabled lists
  const enabledLists = config.lists.filter(l => l.enabled !== false);

  // 2. Sort by the `order` property (lowest first), fallback to name
  enabledLists.sort((a, b) => {
    const oa = typeof a.order === 'number' ? a.order : Infinity;
    const ob = typeof b.order === 'number' ? b.order : Infinity;
    if (oa !== ob) return oa - ob;
    return (a.name || '').localeCompare(b.name || '');
  });

  // 3. Map to catalog entries
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

  // 4. Bump version on each config change (optional but forces Stremio to reload)
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

/**
 * Fetch poster from TMDB API
 */
async function fetchTMDBPoster(content, itemType) {
  try {
    const { fetch } = require('./utils/fetchHelper');
    let searchQuery = encodeURIComponent(content.title);
    let tmdbUrl;

    if (itemType === 'movie') {
      tmdbUrl = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${searchQuery}`;
      if (content.year) {
        tmdbUrl += `&year=${content.year}`;
      }
    } else {
      tmdbUrl = `https://api.themoviedb.org/3/search/tv?api_key=${process.env.TMDB_API_KEY}&query=${searchQuery}`;
      if (content.year) {
        tmdbUrl += `&first_air_date_year=${content.year}`;
      }
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

/**
 * Fetch poster from OMDB API
 */
async function fetchOMDBPoster(content) {
  try {
    const { fetch } = require('./utils/fetchHelper');
    const imdbId = content.ids?.imdb;
    let omdbUrl;

    if (imdbId) {
      omdbUrl = `https://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&i=${imdbId}`;
    } else {
      const searchQuery = encodeURIComponent(content.title);
      omdbUrl = `https://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&t=${searchQuery}`;
      if (content.year) {
        omdbUrl += `&y=${content.year}`;
      }
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

/**
 * Optimized poster fetching with caching and fallbacks
 */
async function fetchPosterUrlOptimized(content, itemType) {
  const cacheKey = `${content.ids?.imdb || content.ids?.trakt}-${itemType}`;
  
  // Check cache first
  if (posterCache[cacheKey]) {
    return posterCache[cacheKey];
  }

  let posterUrl = null;

  // Try TMDB first (higher quality)
  if (process.env.TMDB_API_KEY) {
    posterUrl = await fetchTMDBPoster(content, itemType);
  }

  // Fallback to OMDB if TMDB fails
  if (!posterUrl && process.env.OMDB_API_KEY) {
    posterUrl = await fetchOMDBPoster(content);
  }

  // Default poster if all fails
  if (!posterUrl) {
    posterUrl = 'https://via.placeholder.com/300x450/333333/FFFFFF?text=No+Poster';
  }

  // Cache the result
  posterCache[cacheKey] = posterUrl;
  
  // Save cache periodically (every 10 new posters)
  if (Object.keys(posterCache).length % 10 === 0) {
    savePosterCache();
  }

  return posterUrl;
}

// ==========================================
// MAIN ADDON BUILDER FUNCTION
// ==========================================

/**
 * Build and configure the Stremio addon
 */
function buildAddon() {
  // Load poster cache on startup
  loadPosterCache();
  
  // Load configuration
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

  // Generate manifest and create addon instance
  const manifest = generateManifest(addonConfig);
  const addonBuilderInstance = new addonBuilder(manifest);

  // ==========================================
  // CATALOG HANDLER
  // ==========================================
  addonBuilderInstance.defineCatalogHandler(async ({ type, id, extra }) => {
  try {
    console.log(`🔍 Catalog request: type=${type}, id=${id}, skip=${extra?.skip || 0}`);
    
    // 1. LOAD CONFIG AND FIND MATCHING LIST
    const currentConfig = loadConfig();
    
    if (!currentConfig.lists || currentConfig.lists.length === 0) {
      console.log('❌ No lists found in current config');
      return { metas: [] };
    }

    // Find the matching list (your existing matching logic)
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
      
      const originalId = `trakt-list-${Buffer.from(list.url).toString('base64').slice(0, 10)}`;
      const customId = list.id ? `trakt-list-${list.id}` : null;
      const indexId = `trakt-list-${i}`;

      if (nameBasedId === id || originalId === id || customId === id || indexId === id) {
        matchedList = list;
        console.log(`✅ Found matching list: "${list.name}" (ID: ${id})`);
        break;
      }
    }

    if (!matchedList) {
      console.log(`❌ No list found for catalog ID: ${id}`);
      return { metas: [] };
    }

    // 2. EXTRACT USERNAME AND LIST SLUG FIRST
    const urlMatch = matchedList.url.match(/trakt\.tv\/users\/([^\/]+)\/lists\/([^\/\?]+)/);
    if (!urlMatch) {
      console.error(`❌ Invalid URL format: ${matchedList.url}`);
      return { metas: [] };
    }

    const [, username, listSlug] = urlMatch;
    console.log(`🎯 List details: ${username}/${listSlug}`);

    // 3. NOW DO PAGINATION (after username is defined)
    const skip = parseInt(extra?.skip || 0);
    const limit = 100;
    let page = 1;

    console.log(`📄 Pagination: skip=${skip}, limit=${limit}`);

    // Safe page calculation
    if (skip === 0) {
      page = 1;
    } else if (skip <= 98) {
      page = 2;
    } else if (skip <= 193) {
      page = 3;
    } else {
      page = Math.floor(skip / 95) + 1;
    }

    // Validate page
    if (!page || page < 1) {
      page = 1;
    }

    console.log(`🔗 Fetching from Trakt: ${username}/${listSlug} (page ${page}, limit=${limit})`);

    // 4. BUILD API URL (now all variables are defined)
    const apiUrl = `https://api.trakt.tv/users/${username}/lists/${listSlug}/items/movie,show?extended=full&limit=${limit}&page=${page}`;

    console.log(`🌐 API URL: ${apiUrl}`);

    // 5. GET ACCESS TOKEN
    const tokenManager = require('./tokenManager');
    const accessToken = await tokenManager.getAccessToken();
    
    if (!accessToken) {
      console.error('❌ No access token available');
      return { metas: [] };
    }

    // 6. FETCH DATA FROM TRAKT API
    const { fetch } = require('./utils/fetchHelper');
    const response = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': process.env.TRAKT_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      console.error(`❌ Trakt API error for ${matchedList.name}: ${response.status} ${response.statusText}`);
      return { metas: [] };
    }

    const items = await response.json();

    // Get pagination info from response headers
    const totalItemsHeader = response.headers.get('x-pagination-item-count');
    const totalPages = response.headers.get('x-pagination-page-count');
    const currentPage = response.headers.get('x-pagination-page');

    console.log(`📦 Fetched ${items.length} items for "${matchedList.name}" (page ${currentPage}/${totalPages}, total items: ${totalItemsHeader})`);

    // Filter items by type
    const filteredItems = items.filter(item => {
      const itemType = item.movie ? 'movie' : 'series';
      return type === itemType;
    });

    console.log(`🎬 Filtered to ${filteredItems.length} ${type} items`);

    // Calculate pagination status
    const totalItems = totalItemsHeader ? parseInt(totalItemsHeader) : 0;
    const hasMoreItems = (skip + filteredItems.length) < totalItems;

    console.log(`📊 Pagination info: skip=${skip}, fetched=${filteredItems.length}, total=${totalItems}, hasMore=${hasMoreItems}`);

    // Process items in batches (your existing batch processing code)
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
    console.error(`❌ Catalog handler error for ID ${id}:`, error);
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

// Save poster cache on process exit
process.on('exit', () => {
  savePosterCache();
});

process.on('SIGINT', () => {
  savePosterCache();
  process.exit();
});

// Export the buildAddon function
module.exports = { 
  buildAddon,
  getAddonInterface 
};
