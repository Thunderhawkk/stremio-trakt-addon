// utils/fetchHelper.js
let fetchFunction = null;

async function initializeFetch() {
    if (fetchFunction) {
        return fetchFunction;
    }

    try {
        // Try Node.js 18+ native fetch first
        if (typeof globalThis.fetch !== 'undefined') {
            fetchFunction = globalThis.fetch;
            console.log('✓ Using native fetch API');
            return fetchFunction;
        }

        // Try global fetch (if polyfilled)
        if (typeof global.fetch !== 'undefined') {
            fetchFunction = global.fetch;
            console.log('✓ Using global fetch');
            return fetchFunction;
        }

        // Fallback to node-fetch
        const nodeFetch = require('node-fetch');
        fetchFunction = nodeFetch;
        console.log('✓ Using node-fetch package');
        return fetchFunction;

    } catch (error) {
        console.error('❌ All fetch methods failed:', error.message);
        throw new Error('No fetch implementation available. Please install node-fetch@2.7.0');
    }
}

async function universalFetch(url, options = {}) {
    const fetch = await initializeFetch();
    return fetch(url, options);
}

module.exports = {
    initializeFetch,
    fetch: universalFetch
};
