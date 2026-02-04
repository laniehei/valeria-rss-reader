// State
let items = [];
let eventSource = null;
let notificationTimeout = null;
let soundEnabled = localStorage.getItem('valeria-sound') !== 'false';
let showProjectEnabled = localStorage.getItem('valeria-show-project') !== 'false';

// DOM elements
const feedList = document.getElementById('feed-list');
const providerSelect = document.getElementById('provider-select');
const notification = document.getElementById('notification');
const connectionStatus = document.getElementById('connection-status');
const itemCount = document.getElementById('item-count');
const loading = document.getElementById('loading');
const empty = document.getElementById('empty');
const feedContainer = document.getElementById('feed-container');
const readerContainer = document.getElementById('reader-container');
const readerTitle = document.getElementById('reader-title');
const readerSource = document.getElementById('reader-source');
const readerDate = document.getElementById('reader-date');
const readerContent = document.getElementById('reader-content');
const readerOriginal = document.getElementById('reader-original');

// Initialize
async function init() {
  await loadProviders();
  await loadFeed();
  connectSSE();
  requestNotificationPermission();
  updateSoundButton();
  updateProjectButton();

  // Provider change handler
  providerSelect.addEventListener('change', loadFeed);
}

// Toggle sound on/off
function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('valeria-sound', soundEnabled);
  updateSoundButton();
}

// Update sound button display
function updateSoundButton() {
  const btn = document.getElementById('sound-btn');
  btn.textContent = soundEnabled ? '🔔' : '🔕';
  btn.title = soundEnabled ? 'Sound on (click to mute)' : 'Sound off (click to unmute)';
}

// Toggle project name display
function toggleProject() {
  showProjectEnabled = !showProjectEnabled;
  localStorage.setItem('valeria-show-project', showProjectEnabled);
  updateProjectButton();
}

// Update project button display
function updateProjectButton() {
  const btn = document.getElementById('project-btn');
  btn.textContent = showProjectEnabled ? '📁' : '📁';
  btn.style.opacity = showProjectEnabled ? '1' : '0.5';
  btn.title = showProjectEnabled ? 'Project name shown (click to hide)' : 'Project name hidden (click to show)';
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
      (item, index) => `
    <li class="feed-item ${item.read ? 'read' : ''}" data-id="${item.id}" onclick="openReader(${index})">
      <div class="feed-item-source">${escapeHtml(item.source)}</div>
      <div class="feed-item-title">${escapeHtml(item.title)}</div>
      ${item.summary ? `<div class="feed-item-summary">${escapeHtml(item.summary)}</div>` : ''}
      <div class="feed-item-meta">
        <time datetime="${item.publishedAt}">${formatDate(item.publishedAt)}</time>
        ${item.author ? ` · ${escapeHtml(item.author)}` : ''}
      </div>
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
    // Debounce - wait 2s to coalesce multiple rapid events
    scheduleNotification(data);
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

// Debounce notification - wait before showing to coalesce rapid events
let pendingNotification = null;
let debounceTimeout = null;

function scheduleNotification(data) {
  // Store the data (prefer 'stop' over others)
  if (!pendingNotification || data.event === 'stop' || data.event === 'Stop') {
    pendingNotification = data;
  }

  // Reset debounce timer
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }

  // Wait 2 seconds before showing
  debounceTimeout = setTimeout(() => {
    showNotification(pendingNotification);
    pendingNotification = null;
    debounceTimeout = null;
  }, 2000);
}

// Show notification
function showNotification(data) {
  // Clear any existing timeout
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
  }

  // Build notification message
  const project = data?.project || '';
  const event = data?.event || 'ready';
  let message = 'Claude is ready';
  if (event === 'attention_needed') {
    message = 'Claude needs attention';
  }

  // Update notification text
  const textEl = notification.querySelector('.notification-text');
  const projectEl = notification.querySelector('.notification-project');
  textEl.textContent = message;
  projectEl.textContent = (showProjectEnabled && project) ? project : '';

  // Show notification
  notification.classList.remove('hidden');
  // Force reflow for animation
  notification.offsetHeight;
  notification.classList.add('show');

  // Play sound
  playNotificationSound();

  // Show system notification if tab is hidden
  if (document.hidden) {
    const fullMessage = (showProjectEnabled && project) ? `${message} · ${project}` : message;
    showSystemNotification(fullMessage);
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
    new Notification('Valeria', {
      body,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏛️</text></svg>',
      tag: 'claude-ready',
    });
  }
}

// Play notification sound - gentle bird chirp
function playNotificationSound() {
  if (!soundEnabled) return;
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Bird-like chirp: quick ascending notes with natural decay
    const chirps = [
      { freq: 1800, time: 0, duration: 0.08 },
      { freq: 2200, time: 0.1, duration: 0.1 },
      { freq: 2600, time: 0.22, duration: 0.15 },
    ];

    chirps.forEach(({ freq, time, duration }) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = freq;
      oscillator.type = 'sine';

      // Quick attack, gentle decay (bird-like)
      const startTime = audioContext.currentTime + time;
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.06, startTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    });
  } catch (err) {
    // Audio not supported
  }
}

// Open article in reader view
function openReader(index) {
  const item = items[index];
  if (!item) return;

  // Mark as read
  markAsRead(item.id);

  // Populate reader
  readerTitle.textContent = item.title || 'Untitled';
  readerSource.textContent = item.source || '';
  readerDate.textContent = formatDate(item.publishedAt);
  readerOriginal.href = item.url;

  // Use content if available, otherwise summary
  const readMoreLink = `<p class="read-more"><a href="${escapeHtml(item.url)}" target="_blank">Continue reading on original site ↗</a></p>`;

  if (item.content && item.content !== item.summary) {
    // Full content available - still add link to original
    readerContent.innerHTML = item.content + readMoreLink;
  } else if (item.summary) {
    // Only summary available
    readerContent.innerHTML = `<p>${escapeHtml(item.summary)}</p>` + readMoreLink;
  } else {
    // No content at all
    readerContent.innerHTML = `<p>No content available.</p>` + readMoreLink;
  }

  // Show reader, hide feed
  feedContainer.classList.add('hidden');
  readerContainer.classList.remove('hidden');

  // Scroll to top
  window.scrollTo(0, 0);
}

// Close reader view
function closeReader() {
  readerContainer.classList.add('hidden');
  feedContainer.classList.remove('hidden');
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
