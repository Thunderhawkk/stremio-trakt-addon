const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'poster_cache.json');
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

class PosterCache {
    constructor() {
        this.cache = this.loadCache();
    }

    loadCache() {
        try {
            if (fs.existsSync(CACHE_FILE)) {
                const data = fs.readFileSync(CACHE_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.warn('Cache load failed:', error.message);
        }
        return {};
    }

    saveCache() {
        try {
            fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
        } catch (error) {
            console.warn('Cache save failed:', error.message);
        }
    }

    get(key) {
        const cached = this.cache[key];
        if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
            return cached.url;
        }
        return null;
    }

    set(key, url) {
        this.cache[key] = {
            url: url,
            timestamp: Date.now()
        };
        this.saveCache();
    }

    getCacheKey(ids, itemType) {
        return `${itemType}_${ids.tmdb || ids.imdb || ids.trakt}`;
    }
}

module.exports = new PosterCache();
