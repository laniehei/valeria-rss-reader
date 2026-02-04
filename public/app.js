// State
let items = [];
let eventSource = null;
let notificationTimeout = null;

// DOM elements
const feedList = document.getElementById('feed-list');
const providerSelect = document.getElementById('provider-select');
const notification = document.getElementById('notification');
const connectionStatus = document.getElementById('connection-status');
const itemCount = document.getElementById('item-count');
const loading = document.getElementById('loading');
const empty = document.getElementById('empty');

// Initialize
async function init() {
  await loadProviders();
  await loadFeed();
  connectSSE();
  requestNotificationPermission();

  // Provider change handler
  providerSelect.addEventListener('change', loadFeed);
}

// Request browser notification permission
async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

// Load available providers
async function loadProviders() {
  try {
    const res = await fetch('/api/providers');
    const data = await res.json();

    data.providers.forEach((provider) => {
      const option = document.createElement('option');
      option.value = provider.name;
      option.textContent = provider.name.charAt(0).toUpperCase() + provider.name.slice(1);
      providerSelect.appendChild(option);
    });
  } catch (err) {
    console.error('Failed to load providers:', err);
  }
}

// Load feed items
async function loadFeed() {
  loading.classList.remove('hidden');
  empty.classList.add('hidden');
  feedList.innerHTML = '';

  try {
    const provider = providerSelect.value;
    const url = `/api/feed?limit=50${provider ? `&provider=${provider}` : ''}`;
    const res = await fetch(url);
    const data = await res.json();

    items = data.items || [];
    renderFeed();
  } catch (err) {
    console.error('Failed to load feed:', err);
    empty.textContent = 'Failed to load feed. Check console for details.';
    empty.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
  }
}

// Render feed items
function renderFeed() {
  if (items.length === 0) {
    empty.classList.remove('hidden');
    feedList.innerHTML = '';
    itemCount.textContent = '0 items';
    return;
  }

  empty.classList.add('hidden');
  itemCount.textContent = `${items.length} items`;

  feedList.innerHTML = items
    .map(
      (item) => `
    <li class="feed-item ${item.read ? 'read' : ''}" data-id="${item.id}">
      <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" onclick="markAsRead('${item.id}')">
        <div class="feed-item-source">${escapeHtml(item.source)}</div>
        <div class="feed-item-title">${escapeHtml(item.title)}</div>
        ${item.summary ? `<div class="feed-item-summary">${escapeHtml(item.summary)}</div>` : ''}
        <div class="feed-item-meta">
          <time datetime="${item.publishedAt}">${formatDate(item.publishedAt)}</time>
          ${item.author ? ` · ${escapeHtml(item.author)}` : ''}
        </div>
      </a>
    </li>
  `
    )
    .join('');
}

// Connect to Server-Sent Events
function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/events');

  eventSource.addEventListener('connected', (e) => {
    connectionStatus.textContent = '● Connected';
    connectionStatus.classList.add('connected');
    console.log('SSE connected:', JSON.parse(e.data));
  });

  eventSource.addEventListener('claude_ready', (e) => {
    const data = JSON.parse(e.data);
    console.log('Claude ready event:', data);
    showNotification(data.event);
  });

  eventSource.addEventListener('heartbeat', () => {
    // Connection is alive
  });

  eventSource.onerror = () => {
    connectionStatus.textContent = '○ Disconnected';
    connectionStatus.classList.remove('connected');

    // Reconnect after delay
    setTimeout(connectSSE, 5000);
  };
}

// Show notification
function showNotification(event) {
  // Clear any existing timeout
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
  }

  // Update notification text based on event type
  const textEl = notification.querySelector('.notification-text');
  if (event === 'Stop' || event === 'stop') {
    textEl.textContent = 'Claude is ready!';
  } else if (event === 'Notification' || event === 'attention_needed') {
    textEl.textContent = 'Claude needs your attention';
  } else {
    textEl.textContent = 'Claude notification';
  }

  // Show notification
  notification.classList.remove('hidden');
  // Force reflow for animation
  notification.offsetHeight;
  notification.classList.add('show');

  // Play sound
  playNotificationSound();

  // Show system notification if tab is hidden
  if (document.hidden) {
    showSystemNotification(textEl.textContent);
  }

  // Auto-dismiss after 10 seconds
  notificationTimeout = setTimeout(dismissNotification, 10000);
}

// Dismiss notification
function dismissNotification() {
  notification.classList.remove('show');

  // Hide after animation
  setTimeout(() => {
    notification.classList.add('hidden');
  }, 300);

  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
    notificationTimeout = null;
  }
}

// Show system notification
function showSystemNotification(body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Claude RSS Reader', {
      body,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🤖</text></svg>',
      tag: 'claude-ready',
    });
  }
}

// Play notification sound
function playNotificationSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.1;

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.15);
  } catch (err) {
    // Audio not supported
  }
}

// Mark item as read
async function markAsRead(id) {
  try {
    await fetch(`/api/feed/${encodeURIComponent(id)}/read`, { method: 'POST' });

    // Update local state
    const item = items.find((i) => i.id === id);
    if (item) item.read = true;

    // Update UI
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.add('read');
  } catch (err) {
    console.error('Failed to mark as read:', err);
  }
}

// Refresh feed
async function refreshFeed() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = '↻ Refreshing...';

  try {
    await fetch('/api/feed/refresh', { method: 'POST' });
    await loadFeed();
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Refresh';
  }
}

// Utility: Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Utility: Format date
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

// Start app
init();
