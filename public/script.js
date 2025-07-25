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
            
            // Show token expiry info if available
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

        // Modal backdrop click
        document.getElementById('addListModal').addEventListener('click', (e) => {
            if (e.target.id === 'addListModal') this.closeModal();
        });

        // Preview panel backdrop click
        document.getElementById('previewPanel').addEventListener('click', (e) => {
            if (e.target.id === 'previewPanel') this.closePreview();
        });

        // Remove existing listeners first to prevent duplicates
    const testBtn = document.getElementById('testBackgroundRefreshBtn');
    if (testBtn) {
        // Remove any existing listeners
        testBtn.replaceWith(testBtn.cloneNode(true));
        
        // Add the listener to the new element
        document.getElementById('testBackgroundRefreshBtn')
            .addEventListener('click', () => this.testBackgroundRefresh());
    }
    }

    getAddonUrl() {
    // Construct the addon manifest URL
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const addonPort = 7000; // Your addon server port (not 3001)
    return `${protocol}//${hostname}:${addonPort}/manifest.json`;
}

async openInstallModal() {
    const modal = document.getElementById('installModal');
    const urlInput = document.getElementById('addonUrlInput');
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
        const response = await fetch(addonUrl);
        
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
        // Try to open Stremio directly
        window.open(stremioUrl, '_self');
        
        this.showStatus('Opening Stremio...', 'info');
        
        // Show fallback instructions after a delay
        setTimeout(() => {
            this.showStatus('If Stremio didn\'t open, copy the URL manually', 'warning');
        }, 3000);
        
    } catch (error) {
        console.error('Direct install failed:', error);
        this.showStatus('Please use the copy URL method instead', 'error');
    }
}

async copyAddonUrl() {
    const urlInput = document.getElementById('addonUrlInput');
    const copyBtn = document.getElementById('copyUrlBtn');
    const copyText = copyBtn.querySelector('.copy-text');
    const copySuccess = copyBtn.querySelector('.copy-success');
    
    try {
        // Select and copy the URL
        urlInput.select();
        urlInput.setSelectionRange(0, 99999); // For mobile devices
        
        // Modern clipboard API
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(urlInput.value);
        } else {
            // Fallback for older browsers
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
        
        // Select the text for manual copying
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
            await this.checkAuthStatus(); // Update the auth status display
        } else {
            throw new Error(result.error || 'Refresh failed');
        }
    } catch (error) {
        this.showStatus(`Token refresh failed: ${error.message}`, 'error');
        console.error('Token refresh error:', error);
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
                
                // Show warning if token expires soon
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

// Manual token refresh
async refreshToken() {
    try {
        this.showStatus('Refreshing authentication token...', 'info');
        
        const response = await fetch('/api/refresh-token', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            this.showStatus('Token refreshed successfully!', 'success');
            await this.checkAuthStatus(); // Update the auth status display
            
            // Show new expiry time
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

// Clear tokens (for troubleshooting)
async clearTokens() {
    if (confirm('Are you sure you want to clear all authentication tokens? You will need to re-authenticate with Trakt.')) {
        try {
            this.showStatus('Clearing tokens...', 'info');
            
            const response = await fetch('/api/clear-tokens', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                this.showStatus('Tokens cleared successfully. Please re-authenticate.', 'success');
                
                // Reset login button
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

    renderLists() {
        const container = document.getElementById('listsContainer');
        container.innerHTML = '';

        if (!this.config.lists || this.config.lists.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No lists configured</h3>
                    <p>Click "Add List" to get started</p>
                </div>`;
            return;
        }

        // Sort by order property
        const sortedLists = [...this.config.lists].sort((a, b) => (a.order || 0) - (b.order || 0));

        sortedLists.forEach((list, index) => {
            const listElement = this.createListElement(list, index);
            container.appendChild(listElement);
        });

        this.setupDragAndDrop();
    }

    createListElement(list, index) {
        const div = document.createElement('div');
        div.className = `list-item ${!list.enabled ? 'disabled' : ''}`;
        div.dataset.index = index;
        div.dataset.type = list.type;
        div.draggable = true;

        div.innerHTML = `
            <div class="drag-handle">⋮⋮</div>
            <div class="list-header">
                <div class="list-name">${this.escapeHtml(list.name)}</div>
                <a href="${list.url}" target="_blank" class="list-url">${list.url}</a>
            </div>
            <div class="list-toggle">
                <div class="toggle-switch ${list.enabled ? 'active' : ''}" data-index="${index}"></div>
            </div>
            <div class="list-details">
                <span><strong>Type:</strong> ${list.type}</span>
                <span><strong>Sort:</strong> ${list.sortBy} (${list.sortOrder})</span>
                <span><strong>Order:</strong> ${list.order || index + 1}</span>
            </div>
            <div class="list-actions">
                <button class="btn btn-sm btn-info" onclick="traktConfig.editList(${index})">Edit</button>
                <button class="btn btn-sm btn-danger" onclick="traktConfig.deleteList(${index})">Delete</button>
            </div>
        `;

        // Add toggle event listener
        const toggleSwitch = div.querySelector('.toggle-switch');
        toggleSwitch.addEventListener('click', () => this.toggleList(index));

        return div;
    }

    setupDragAndDrop() {
        const listItems = document.querySelectorAll('.list-item');
        const container = document.getElementById('listsContainer');

        listItems.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                this.draggedElement = item;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                container.classList.remove('drag-over');
                this.draggedElement = null;
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                
                const afterElement = this.getDragAfterElement(container, e.clientY);
                if (afterElement == null) {
                    container.appendChild(this.draggedElement);
                } else {
                    container.insertBefore(this.draggedElement, afterElement);
                }
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                this.updateListOrder();
            });
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            container.classList.add('drag-over');
        });

        container.addEventListener('dragleave', (e) => {
            if (!container.contains(e.relatedTarget)) {
                container.classList.remove('drag-over');
            }
        });
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.list-item:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    updateListOrder() {
        const listItems = document.querySelectorAll('.list-item');
        listItems.forEach((item, index) => {
            const listIndex = parseInt(item.dataset.index);
            this.config.lists[listIndex].order = index + 1;
        });
        
        // Re-render to reflect new order
        this.renderLists();
    }
    // Real-time URL validation
    async validateUrl() {
        const urlInput = document.getElementById('listUrl');
        const feedback = document.getElementById('url-feedback');
        const url = urlInput.value.trim();

        // Clear previous timeout
        if (this.validationTimeout) {
            clearTimeout(this.validationTimeout);
        }

        // Clear feedback if empty
        if (!url) {
            feedback.textContent = '';
            feedback.className = 'validation-feedback';
            return;
        }

        // Show checking state
        feedback.textContent = '⚠ Checking URL...';
        feedback.className = 'validation-feedback checking';

        // Debounce validation
        this.validationTimeout = setTimeout(async () => {
            try {
                const response = await fetch('/api/validate-list', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });

                const result = await response.json();

                if (result.valid) {
                    feedback.innerHTML = `✓ <strong>${result.listName}</strong> (${result.itemCount} items)`;
                    feedback.className = 'validation-feedback valid';
                    
                    // Auto-fill list name if empty
                    const nameInput = document.getElementById('listName');
                    if (!nameInput.value) {
                        nameInput.value = result.listName;
                    }
                } else {
                    feedback.textContent = `✗ ${result.error}`;
                    feedback.className = 'validation-feedback invalid';
                }
            } catch (error) {
                feedback.textContent = '✗ Failed to validate URL';
                feedback.className = 'validation-feedback invalid';
                console.error('URL validation error:', error);
            }
        }, 500);
    }

    // Search and filter functionality
    filterLists() {
        const searchTerm = document.getElementById('listSearch').value.toLowerCase();
        const typeFilter = document.getElementById('typeFilter').value;
        const listItems = document.querySelectorAll('.list-item');

        let visibleCount = 0;

        listItems.forEach(item => {
            const name = item.querySelector('.list-name').textContent.toLowerCase();
            const type = item.dataset.type;
            
            const matchesSearch = !searchTerm || name.includes(searchTerm);
            const matchesType = !typeFilter || type === typeFilter;
            const shouldShow = matchesSearch && matchesType;

            item.style.display = shouldShow ? 'grid' : 'none';
            if (shouldShow) visibleCount++;
        });

        // Show empty state if no results
        const container = document.getElementById('listsContainer');
        let emptyState = container.querySelector('.filter-empty-state');
        
        if (visibleCount === 0 && this.config.lists.length > 0) {
            if (!emptyState) {
                emptyState = document.createElement('div');
                emptyState.className = 'filter-empty-state';
                emptyState.innerHTML = `
                    <h3>No lists match your filters</h3>
                    <p>Try adjusting your search or filter criteria</p>
                `;
                container.appendChild(emptyState);
            }
        } else if (emptyState) {
            emptyState.remove();
        }
    }

    async testBackgroundRefresh() {
    // Prevent rapid multiple clicks
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
        // Re-enable button after 2 seconds
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
            const enabledLists = this.config.lists.filter(list => list.enabled);
            previewGrid.innerHTML = '';

            if (enabledLists.length === 0) {
                previewGrid.innerHTML = `
                    <div class="preview-empty">
                        <h4>No enabled lists</h4>
                        <p>Enable some lists to see the preview</p>
                    </div>`;
                return;
            }

            for (const list of enabledLists) {
                try {
                    const response = await fetch('/api/preview-list', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            listUrl: list.url, 
                            limit: 8,
                            type: list.type,
                            sortBy: list.sortBy,
                            sortOrder: list.sortOrder
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`Failed to fetch preview for ${list.name}`);
                    }

                    const items = await response.json();
                    
                    const listSection = document.createElement('div');
listSection.className = 'preview-list-section';
listSection.innerHTML = `
    <h4>${this.escapeHtml(list.name)}</h4>
    <div class="preview-items">
        ${items.map(item => `
            <div class="preview-item">
                <div class="poster-container">
                    ${item.poster && !item.poster.includes('No Poster Available') 
                        ? `<img src="${item.poster}" alt="${this.escapeHtml(item.name)}" class="poster-image">`
                        : `<div class="poster-placeholder">
                            <div class="placeholder-content">
                                <div class="placeholder-icon">🎬</div>
                                <div class="placeholder-text">${this.escapeHtml(item.name)}</div>
                                <div class="placeholder-year">${item.year || ''}</div>
                            </div>
                           </div>`
                    }
                </div>
                <span class="preview-title">${this.escapeHtml(item.name)}</span>
            </div>
        `).join('')}
    </div>
`;
                    
                    previewGrid.appendChild(listSection);
                } catch (error) {
                    console.error(`Preview failed for ${list.name}:`, error);
                    
                    const errorSection = document.createElement('div');
                    errorSection.className = 'preview-list-section';
                    errorSection.innerHTML = `
                        <h4>${this.escapeHtml(list.name)} <span style="color: var(--danger-color);">(Error)</span></h4>
                        <p style="color: var(--secondary-color);">Failed to load preview</p>
                    `;
                    previewGrid.appendChild(errorSection);
                }
            }
        } catch (error) {
            console.error('Preview generation failed:', error);
            previewGrid.innerHTML = `
                <div class="preview-error">
                    <h4>Preview Error</h4>
                    <p>Failed to generate preview. Please check your configuration.</p>
                </div>`;
        }
    }

    closePreview() {
        document.getElementById('previewPanel').classList.add('hidden');
    }

    // Modal management
    openModal(editIndex = null) {
        const modal = document.getElementById('addListModal');
        const title = document.getElementById('modalTitle');
        const form = document.getElementById('addListForm');
        
        if (editIndex !== null) {
            title.textContent = 'Edit List';
            this.populateForm(this.config.lists[editIndex]);
            form.dataset.editIndex = editIndex;
        } else {
            title.textContent = 'Add New List';
            form.reset();
            delete form.dataset.editIndex;
            document.getElementById('url-feedback').textContent = '';
            document.getElementById('url-feedback').className = 'validation-feedback';
        }
        
        modal.classList.add('show');
        document.getElementById('listUrl').focus();
    }

    closeModal() {
        const modal = document.getElementById('addListModal');
        modal.classList.remove('show');
        
        // Clear validation timeout
        if (this.validationTimeout) {
            clearTimeout(this.validationTimeout);
            this.validationTimeout = null;
        }
    }

    populateForm(list) {
        document.getElementById('listUrl').value = list.url;
        document.getElementById('listName').value = list.name;
        document.getElementById('listType').value = list.type;
        document.getElementById('sortBy').value = list.sortBy || 'rank';
        document.getElementById('sortOrder').value = list.sortOrder || 'asc';
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const listData = {
            url: formData.get('listUrl') || document.getElementById('listUrl').value,
            name: formData.get('listName') || document.getElementById('listName').value,
            type: formData.get('listType') || document.getElementById('listType').value,
            sortBy: formData.get('sortBy') || document.getElementById('sortBy').value,
            sortOrder: formData.get('sortOrder') || document.getElementById('sortOrder').value,
            enabled: true
        };

        const editIndex = e.target.dataset.editIndex;
        
        if (editIndex !== undefined) {
            // Edit existing list
            this.config.lists[parseInt(editIndex)] = {
                ...this.config.lists[parseInt(editIndex)],
                ...listData
            };
        } else {
            // Add new list
            listData.order = this.config.lists.length + 1;
            this.config.lists.push(listData);
        }

        this.closeModal();
        this.renderLists();
        this.showStatus(editIndex !== undefined ? 'List updated' : 'List added', 'success');
    }

    editList(index) {
        this.openModal(index);
    }

    deleteList(index) {
        if (confirm('Are you sure you want to delete this list?')) {
            this.config.lists.splice(index, 1);
            this.renderLists();
            this.showStatus('List deleted', 'success');
        }
    }

    toggleList(index) {
        this.config.lists[index].enabled = !this.config.lists[index].enabled;
        this.renderLists();
    }

    async saveConfig() {
        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.config)
            });

            if (response.ok) {
                this.showStatus('Configuration saved successfully', 'success');
            } else {
                throw new Error('Failed to save configuration');
            }
        } catch (error) {
            this.showStatus('Failed to save configuration', 'error');
            console.error('Save error:', error);
        }
    }

    async refreshAddon() {
        try {
            const response = await fetch('/api/refresh-addon', { method: 'POST' });
            if (response.ok) {
                this.showStatus('Add-on refreshed successfully', 'success');
            } else {
                throw new Error('Failed to refresh add-on');
            }
        } catch (error) {
            this.showStatus('Failed to refresh add-on', 'error');
            console.error('Refresh error:', error);
        }
    }

    async viewManifest() {
        try {
            const response = await fetch('http://localhost:7000/manifest.json');
            const manifest = await response.json();
            
            const newWindow = window.open('', '_blank');
            newWindow.document.write(`
                <html>
                    <head><title>Add-on Manifest</title></head>
                    <body>
                        <h1>Stremio Trakt Add-on Manifest</h1>
                        <pre>${JSON.stringify(manifest, null, 2)}</pre>
                    </body>
                </html>
            `);
        } catch (error) {
            this.showStatus('Failed to load manifest', 'error');
            console.error('Manifest error:', error);
        }
    }

    async initTraktLogin() {
    try {
        // First check if already authenticated
        const authCheck = await fetch('/api/check-auth');
        const authStatus = await authCheck.json();
        
        if (authStatus.authenticated) {
            this.showStatus(`Already authenticated as ${authStatus.user}`, 'success');
            return;
        }

        this.showStatus('Initializing Trakt authentication...', 'info');
        
        const response = await fetch('/auth', { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.device_code) {
            // Open Trakt authentication page
            window.open(data.verification_url, '_blank', 'width=600,height=700');
            
            this.showStatus(`Please enter code: ${data.user_code}`, 'info');
            
            // Start polling for authentication
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
    const maxAttempts = 60; // 5 minutes with 5-second intervals
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
                
                // Update button text or state
                const loginBtn = document.getElementById('traktLoginBtn');
                loginBtn.textContent = 'Authenticated ✓';
                loginBtn.disabled = true;
                return;
            } else if (data.pending) {
                // Still waiting for user authorization
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
    
    // Start polling
    setTimeout(poll, interval * 1000);

    }

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
}

// Initialize the configuration manager
const traktConfig = new StremioTraktConfig();

// Make it globally available for onclick handlers
window.traktConfig = traktConfig;
