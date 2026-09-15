/**
 * KomuniPH Lite - API Client
 * Fetch wrapper for API calls
 */

const API_BASE = '/api';
const TOKEN_STORAGE_KEY = 'komuniph_auth_tokens';

let accessToken = null;
let refreshToken = null;
let currentUserProfile = null;

/**
 * Restore auth tokens from localStorage into memory.
 * Safe to call on every page load; returns true if tokens were found.
 */
export function restoreTokens() {
  try {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.access) {
        accessToken = parsed.access;
        refreshToken = parsed.refresh || null;
        return true;
      }
    }
  } catch (e) {
    console.warn('[AUTH] Failed to restore tokens from localStorage:', e);
  }
  return false;
}

/**
 * Set auth tokens (in memory + localStorage)
 */
export function setTokens(access, refresh) {
  accessToken = access;
  refreshToken = refresh;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ access, refresh }));
  } catch (e) {
    console.warn('[AUTH] Failed to persist tokens to localStorage:', e);
  }
}

/**
 * Clear auth tokens (from memory + localStorage)
 */
export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  currentUserProfile = null;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch (e) {
    console.warn('[AUTH] Failed to clear tokens from localStorage:', e);
  }
}

/**
 * Initialize authentication on app load.
 * Restores tokens from localStorage and verifies the access token
 * by fetching the current user profile. Resolves to true if the user
 * is authenticated, false otherwise.
 */
export async function initAuth() {
  restoreTokens();
  if (!isAuthenticated()) {
    return false;
  }
  try {
    const profile = await apiRequest('/profile');
    setCurrentUserProfile(profile);
    return true;
  } catch (err) {
    console.warn('[AUTH] Session check failed, clearing tokens:', err.message || err);
    clearTokens();
    return false;
  }
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
    cache: 'no-store',
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
  async login(identifier, password) {
    const response = await apiRequest('/auth/login', {
      method: 'POST',
      body: { identifier, password },
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

  async getPublicProfile(username) {
    return apiRequest(`/profile/${username}`);
  },

  async getLocations() {
    return apiRequest('/locations');
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

/**
 * Testimonials API
 */
export const testimonialsApi = {
  async getTestimonials(username, limit = 50, offset = 0) {
    return apiRequest(`/profiles/${username}/testimonials?limit=${limit}&offset=${offset}`);
  },

  async createTestimonial(targetUsername, message) {
    return apiRequest('/testimonials', {
      method: 'POST',
      body: { target_username: targetUsername, message },
    });
  },

  async deleteTestimonial(testimonialId) {
    return apiRequest(`/testimonials/${testimonialId}`, {
      method: 'DELETE',
    });
  },
};

/**
 * Photo Gallery API
 */
export const galleryApi = {
  async getPhotos(username, limit = 50, offset = 0) {
    return apiRequest(`/profiles/${username}/photos?limit=${limit}&offset=${offset}`);
  },

  async getOwnPhotos(limit = 50, offset = 0) {
    return apiRequest(`/profile/photos?limit=${limit}&offset=${offset}`);
  },

  async uploadPhoto(file, albumId = null) {
    const formData = new FormData();
    formData.append('photo', file);
    if (albumId) {
      formData.append('album_id', albumId);
    }

    const headers = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${API_BASE}/profile/photos`, {
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

  async uploadPhotos(files, albumId = null) {
    const formData = new FormData();
    for (const file of files) {
      formData.append('photo', file);
    }
    if (albumId) {
      formData.append('album_id', albumId);
    }

    const headers = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${API_BASE}/profile/photos`, {
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

  async deletePhoto(photoId) {
    return apiRequest(`/profile/photos/${photoId}`, {
      method: 'DELETE',
    });
  },
};

/**
 * Album API
 */
export const albumsApi = {
  async getOwnAlbums() {
    return apiRequest('/profile/albums');
  },

  async getAlbums(username) {
    return apiRequest(`/profiles/${username}/albums`);
  },

  async getAlbum(username, albumId) {
    return apiRequest(`/profiles/${username}/albums/${albumId}`);
  },

  async createAlbum(name, description = '', type = 'general') {
    return apiRequest('/profile/albums', {
      method: 'POST',
      body: { name, description, type },
    });
  },

  async updateAlbum(albumId, data) {
    return apiRequest(`/profile/albums/${albumId}`, {
      method: 'PATCH',
      body: data,
    });
  },

  async deleteAlbum(albumId) {
    return apiRequest(`/profile/albums/${albumId}`, {
      method: 'DELETE',
    });
  },

  async getProfilePicturesAlbum() {
    return apiRequest('/profile/profile-pictures-album');
  },

  async getPhotosWithAlbum(username, albumId = null, limit = 50, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (albumId) params.set('album_id', albumId);
    return apiRequest(`/profiles/${username}/photos?${params.toString()}`);
  },
};
