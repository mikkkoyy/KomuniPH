/**
 * KomuniPH Lite - Messages UI
 * Conversation list and chat view.
 */

import { messagesApi, authApi, isAuthenticated } from './api.js';
import { navigate } from './app.js';

let conversationsData = { conversations: [], limit: 20, offset: 0, has_more: false };
let messagesData = { messages: [], limit: 50, offset: 0, has_more: false };
let selectedConversationId = null;
let currentConversationOffset = 0;
let globalUnreadCount = 0;
let pollTimer = null;
let lastKnownMessageId = null;
let knownLatestCreatedAt = null;
let hasNewMessagesIndicator = false;

const POLL_INTERVAL_MS = 7000;

/**
 * Format timestamp to relative time
 */
function formatTimestamp(iso) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 24 && diffDays === 0) {
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    if (diffMinutes < 60) return `${diffMinutes}m`;
    return `${Math.floor(diffHours)}h`;
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Create avatar HTML
 */
function createAvatar(username, displayName, photoUrl, size = 2.5) {
  if (photoUrl) {
    return `<img src="${photoUrl}" alt="${displayName}" class="avatar" style="width:${size}rem;height:${size}rem">`;
  }
  const initials = (displayName || username || '?').charAt(0).toUpperCase();
  return `<div class="avatar" style="width:${size}rem;height:${size}rem">${initials}</div>`;
}

/**
 * Escape HTML
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Show a brief toast notification.
 */
function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

/**
 * Update the Messages nav badge in the left sidebar (SOCIAL-01) and
 * the messages page header with the current global unread count.
 */
function updateSidebarBadge(count) {
  globalUnreadCount = count;

  const sidebarBadge = document.getElementById('sidebar-messages-badge');
  if (sidebarBadge) {
    sidebarBadge.textContent = count > 0 ? String(count) : '';
    sidebarBadge.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  const pageBadge = document.getElementById('messages-page-unread-badge');
  if (pageBadge) {
    pageBadge.textContent = count > 0 ? String(count) : '';
    pageBadge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

/**
 * Refresh the global unread count from the API.
 */
export async function refreshUnreadCount() {
  try {
    const data = await messagesApi.getUnreadCount();
    updateSidebarBadge(data.unread_count || 0);
  } catch (err) {
    console.error('Failed to refresh unread count:', err);
  }
}

/**
 * Render the messages page — conversation list + chat view.
 */
export function renderMessagesPage() {
  if (!isAuthenticated()) {
    navigate('/login');
    return '';
  }

  return `
    <div class="app-layout">
      <!-- Conversation List -->
      <aside class="messages-sidebar" aria-label="Conversations">
        <header class="messages-sidebar-header">
          <button type="button" class="messages-back-home" id="messages-back-home" aria-label="Back to Home">← Back to Home</button>
          <h1>Messages <span id="messages-page-unread-badge" class="unread-badge" style="display:none"></span></h1>
        </header>
        <div id="conversations-loading" class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Loading conversations...</p>
        </div>
        <div id="conversations-content" style="display:none"></div>
        <div id="conversations-empty" class="empty-state" style="display:none">
          <p class="empty-text">No conversations yet.</p>
        </div>
        <div id="conversations-error" class="error-state" style="display:none">
          <p class="error-message"></p>
          <button class="btn btn-secondary" onclick="window.loadConversations()">Retry</button>
        </div>
      </aside>

      <!-- Chat View -->
      <main class="messages-chat" id="messages-chat">
        <div id="chat-placeholder" class="messages-chat-placeholder">
          <p>Select a conversation to start messaging.</p>
        </div>
        <div id="chat-view" style="display:none"></div>
      </main>
    </div>
  `;
}

/**
 * Render a single conversation row in the list.
 */
function renderConversationItem(conversation) {
  const other = conversation.other_user || {};
  const displayName = other.display_name || other.username || 'Unknown';
  const lastMsg = conversation.last_message;
  const lastText = lastMsg ? lastMsg.body : 'No messages yet';
  const lastTime = lastMsg ? formatTimestamp(lastMsg.created_at) : '';
  const preview = lastText.length > 40 ? lastText.slice(0, 40) + '...' : lastText;
  const unreadCount = conversation.unread_count || 0;
  const isUnread = unreadCount > 0;

  return `
    <button class="conversation-item ${selectedConversationId === conversation.id ? 'active' : ''} ${isUnread ? 'unread' : ''}"
            data-conversation-id="${conversation.id}"
            type="button">
      ${createAvatar(other.username, displayName, other.profile_photo_url, 2.25)}
      <div class="conversation-item-info">
        <p class="conversation-item-name">${escapeHtml(displayName)}</p>
        <p class="conversation-item-preview">${escapeHtml(preview)}</p>
      </div>
      ${isUnread ? `<span class="conversation-unread-badge">${unreadCount}</span>` : ''}
      ${lastTime ? `<span class="conversation-item-time">${escapeHtml(lastTime)}</span>` : ''}
    </button>
  `;
}

/**
 * Load conversations list.
 */
window.loadConversations = async function() {
  const loading = document.getElementById('conversations-loading');
  const content = document.getElementById('conversations-content');
  const empty = document.getElementById('conversations-empty');
  const error = document.getElementById('conversations-error');

  if (!loading) return;

  loading.style.display = 'block';
  content.style.display = 'none';
  empty.style.display = 'none';
  error.style.display = 'none';

  try {
    const data = await messagesApi.getConversations(20, 0);
    conversationsData = data;

    if (data.conversations.length === 0) {
      loading.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    content.innerHTML = data.conversations
      .map(renderConversationItem)
      .join('');
    loading.style.display = 'none';
    content.style.display = 'block';

    content.querySelectorAll('.conversation-item').forEach((item) => {
      item.addEventListener('click', () => {
        const cid = item.dataset.conversationId;
        selectConversation(cid);
      });
    });

    refreshUnreadCount();
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent = err.message || 'Failed to load conversations';
    error.style.display = 'block';
  }
};

/**
 * Select a conversation and load its messages.
 */
async function selectConversation(conversationId) {
  // Stop previous polling
  stopPolling();
  hasNewMessagesIndicator = false;

  selectedConversationId = conversationId;
  currentConversationOffset = 0;
  messagesData = { messages: [], limit: 50, offset: 0, has_more: false };
  lastKnownMessageId = null;
  knownLatestCreatedAt = null;

  document.querySelectorAll('.conversation-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.conversationId === conversationId);
  });

  const placeholder = document.getElementById('chat-placeholder');
  const chatView = document.getElementById('chat-view');
  placeholder.style.display = 'none';
  chatView.style.display = 'block';

  await loadMessages(conversationId);

  try {
    await messagesApi.markConversationRead(conversationId);
    const conv = conversationsData.conversations.find((c) => c.id === conversationId);
    if (conv) conv.unread_count = 0;
    renderConversationList();
    refreshUnreadCount();
  } catch (err) {
    console.error('Failed to mark conversation as read:', err);
  }

  startPolling(conversationId);
}

/**
 * Re-render just the conversation list from current conversationsData.
 */
function renderConversationList() {
  const content = document.getElementById('conversations-content');
  if (!content) return;
  content.innerHTML = conversationsData.conversations
    .map(renderConversationItem)
    .join('');
  content.querySelectorAll('.conversation-item').forEach((item) => {
    item.addEventListener('click', () => {
      const cid = item.dataset.conversationId;
      selectConversation(cid);
    });
  });
}

/**
 * Scroll the chat messages container to the bottom.
 */
function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

/**
 * Check if the user is near the bottom of the chat.
 */
function isNearBottom(threshold = 120) {
  const container = document.getElementById('chat-messages');
  if (!container) return true;
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

/**
 * Show the "new messages" indicator.
 */
function showNewMessagesIndicator(count) {
  if (hasNewMessagesIndicator) return;
  hasNewMessagesIndicator = true;

  let indicator = document.getElementById('new-messages-indicator');
  if (!indicator) {
    indicator = document.createElement('button');
    indicator.id = 'new-messages-indicator';
    indicator.className = 'new-messages-indicator';
    indicator.type = 'button';
    indicator.innerHTML = '↓ New messages';
    indicator.addEventListener('click', () => {
      hideNewMessagesIndicator();
      scrollToBottom();
    });
  }
  indicator.textContent = count > 1 ? `↓ ${count} new messages` : '↓ New message';
  indicator.style.display = 'block';

  const chatView = document.getElementById('chat-view');
  if (chatView && !document.getElementById('new-messages-indicator')) {
    chatView.appendChild(indicator);
  }
}

/**
 * Hide the "new messages" indicator.
 */
function hideNewMessagesIndicator() {
  hasNewMessagesIndicator = false;
  const indicator = document.getElementById('new-messages-indicator');
  if (indicator) {
    indicator.remove();
  }
}

/**
 * Load messages for the selected conversation.
 */
async function loadMessages(conversationId, append = false) {
  const chatView = document.getElementById('chat-view');
  if (!append) {
    chatView.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <p class="loading-text">Loading messages...</p>
      </div>
    `;
  }

  try {
    const data = await messagesApi.getMessages(conversationId, 50, currentConversationOffset);
    messagesData = data;

    const otherUser = findOtherUser(conversationId);
    const otherName = otherUser ? (otherUser.display_name || otherUser.username) : 'Conversation';
    const otherAlias = otherUser && otherUser.alias_enabled && otherUser.alias ? otherUser.alias : null;
    const hasMessages = data.messages && data.messages.length > 0;

    if (!append) {
      lastKnownMessageId = hasMessages ? data.messages[data.messages.length - 1].id : null;
      knownLatestCreatedAt = hasMessages ? data.messages[data.messages.length - 1].created_at : null;
    }

    const olderDisabled = currentConversationOffset === 0 && !data.has_more;
    const olderHidden = currentConversationOffset === 0 && !data.has_more;

    let html = `
      <header class="chat-header">
        <button class="chat-back-btn" id="chat-back-btn" type="button" aria-label="Back to conversations">← Back</button>
        <div class="chat-header-user">
          ${createAvatar(otherUser?.username, otherName, otherUser?.profile_photo_url, 2)}
          <div class="chat-header-info">
            <span class="chat-header-name">${escapeHtml(otherName)}</span>
            ${otherAlias ? `<span class="chat-header-alias">@${escapeHtml(otherAlias)}</span>` : ''}
          </div>
        </div>
      </header>
    `;

    if (!hasMessages && !append) {
      html += `
        <div class="chat-empty-state">
          <p>No messages yet.</p>
          <p class="chat-empty-sub">Start the conversation.</p>
        </div>
      `;
    }

    if (!olderHidden) {
      html += `
        <div class="chat-older-messages" id="chat-older-messages">
          ${olderDisabled
            ? '<span class="chat-older-disabled">No older messages</span>'
            : `<button class="chat-older-btn" id="chat-older-btn" type="button">Load older messages</button>`
          }
        </div>
      `;
    }

    if (hasMessages) {
      html += `
        <div class="chat-messages" id="chat-messages">
          ${data.messages.map((msg) => renderMessageBubble(msg)).join('')}
        </div>
      `;
    }

    html += `
      <form class="chat-input-form" id="chat-form" onsubmit="window.submitChatMessage(event, '${conversationId}')">
        <textarea id="chat-message-input" placeholder="Type a message..." rows="1" autocomplete="off"></textarea>
        <button type="submit" class="btn btn-primary" id="chat-send-btn">Send</button>
      </form>
    `;

    chatView.innerHTML = html;

    if (hasMessages) {
      const messagesContainer = document.getElementById('chat-messages');
      if (!append) {
        requestAnimationFrame(() => {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
      } else {
        preserveScrollOnOlderLoad();
      }
    }

    const backBtn = document.getElementById('chat-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        stopPolling();
        selectedConversationId = null;
        hasNewMessagesIndicator = false;
        chatView.style.display = 'none';
        document.getElementById('chat-placeholder').style.display = 'flex';
        document.querySelectorAll('.conversation-item').forEach((item) => {
          item.classList.remove('active');
        });
      });
    }

    const olderBtn = document.getElementById('chat-older-btn');
    if (olderBtn) {
      olderBtn.addEventListener('click', () => loadOlderMessages(conversationId));
    }

    setupComposer(conversationId);
  } catch (err) {
    chatView.innerHTML = `
      <div class="error-state">
        <p class="error-message">${escapeHtml(err.message || 'Failed to load messages')}</p>
        <button class="btn btn-secondary" onclick="window.loadMessages('${conversationId}')">Retry</button>
      </div>
    `;
  }
}

/**
 * Load older messages and prepend them while preserving scroll position.
 */
async function loadOlderMessages(conversationId) {
  const olderBtn = document.getElementById('chat-older-btn');
  if (olderBtn) {
    olderBtn.textContent = 'Loading...';
    olderBtn.disabled = true;
  }

  currentConversationOffset += messagesData.limit;

  try {
    await loadMessages(conversationId, true);
    renderConversationList();
  } catch (err) {
    currentConversationOffset -= messagesData.limit;
    showToast(err.message || 'Failed to load older messages');
  }
}

/**
 * Preserve scroll position after prepending older messages.
 */
function preserveScrollOnOlderLoad() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const previousScrollHeight = container.scrollHeight;
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight - previousScrollHeight;
  });
}

/**
 * Set up composer behavior: Enter sends, Shift+Enter inserts newline.
 */
function setupComposer(conversationId) {
  const textarea = document.getElementById('chat-message-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (!textarea) return;

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (textarea.value.trim()) {
        submitChatMessage(new Event('submit'), conversationId);
      }
    }
  });

  if (sendBtn) {
    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (textarea.value.trim()) {
        submitChatMessage(new Event('submit'), conversationId);
      }
    });
  }

  textarea.focus();
}

/**
 * Find the other user in a conversation.
 */
function findOtherUser(conversationId) {
  const conv = conversationsData.conversations.find((c) => c.id === conversationId);
  return conv ? conv.other_user : null;
}

/**
 * Render a single message bubble.
 */
function renderMessageBubble(message) {
  const isMine = message.is_current_user_sender;
  const authorName = message.author?.display_name || message.author?.username || 'Unknown';

  return `
    <div class="chat-bubble-row ${isMine ? 'mine' : 'theirs'}">
      ${!isMine ? createAvatar(message.author?.username, authorName, message.author?.profile_photo_url, 1.75) : ''}
      <div class="chat-bubble ${isMine ? 'mine' : 'theirs'}">
        ${!isMine ? `<p class="chat-bubble-author">${escapeHtml(authorName)}</p>` : ''}
        <p class="chat-bubble-body">${escapeHtml(message.body)}</p>
        <span class="chat-bubble-time">${formatTimestamp(message.created_at)}</span>
      </div>
    </div>
  `;
}

/**
 * Submit a new message.
 */
window.submitChatMessage = async function(event, conversationId) {
  event.preventDefault();
  const input = document.getElementById('chat-message-input');
  const body = input.value.trim();

  if (!body) return;

  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
  }

  try {
    const message = await messagesApi.sendMessage(conversationId, body);
    input.value = '';

    messagesData.messages = [...messagesData.messages, message];
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
      messagesContainer.insertAdjacentHTML(
        'beforeend',
        renderMessageBubble(message)
      );
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    lastKnownMessageId = message.id;
    knownLatestCreatedAt = message.created_at;

    renderConversationList();
    refreshUnreadCount();
  } catch (err) {
    showToast(err.message || 'Failed to send message');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
    const inputEl = document.getElementById('chat-message-input');
    if (inputEl) inputEl.focus();
  }
};

/**
 * Start polling for new messages in the active conversation.
 */
function startPolling(conversationId) {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!conversationId || selectedConversationId !== conversationId) {
      stopPolling();
      return;
    }

    try {
      const data = await messagesApi.getMessages(conversationId, 50, 0);
      const remoteMessages = data.messages;
      const remoteLatest = remoteMessages.length > 0 ? remoteMessages[remoteMessages.length - 1] : null;
      const remoteLatestId = remoteLatest ? remoteLatest.id : null;
      const remoteLatestAt = remoteLatest ? remoteLatest.created_at : null;

      if (!remoteLatestId) return;

      const localLatest = messagesData.messages.length > 0
        ? messagesData.messages[messagesData.messages.length - 1]
        : null;
      const localLatestId = localLatest ? localLatest.id : null;

      if (remoteLatestId !== localLatestId) {
        const newMessages = localLatestId
          ? remoteMessages.filter((m) => {
              const localIdx = messagesData.messages.findIndex((lm) => lm.id === m.id);
              return localIdx === -1;
            })
          : remoteMessages;

        if (newMessages.length === 0) return;

        messagesData.messages = remoteMessages;
        messagesData = { ...messagesData, has_more: data.has_more };

        const container = document.getElementById('chat-messages');
        if (!container) return;

        if (isNearBottom()) {
          container.innerHTML = remoteMessages.map((msg) => renderMessageBubble(msg)).join('');
          scrollToBottom();
          hideNewMessagesIndicator();
          lastKnownMessageId = remoteLatestId;
          knownLatestCreatedAt = remoteLatestAt;
        } else {
          showNewMessagesIndicator(newMessages.length);
          lastKnownMessageId = remoteLatestId;
          knownLatestCreatedAt = remoteLatestAt;
        }

        renderConversationList();
        refreshUnreadCount();
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the active polling timer.
 */
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Initialize messages page.
 */
export function initMessagesPage() {
  const backHomeBtn = document.getElementById('messages-back-home');
  if (backHomeBtn) {
    backHomeBtn.addEventListener('click', () => {
      destroyMessagesPage();
      navigate('/home');
    });
  }

  window.loadConversations();
  refreshUnreadCount();
}

/**
 * Cleanup when leaving the messages page.
 */
export function destroyMessagesPage() {
  stopPolling();
  hasNewMessagesIndicator = false;
  selectedConversationId = null;
}
