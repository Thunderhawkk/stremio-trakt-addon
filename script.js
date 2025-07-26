async function checkManifest() {
  const button = document.querySelector('button[onclick="checkManifest()"]') || 
                 document.querySelector('#checkManifest') || 
                 document.querySelector('[data-action="check-manifest"]');
  
  if (button) {
    button.textContent = '🔄 Checking...';
    button.disabled = true;
    button.style.backgroundColor = '#6b7280'; // gray
  }
  
  try {
    console.log('🔍 Checking manifest...');
    
    // Simple - same origin, same port!
    const manifestUrl = `${window.location.origin}/manifest.json`;
    console.log('🔗 Fetching from:', manifestUrl);
    
    const response = await fetch(manifestUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const manifest = await response.json();
    console.log('✅ Manifest loaded successfully:', manifest);
    
    // Update UI with success
    if (button) {
      const catalogCount = manifest.catalogs ? manifest.catalogs.length : 0;
      button.textContent = `✅ ${catalogCount} catalogs found`;
      button.style.backgroundColor = '#10b981'; // green
      button.style.color = 'white';
      button.disabled = false;
    }
    
    // Show detailed info in console
    if (manifest.catalogs && manifest.catalogs.length > 0) {
      console.log('📋 Available catalogs:');
      manifest.catalogs.forEach((catalog, index) => {
        console.log(`  ${index + 1}. ${catalog.name} (${catalog.id})`);
      });
    }
    
    return manifest;
    
  } catch (error) {
    console.error('❌ Manifest check failed:', error);
    
    if (button) {
      button.textContent = '❌ Failed to load';
      button.style.backgroundColor = '#ef4444'; // red
      button.style.color = 'white';
      button.disabled = false;
    }
    
    // Show user-friendly error
    alert(`Manifest check failed: ${error.message}\n\nThe addon should work now since everything runs on the same port!`);
    
    throw error;
  }
}

class StremioTraktConfig {
  constructor() {
    this.config = { lists: [] };
    this.draggedElement = null;
    this.validationTimeout = null;
    this.init();
  }

  async init() {
    await this.loadConfig();
    this.setupEventListeners();
    this.renderLists();
    this.updateDisplayedUrls();
    await this.checkAuthStatus();
  }

  async checkAuthStatus() {
    try {
      const response = await fetch('/api/check-auth');
      const authStatus = await response.json();
      const loginBtn = document.getElementById('traktLoginBtn');
      
      if (authStatus.authenticated) {
        const username = authStatus.user || 'User';
        loginBtn.textContent = `✓ ${username}`;
        loginBtn.classList.remove('btn-warning');
        loginBtn.classList.add('btn-success');
        loginBtn.disabled = true;
        
        if (authStatus.tokenExpiresAt) {
          const expiresAt = new Date(authStatus.tokenExpiresAt);
          const hoursUntilExpiry = Math.max(0, Math.floor((expiresAt - Date.now()) / (1000 * 60 * 60)));
          if (hoursUntilExpiry < 12) {
            this.showStatus(`Token expires in ${hoursUntilExpiry} hours`, 'info');
          }
        }
      }
    } catch (error) {
      console.error('Auth status check failed:', error);
    }
  }

  setupEventListeners() {
    // Header actions
    document.getElementById('addListBtn').addEventListener('click', () => this.openModal());
    document.getElementById('saveBtn').addEventListener('click', () => this.saveConfig());
    document.getElementById('refreshBtn').addEventListener('click', () => this.refreshAddon());
    document.getElementById('viewManifestBtn').addEventListener('click', () => this.viewManifest());
    document.getElementById('traktLoginBtn').addEventListener('click', () => this.initTraktLogin());
    document.getElementById('refreshTokenBtn').addEventListener('click', () => this.refreshToken());
    document.getElementById('checkTokenBtn').addEventListener('click', () => this.checkTokenStatus());
    document.getElementById('clearTokenBtn').addEventListener('click', () => this.clearTokens());
    document.getElementById('addAddonBtn').addEventListener('click', () => this.openInstallModal());
    document.getElementById('closeInstallModal').addEventListener('click', () => this.closeInstallModal());
    document.getElementById('directInstallBtn').addEventListener('click', () => this.directInstall());
    document.getElementById('copyUrlBtn').addEventListener('click', () => this.copyAddonUrl());
    document.getElementById('installModal').addEventListener('click', (e) => {
      if (e.target.id === 'installModal') this.closeInstallModal();
    });

    // Search and filter
    document.getElementById('listSearch').addEventListener('input', () => this.filterLists());
    document.getElementById('typeFilter').addEventListener('change', () => this.filterLists());
    document.getElementById('togglePreview').addEventListener('click', () => this.togglePreview());

    // Modal events
    document.getElementById('closeModal').addEventListener('click', () => this.closeModal());
    document.getElementById('cancelBtn').addEventListener('click', () => this.closeModal());
    document.getElementById('addListForm').addEventListener('submit', (e) => this.handleFormSubmit(e));
    document.getElementById('closePreview').addEventListener('click', () => this.closePreview());

    // Real-time URL validation
    document.getElementById('listUrl').addEventListener('input', () => this.validateUrl());

    // Modal backdrop clicks
    document.getElementById('addListModal').addEventListener('click', (e) => {
      if (e.target.id === 'addListModal') this.closeModal();
    });

    document.getElementById('previewPanel').addEventListener('click', (e) => {
      if (e.target.id === 'previewPanel') this.closePreview();
    });

    // Test background refresh
    const testBtn = document.getElementById('testBackgroundRefreshBtn');
    if (testBtn) {
      testBtn.replaceWith(testBtn.cloneNode(true));
      document.getElementById('testBackgroundRefreshBtn')
        .addEventListener('click', () => this.testBackgroundRefresh());
    }
  }

  // FIXED - No more port 7000!
  getAddonUrl() {
    return `${window.location.origin}/manifest.json`;
  }

  async openInstallModal() {
    const modal = document.getElementById('installModal');
    const urlInput = document.getElementById('addonUrlInput');
    
    // Get the correct addon URL (same domain, same port)
    const addonUrl = this.getAddonUrl();
    
    // Set the addon URL in the input
    urlInput.value = addonUrl;
    
    // Show the modal
    modal.classList.add('show');
    
    // Check addon status and catalog count
    await this.updateAddonStatus();
  }

  closeInstallModal() {
    const modal = document.getElementById('installModal');
    modal.classList.remove('show');
  }

  async updateAddonStatus() {
    const statusElement = document.getElementById('addonStatus');
    const catalogElement = document.getElementById('catalogCount');
    
    try {
      statusElement.textContent = 'Checking...';
      statusElement.className = 'status-badge checking';
      
      const addonUrl = this.getAddonUrl();
      const response = await fetch(addonUrl, { cache: 'no-store' });
      
      if (response.ok) {
        const manifest = await response.json();
        statusElement.textContent = 'Online';
        statusElement.className = 'status-badge online';
        
        const catalogCount = manifest.catalogs ? manifest.catalogs.length : 0;
        catalogElement.textContent = `${catalogCount} catalogs available`;
      } else {
        throw new Error('Addon not accessible');
      }
    } catch (error) {
      statusElement.textContent = 'Offline';
      statusElement.className = 'status-badge offline';
      catalogElement.textContent = 'Addon not running';
      console.error('Addon status check failed:', error);
    }
  }

  directInstall() {
    const addonUrl = this.getAddonUrl();
    const stremioUrl = `stremio://${encodeURIComponent(addonUrl)}`;
    
    try {
      window.open(stremioUrl, '_self');
      this.showStatus('Opening Stremio...', 'info');
      
      setTimeout(() => {
        this.showStatus('If Stremio didn\'t open, copy the URL manually', 'warning');
      }, 3000);
    } catch (error) {
      console.error('Direct install failed:', error);
      this.showStatus('Please use the copy URL method instead', 'error');
    }
  }

  async copyAddonUrl() {
    const url = this.getAddonUrl();
    const urlInput = document.getElementById('addonUrlInput');
    const copyBtn = document.getElementById('copyUrlBtn');
    const copyText = copyBtn.querySelector('.copy-text');
    const copySuccess = copyBtn.querySelector('.copy-success');
    
    try {
      urlInput.select();
      urlInput.setSelectionRange(0, 99999);
      
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else {
        document.execCommand('copy');
      }
      
      // Show success feedback
      copyText.style.display = 'none';
      copySuccess.style.display = 'inline';
      copyBtn.classList.add('btn-success');
      copyBtn.classList.remove('btn-secondary');
      this.showStatus('Addon URL copied to clipboard!', 'success');
      
      // Reset button after 2 seconds
      setTimeout(() => {
        copyText.style.display = 'inline';
        copySuccess.style.display = 'none';
        copyBtn.classList.remove('btn-success');
        copyBtn.classList.add('btn-secondary');
      }, 2000);
      
    } catch (error) {
      console.error('Copy failed:', error);
      this.showStatus('Failed to copy URL. Please select and copy manually.', 'error');
      urlInput.focus();
      urlInput.select();
    }
  }

  async refreshToken() {
    try {
      this.showStatus('Refreshing authentication token...', 'info');
      const response = await fetch('/api/refresh-token', { method: 'POST' });
      const result = await response.json();
      
      if (result.success) {
        this.showStatus('Token refreshed successfully', 'success');
        await this.checkAuthStatus();
        
        if (result.expiresAt) {
          const expiryDate = new Date(result.expiresAt);
          this.showStatus(`New token expires at: ${expiryDate.toLocaleString()}`, 'info');
        }
      } else {
        throw new Error(result.error || 'Refresh failed');
      }
    } catch (error) {
      this.showStatus(`Token refresh failed: ${error.message}`, 'error');
      console.error('Token refresh error:', error);
      
      if (error.message.includes('No refresh token')) {
        this.showStatus('Please re-authenticate with Trakt', 'warning');
      }
    }
  }

  async checkTokenStatus() {
    try {
      this.showStatus('Checking token status...', 'info');
      const response = await fetch('/api/token-status');
      const status = await response.json();
      
      if (response.ok) {
        if (status.hasToken) {
          const statusMessage = `
Token Status:
• Has Refresh Token: ${status.hasRefreshToken ? 'Yes' : 'No'}
• Is Expired: ${status.isExpired ? 'Yes' : 'No'}
• Time Until Expiry: ${status.hoursUntilExpiry}h ${status.minutesUntilExpiry % 60}m
• Can Refresh: ${status.canRefresh ? 'Yes' : 'No'}
• Expires At: ${new Date(status.expiresAt).toLocaleString()}
• Token Preview: ${status.tokenPreview || 'N/A'}
          `.trim();
          alert(statusMessage);
          
          if (status.hoursUntilExpiry < 2 && !status.isExpired) {
            this.showStatus(`Token expires in ${status.hoursUntilExpiry}h ${status.minutesUntilExpiry % 60}m!`, 'warning');
          } else if (status.isExpired) {
            this.showStatus('Token has expired! Please refresh or re-authenticate.', 'error');
          }
        } else {
          alert('No authentication tokens found. Please login to Trakt first.');
          this.showStatus('No tokens found - authentication required', 'warning');
        }
      } else {
        throw new Error(status.details || 'Failed to check token status');
      }
    } catch (error) {
      this.showStatus(`Failed to check token status: ${error.message}`, 'error');
      console.error('Token status check error:', error);
    }
  }

  async clearTokens() {
    if (confirm('Are you sure you want to clear all authentication tokens? You will need to re-authenticate with Trakt.')) {
      try {
        this.showStatus('Clearing tokens...', 'info');
        const response = await fetch('/api/clear-tokens', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
          this.showStatus('Tokens cleared successfully. Please re-authenticate.', 'success');
          
          const loginBtn = document.getElementById('traktLoginBtn');
          loginBtn.textContent = 'Login to Trakt';
          loginBtn.className = 'btn btn-warning';
          loginBtn.disabled = false;
          
          await this.checkAuthStatus();
        } else {
          throw new Error(result.error || 'Failed to clear tokens');
        }
      } catch (error) {
        this.showStatus(`Failed to clear tokens: ${error.message}`, 'error');
        console.error('Clear tokens error:', error);
      }
    }
  }

  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        this.config = await response.json();
      }
    } catch (error) {
      this.showStatus('Failed to load configuration', 'error');
      console.error('Load config error:', error);
    }
  }

  // SIMPLIFIED - No server restart needed!
  async saveConfig() {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(this.config)
      });

      if (response.ok) {
        const result = await response.json();
        this.showStatus(result.message || 'Configuration saved successfully!', 'success');
        
        // Update URLs after saving
        setTimeout(() => {
          this.updateDisplayedUrls();
          console.log('🔗 Addon URLs updated after save');
        }, 500);
        
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save configuration');
      }
    } catch (error) {
      this.showStatus(`Failed to save configuration: ${error.message}`, 'error');
      console.error('Save config error:', error);
    }
  }

  renderLists() {
    const container = document.getElementById('listsContainer');
    container.innerHTML = '';
    
    if (!this.config.lists || this.config.lists.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>No lists configured yet</h3>
          <p>Click "Add List" to get started</p>
        </div>
      `;
      return;
    }

    this.config.lists.forEach((list, index) => {
      const listElement = this.createListElement(list, index);
      container.appendChild(listElement);
    });

    // Apply current filter
    this.filterLists();
  }

  createListElement(list, index) {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.draggable = true;
    div.dataset.index = index;
    
    div.innerHTML = `
      <div class="list-content">
        <div class="list-header">
          <h3 class="list-name">${this.escapeHtml(list.name)}</h3>
          <div class="list-actions">
            <button class="btn-icon" onclick="traktConfig.editList(${index})" title="Edit">✏️</button>
            <button class="btn-icon" onclick="traktConfig.deleteList(${index})" title="Delete">🗑️</button>
            <button class="btn-icon drag-handle" title="Drag to reorder">⋮⋮</button>
          </div>
        </div>
        <div class="list-details">
          <span class="list-type ${list.type}">${list.type || 'movie'}</span>
          <span class="list-url">${this.escapeHtml(list.url)}</span>
          <label class="toggle">
            <input type="checkbox" ${list.enabled !== false ? 'checked' : ''} 
                   onchange="traktConfig.toggleList(${index})">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `;

    // Add drag event listeners
    div.addEventListener('dragstart', (e) => this.handleDragStart(e));
    div.addEventListener('dragover', (e) => this.handleDragOver(e));
    div.addEventListener('drop', (e) => this.handleDrop(e));

    return div;
  }

  updateDisplayedUrls() {
    try {
      // Get the correct addon URL (no more port 7000!)
      const correctUrl = this.getAddonUrl();
      
      // Update the addon URL input field
      const urlInput = document.getElementById('addonUrlInput');
      if (urlInput) {
        urlInput.value = correctUrl;
      }
      
      // Update any displayed URLs in the interface
      const urlDisplays = document.querySelectorAll('.addon-url-display, [data-addon-url]');
      urlDisplays.forEach(element => {
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
          element.value = correctUrl;
        } else {
          element.textContent = correctUrl;
        }
      });
      
      // Update any Stremio deep links
      const stremioUrl = `stremio://${correctUrl}`;
      const deepLinks = document.querySelectorAll('[data-stremio-link], .stremio-deep-link');
      deepLinks.forEach(element => {
        if (element.tagName === 'A') {
          element.href = stremioUrl;
        } else {
          element.textContent = stremioUrl;
        }
      });
      
      console.log('✅ Updated all addon URLs to:', correctUrl);
    } catch (error) {
      console.error('❌ Failed to update addon URLs:', error);
    }
  }

  async testBackgroundRefresh() {
    const button = document.getElementById('testBackgroundRefreshBtn');
    if (button.disabled) return;
    
    button.disabled = true;
    button.textContent = 'Testing...';
    
    try {
      this.showStatus('Testing background refresh...', 'info');
      const response = await fetch('/api/test-background-refresh', { method: 'POST' });
      const result = await response.json();
      
      if (result.success) {
        this.showStatus('Background refresh test successful!', 'success');
        console.log('Refresh test result:', result);
      } else {
        this.showStatus(`Background refresh test: ${result.message}`, 'info');
        console.log('Refresh test result:', result);
      }
    } catch (error) {
      this.showStatus(`Background refresh test failed: ${error.message}`, 'error');
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = 'Test Background Refresh';
      }, 2000);
    }
  }

  // Preview functionality
  async togglePreview() {
    const panel = document.getElementById('previewPanel');
    panel.classList.toggle('hidden');
    
    if (!panel.classList.contains('hidden')) {
      await this.generatePreview();
    }
  }

  async generatePreview() {
    const previewGrid = document.getElementById('previewGrid');
    previewGrid.innerHTML = '<div class="loading">Loading preview...</div>';
    
    try {
      const enabledLists = this.config.lists.filter(list => list.enabled !== false);
      
      if (enabledLists.length === 0) {
        previewGrid.innerHTML = `
          <div class="empty-preview">
            <h3>No enabled lists</h3>
            <p>Enable some lists to see the preview</p>
          </div>
        `;
        return;
      }

      previewGrid.innerHTML = '';
      
      for (const list of enabledLists.slice(0, 3)) {
        try {
          const response = await fetch('/api/preview-list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              listUrl: list.url,
              limit: 6,
              type: list.type
            })
          });
          
          if (response.ok) {
            const items = await response.json();
            const listSection = this.createPreviewSection(list.name, items);
            previewGrid.appendChild(listSection);
          }
        } catch (error) {
          console.error(`Preview error for ${list.name}:`, error);
        }
      }
      
      if (previewGrid.children.length === 0) {
        previewGrid.innerHTML = `
          <div class="error-preview">
            <h3>Preview unavailable</h3>
            <p>Failed to load preview. Please check your configuration.</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('Preview generation failed:', error);
      previewGrid.innerHTML = `
        <div class="error-preview">
          <h3>Error</h3>
          <p>Failed to generate preview. Please check your configuration.</p>
        </div>
      `;
    }
  }

  createPreviewSection(listName, items) {
    const section = document.createElement('div');
    section.className = 'preview-section';
    section.innerHTML = `
      <h4>${this.escapeHtml(listName)}</h4>
      <div class="preview-items">
        ${items.map(item => `
          <div class="preview-item">
            <img src="${item.poster}" alt="${this.escapeHtml(item.name)}" loading="lazy">
            <div class="preview-item-info">
              <span class="preview-item-name">${this.escapeHtml(item.name)}</span>
              <span class="preview-item-year">${item.year || ''}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    return section;
  }

  closePreview() {
    document.getElementById('previewPanel').classList.add('hidden');
  }

  async viewManifest() {
    try {
      const manifestUrl = this.getAddonUrl();
      const response = await fetch(manifestUrl, { cache: 'no-store' });
      
      if (response.ok) {
        const manifest = await response.json();
        
        const popup = window.open('', '_blank', 'width=800,height=600');
        popup.document.write(`
          <html>
            <head><title>Stremio Addon Manifest</title></head>
            <body>
              <h1>Stremio Addon Manifest</h1>
              <pre>${JSON.stringify(manifest, null, 2)}</pre>
            </body>
          </html>
        `);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      this.showStatus('Failed to load manifest', 'error');
      console.error('Manifest error:', error);
    }
  }

  async initTraktLogin() {
    try {
      const authCheck = await fetch('/api/check-auth');
      const authStatus = await authCheck.json();
      
      if (authStatus.authenticated) {
        this.showStatus(`Already authenticated as ${authStatus.user}`, 'success');
        return;
      }
      
      this.showStatus('Initializing Trakt authentication...', 'info');
      const response = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.device_code) {
        window.open(data.verification_url, '_blank', 'width=600,height=700');
        this.showStatus(`Please enter code: ${data.user_code}`, 'info');
        this.pollTraktAuth(data.device_code, data.interval || 5);
      } else {
        throw new Error('No device code received');
      }
    } catch (error) {
      this.showStatus(`Failed to initialize Trakt login: ${error.message}`, 'error');
      console.error('Trakt login error:', error);
    }
  }

  async pollTraktAuth(deviceCode, interval = 5) {
    const maxAttempts = 60;
    let attempts = 0;
    
    const poll = async () => {
      try {
        const response = await fetch('/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: deviceCode })
        });
        
        const data = await response.json();
        
        if (data.success) {
          this.showStatus('Successfully authenticated with Trakt!', 'success');
          const loginBtn = document.getElementById('traktLoginBtn');
          loginBtn.textContent = 'Authenticated ✓';
          loginBtn.disabled = true;
          await this.checkAuthStatus();
          return;
        } else if (data.pending) {
          if (attempts++ < maxAttempts) {
            setTimeout(poll, interval * 1000);
          } else {
            this.showStatus('Authentication timeout. Please try again.', 'error');
          }
        } else {
          throw new Error(data.error || 'Authentication failed');
        }
      } catch (error) {
        this.showStatus(`Authentication error: ${error.message}`, 'error');
        console.error('Auth polling error:', error);
      }
    };
    
    setTimeout(poll, interval * 1000);
  }

  // Utility methods
  showStatus(message, type = 'info') {
    const container = document.getElementById('statusMessages');
    const statusDiv = document.createElement('div');
    statusDiv.className = `status-message ${type}`;
    statusDiv.textContent = message;
    container.appendChild(statusDiv);
    
    setTimeout(() => {
      statusDiv.remove();
    }, 5000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Add placeholder methods for missing functionality
  openModal() { /* Implement modal opening */ }
  closeModal() { /* Implement modal closing */ }
  handleFormSubmit(e) { /* Implement form submission */ }
  validateUrl() { /* Implement URL validation */ }
  filterLists() { /* Implement list filtering */ }
  editList(index) { /* Implement list editing */ }
  deleteList(index) { /* Implement list deletion */ }
  toggleList(index) { /* Implement list toggling */ }
  refreshAddon() { /* Implement addon refresh */ }
  handleDragStart(e) { /* Implement drag start */ }
  handleDragOver(e) { /* Implement drag over */ }
  handleDrop(e) { /* Implement drop */ }
}

// Initialize the configuration manager
const traktConfig = new StremioTraktConfig();

// Make it globally available for onclick handlers
window.traktConfig = traktConfig;