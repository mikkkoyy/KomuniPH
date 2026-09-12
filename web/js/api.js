/**
 * KomuniPH Lite - API Client
 * Fetch wrapper for API calls
 */

const API_BASE = '/api';

let accessToken = null;
let refreshToken = null;
let currentUserProfile = null;

/**
 * Set auth tokens
 */
export function setTokens(access, refresh) {
  accessToken = access;
  refreshToken = refresh;
}

/**
 * Clear auth tokens
 */
export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  currentUserProfile = null;
}

/**
 * Get current access token
 */
export function getAccessToken() {
  return accessToken;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
  return !!accessToken;
}

/**
 * Get cached current user profile
 */
export function getCurrentUserProfile() {
  return currentUserProfile;
}

/**
 * Set cached current user profile
 */
export function setCurrentUserProfile(profile) {
  currentUserProfile = profile;
}

/**
 * Fetch and cache current user profile
 */
export async function fetchCurrentUserProfile() {
  const profile = await apiRequest('/profile');
  setCurrentUserProfile(profile);
  return profile;
}

/**
 * Make an API request
 */
export async function apiRequest(path, options = {}) {
  const { method = 'GET', body } = options;

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const requestInit = {
    method,
    headers,
  };

  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${path}`, requestInit);

  const contentType = response.headers.get('content-type') || '';
  const hasJsonBody = contentType.includes('application/json');
  const parsedBody = hasJsonBody ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const error = new Error(parsedBody?.error?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.body = parsedBody;
    throw error;
  }

  return parsedBody;
}

/**
 * Auth API
 */
export const authApi = {
  async login(email, password) {
    const response = await apiRequest('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setTokens(response.access_token, response.refresh_token);
    return response;
  },

  async register(email, username, password) {
    const response = await apiRequest('/auth/register', {
      method: 'POST',
      body: { email, username, password },
    });
    setTokens(response.access_token, response.refresh_token);
    return response;
  },

  async forgotPassword(email) {
    return apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });
  },

  async resetPassword(token, password, passwordConfirmation) {
    return apiRequest('/auth/reset-password', {
      method: 'POST',
      body: { token, password, password_confirmation: passwordConfirmation },
    });
  },

  logout() {
    clearTokens();
  },
};

/**
 * Profile API
 */
export const profileApi = {
  async getOwnProfile() {
    return apiRequest('/profile');
  },

  async updateProfile(data) {
    return apiRequest('/profile', {
      method: 'PATCH',
      body: data,
    });
  },

  async updateTheme(data) {
    return apiRequest('/profile/theme', {
      method: 'PATCH',
      body: data,
    });
  },

  async uploadPhoto(file) {
    const formData = new FormData();
    formData.append('photo', file);

    const headers = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${API_BASE}/profile/photo`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const contentType = response.headers.get('content-type') || '';
    const hasJsonBody = contentType.includes('application/json');
    const parsedBody = hasJsonBody ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      const error = new Error(parsedBody?.error?.message || `Upload failed with status ${response.status}`);
      error.status = response.status;
      error.body = parsedBody;
      throw error;
    }

    return parsedBody;
  },

  async uploadBackground(file) {
    const formData = new FormData();
    formData.append('background', file);

    const headers = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${API_BASE}/profile/background`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const contentType = response.headers.get('content-type') || '';
    const hasJsonBody = contentType.includes('application/json');
    const parsedBody = hasJsonBody ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      const error = new Error(parsedBody?.error?.message || `Upload failed with status ${response.status}`);
      error.status = response.status;
      error.body = parsedBody;
      throw error;
    }

    return parsedBody;
  },
};

/**
 * Messages API
 */
export const messagesApi = {
  async createConversation(userId) {
    return apiRequest('/messages/conversations', {
      method: 'POST',
      body: { user_id: userId },
    });
  },

  async getConversations(limit = 20, offset = 0) {
    return apiRequest(`/messages/conversations?limit=${limit}&offset=${offset}`);
  },

  async getMessages(conversationId, limit = 50, offset = 0) {
    return apiRequest(`/messages/conversations/${conversationId}/messages?limit=${limit}&offset=${offset}`);
  },

  async sendMessage(conversationId, body) {
    return apiRequest(`/messages/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: { body },
    });
  },

  async getUnreadCount() {
    return apiRequest('/messages/unread-count');
  },

  async markConversationRead(conversationId) {
    return apiRequest(`/messages/conversations/${conversationId}/read`, {
      method: 'POST',
    });
  },
};

/**
 * Feed API
 */
export const feedApi = {
  async getFeed(limit = 20, offset = 0) {
    return apiRequest(`/feed?limit=${limit}&offset=${offset}`);
  },

  async createPost(content) {
    return apiRequest('/feed/posts', {
      method: 'POST',
      body: { content },
    });
  },

  async updatePost(postId, content) {
    return apiRequest(`/feed/posts/${postId}`, {
      method: 'PATCH',
      body: { content },
    });
  },

  async deletePost(postId) {
    return apiRequest(`/feed/posts/${postId}`, {
      method: 'DELETE',
    });
  },

  async likePost(postId) {
    return apiRequest(`/feed/posts/${postId}/like`, {
      method: 'POST',
    });
  },

  async unlikePost(postId) {
    return apiRequest(`/feed/posts/${postId}/like`, {
      method: 'DELETE',
    });
  },

  async getComments(postId, limit = 20, offset = 0) {
    return apiRequest(`/feed/posts/${postId}/comments?limit=${limit}&offset=${offset}`);
  },

  async createComment(postId, content) {
    return apiRequest(`/feed/posts/${postId}/comments`, {
      method: 'POST',
      body: { content },
    });
  },

  async deleteComment(commentId) {
    return apiRequest(`/feed/comments/${commentId}`, {
      method: 'DELETE',
    });
  },
};
