/**
 * KomuniPH Lite - Auth UI
 * Login, Register, and Email Verification pages
 */

import { authApi, isAuthenticated, fetchCurrentUserProfile } from './api.js';
import { navigate } from './app.js';

/**
 * Render the auth layout (gradient background + garland)
 */
function renderAuthLayout(content) {
  return `
    <div class="auth-layout">
      <div class="garland" aria-hidden="true">
        <span style="top:6%;left:8%;width:64px;height:64px;background:var(--kp-cream);opacity:0.55"></span>
        <span style="top:14%;left:18%;width:36px;height:36px;background:var(--kp-ube);opacity:0.35"></span>
        <span style="top:4%;left:28%;width:48px;height:48px;background:var(--kp-teal);opacity:0.25"></span>
        <span style="top:10%;left:72%;width:52px;height:52px;background:var(--kp-cream);opacity:0.5"></span>
        <span style="top:20%;left:84%;width:32px;height:32px;background:var(--kp-ube);opacity:0.35"></span>
        <span style="top:2%;left:62%;width:40px;height:40px;background:var(--kp-teal);opacity:0.25"></span>
        <span style="top:80%;left:5%;width:44px;height:44px;background:var(--kp-cream);opacity:0.4"></span>
        <span style="top:88%;left:20%;width:28px;height:28px;background:var(--kp-ube);opacity:0.3"></span>
        <span style="top:85%;left:90%;width:56px;height:56px;background:var(--kp-cream);opacity:0.45"></span>
        <span style="top:70%;left:94%;width:30px;height:30px;background:var(--kp-teal);opacity:0.25"></span>
      </div>
      <main>
        ${content}
      </main>
    </div>
  `;
}

/**
 * Render the brand lockup
 */
function renderBrand() {
  return `
    <div class="brand">
      <div class="brand-name">Komuni<span class="accent">PH</span></div>
      <p class="brand-tagline">Connect. Share. Belong.</p>
    </div>
  `;
}

/**
 * Render the login page
 */
export function renderLoginPage() {
  return renderAuthLayout(`
    <div class="brand">${renderBrand()}</div>
    <div class="card">
      <div class="card-header">
        <h1>Welcome Back</h1>
        <p>Log in to continue to KomuniPH.</p>
      </div>
      <form id="login-form" class="form" novalidate>
        <div id="login-error" class="error-banner" style="display:none"></div>
        <div class="form-group">
          <label class="form-label" for="login-identifier">Username or Email</label>
          <input type="text" id="login-identifier" class="form-input" placeholder="Enter your username or email" autocomplete="username" required>
          <div id="login-identifier-error" class="form-error" style="display:none"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="login-password">Password</label>
          <div class="password-wrapper">
            <input type="password" id="login-password" class="form-input" placeholder="Enter your password" autocomplete="current-password" required>
            <button type="button" class="password-toggle" onclick="togglePassword('login-password')">Show</button>
          </div>
          <div id="login-password-error" class="form-error" style="display:none"></div>
        </div>
        <div class="form-row">
          <a href="#/forgot-password" class="forgot-link">Forgot password?</a>
        </div>
        <button type="submit" id="login-submit" class="btn btn-primary">Log In</button>
        <div class="divider"><span>Or</span></div>
        <p class="footer-text">Don't have an account? <a href="#/register">Create Account</a></p>
      </form>
    </div>
  `);
}

/**
 * Render the register page
 */
export function renderRegisterPage() {
  if (isAuthenticated()) {
    navigate('/home');
    return '';
  }

  return renderAuthLayout(`
    <div class="brand">${renderBrand()}</div>
    <div class="card">
      <div class="card-header">
        <h1>Create Account</h1>
        <p>Join KomuniPH and connect with your community.</p>
      </div>
      <form id="register-form" class="form" novalidate>
        <div id="register-error" class="error-banner" style="display:none"></div>
        <div class="form-group">
          <label class="form-label" for="register-email">Email</label>
          <input type="email" id="register-email" class="form-input" placeholder="Enter your email address" autocomplete="email" required>
          <div id="register-email-error" class="form-error" style="display:none"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="register-username">Username</label>
          <input type="text" id="register-username" class="form-input" placeholder="Choose a username" autocomplete="username" required>
          <div id="register-username-error" class="form-error" style="display:none"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="register-password">Password</label>
          <div class="password-wrapper">
            <input type="password" id="register-password" class="form-input" placeholder="Create a password (min 8 characters)" autocomplete="new-password" required>
            <button type="button" class="password-toggle" onclick="togglePassword('register-password')">Show</button>
          </div>
          <div id="register-password-error" class="form-error" style="display:none"></div>
        </div>
        <button type="submit" id="register-submit" class="btn btn-primary">Create Account</button>
        <div class="divider"><span>Or</span></div>
        <p class="footer-text">Already have an account? <a href="#/login">Log In</a></p>
      </form>
    </div>
  `);
}

/**
 * Render the verify email page
 */
export function renderVerifyEmailPage() {
  return renderAuthLayout(`
    <div class="brand">${renderBrand()}</div>
    <div class="card">
      <div class="card-header">
        <h1>Check Your Email</h1>
        <p>We've sent a verification link to your email address.</p>
      </div>
      <p class="footer-text" style="margin-bottom:1rem">
        Click the link in your email to verify your account, then
        <a href="#/login">log in</a>.
      </p>
      <p class="footer-text">
        Didn't receive the email? <a href="#/register">Try again</a>
      </p>
    </div>
  `);
}

/**
 * Render the forgot password page
 */
export function renderForgotPasswordPage() {
  if (isAuthenticated()) {
    navigate('/home');
    return '';
  }

  return renderAuthLayout(`
    <div class="brand">${renderBrand()}</div>
    <div class="card">
      <div class="card-header">
        <h1>Forgot Password</h1>
        <p>Enter your email address and we'll help you reset your password.</p>
      </div>
      <form id="forgot-password-form" class="form" novalidate>
        <div id="forgot-password-error" class="error-banner" style="display:none"></div>
        <div id="forgot-password-success" class="success-banner" style="display:none"></div>
        <div class="form-group">
          <label class="form-label" for="forgot-email">Email</label>
          <input type="email" id="forgot-email" class="form-input" placeholder="Enter your email address" autocomplete="email" required>
          <div id="forgot-email-error" class="form-error" style="display:none"></div>
        </div>
        <button type="submit" id="forgot-password-submit" class="btn btn-primary">Send Reset Instructions</button>
        <p class="footer-text"><a href="#/login">Back to Login</a></p>
      </form>
    </div>
  `);
}

/**
 * Render the reset password page
 */
export function renderResetPasswordPage() {
  if (isAuthenticated()) {
    navigate('/home');
    return '';
  }

  // Extract token from URL query parameters
  const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
  const token = urlParams.get('token');

  if (!token) {
    return renderAuthLayout(`
      <div class="brand">${renderBrand()}</div>
      <div class="card">
        <div class="card-header">
          <h1>Invalid Reset Link</h1>
          <p>This password reset link is invalid or missing.</p>
        </div>
        <p class="footer-text"><a href="#/forgot-password">Request a new reset link</a></p>
        <p class="footer-text"><a href="#/login">Back to Login</a></p>
      </div>
    `);
  }

  return renderAuthLayout(`
    <div class="brand">${renderBrand()}</div>
    <div class="card">
      <div class="card-header">
        <h1>Reset Password</h1>
        <p>Enter your new password below.</p>
      </div>
      <form id="reset-password-form" class="form" novalidate>
        <input type="hidden" id="reset-token" value="${token}">
        <div id="reset-password-error" class="error-banner" style="display:none"></div>
        <div id="reset-password-success" class="success-banner" style="display:none"></div>
        <div class="form-group">
          <label class="form-label" for="reset-password">New Password</label>
          <div class="password-wrapper">
            <input type="password" id="reset-password" class="form-input" placeholder="Enter new password (min 8 characters)" autocomplete="new-password" required>
            <button type="button" class="password-toggle" onclick="togglePassword('reset-password')">Show</button>
          </div>
          <div id="reset-password-error-field" class="form-error" style="display:none"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="reset-password-confirm">Confirm Password</label>
          <div class="password-wrapper">
            <input type="password" id="reset-password-confirm" class="form-input" placeholder="Confirm your new password" autocomplete="new-password" required>
            <button type="button" class="password-toggle" onclick="togglePassword('reset-password-confirm')">Show</button>
          </div>
          <div id="reset-password-confirm-error" class="form-error" style="display:none"></div>
        </div>
        <button type="submit" id="reset-password-submit" class="btn btn-primary">Reset Password</button>
        <p class="footer-text"><a href="#/login">Back to Login</a></p>
      </form>
    </div>
  `);
}

/**
 * Render the reset password success page
 */
export function renderResetPasswordSuccessPage() {
  return renderAuthLayout(`
    <div class="brand">${renderBrand()}</div>
    <div class="card">
      <div class="card-header">
        <h1>Password Reset Successful</h1>
        <p>Your password has been reset successfully.</p>
      </div>
      <p class="footer-text" style="margin-bottom:1rem">
        You can now log in with your new password.
      </p>
      <p class="footer-text"><a href="#/login">Back to Login</a></p>
    </div>
  `);
}

/**
 * Toggle password visibility
 */
window.togglePassword = function(inputId) {
  const input = document.getElementById(inputId);
  const button = input.parentElement.querySelector('.password-toggle');
  if (input.type === 'password') {
    input.type = 'text';
    button.textContent = 'Hide';
  } else {
    input.type = 'password';
    button.textContent = 'Show';
  }
};

/**
 * Initialize login form event handlers
 */
export function initLoginForm() {
  const form = document.getElementById('login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit');

    // Clear previous errors
    errorDiv.style.display = 'none';
    document.getElementById('login-identifier-error').style.display = 'none';
    document.getElementById('login-password-error').style.display = 'none';

    // Validate
    let hasError = false;
    if (!identifier) {
      document.getElementById('login-identifier-error').textContent = 'Username or email is required';
      document.getElementById('login-identifier-error').style.display = 'block';
      hasError = true;
    }
    if (!password) {
      document.getElementById('login-password-error').textContent = 'Password is required';
      document.getElementById('login-password-error').style.display = 'block';
      hasError = true;
    }
    if (hasError) return;

    // Submit
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in...';

    try {
      await authApi.login(identifier, password);
      await fetchCurrentUserProfile();
      navigate('/home');
    } catch (err) {
      errorDiv.textContent = err.message || 'Invalid username/email or password';
      errorDiv.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log In';
    }
  });
}

/**
 * Initialize register form event handlers
 */
export function initRegisterForm() {
  const form = document.getElementById('register-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('register-email').value.trim();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const errorDiv = document.getElementById('register-error');
    const submitBtn = document.getElementById('register-submit');

    // Clear previous errors
    errorDiv.style.display = 'none';
    document.getElementById('register-email-error').style.display = 'none';
    document.getElementById('register-username-error').style.display = 'none';
    document.getElementById('register-password-error').style.display = 'none';

    // Validate
    let hasError = false;
    if (!email) {
      document.getElementById('register-email-error').textContent = 'Email is required';
      document.getElementById('register-email-error').style.display = 'block';
      hasError = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('register-email-error').textContent = 'Invalid email format';
      document.getElementById('register-email-error').style.display = 'block';
      hasError = true;
    }
    if (!username) {
      document.getElementById('register-username-error').textContent = 'Username is required';
      document.getElementById('register-username-error').style.display = 'block';
      hasError = true;
    } else if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      document.getElementById('register-username-error').textContent = 'Username must be 3-32 characters (letters, numbers, underscore)';
      document.getElementById('register-username-error').style.display = 'block';
      hasError = true;
    }
    if (!password) {
      document.getElementById('register-password-error').textContent = 'Password is required';
      document.getElementById('register-password-error').style.display = 'block';
      hasError = true;
    } else if (password.length < 8) {
      document.getElementById('register-password-error').textContent = 'Password must be at least 8 characters';
      document.getElementById('register-password-error').style.display = 'block';
      hasError = true;
    }
    if (hasError) return;

    // Submit
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';

    try {
      await authApi.register(email, username, password);
      navigate('/verify-email');
    } catch (err) {
      errorDiv.textContent = err.message || 'Registration failed. Please try again.';
      errorDiv.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
    }
  });
}

/**
 * Initialize forgot password form event handlers
 */
export function initForgotPasswordForm() {
  const form = document.getElementById('forgot-password-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('forgot-email').value.trim();
    const errorDiv = document.getElementById('forgot-password-error');
    const successDiv = document.getElementById('forgot-password-success');
    const emailError = document.getElementById('forgot-email-error');
    const submitBtn = document.getElementById('forgot-password-submit');

    // Clear previous errors/success
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    emailError.style.display = 'none';

    // Validate
    if (!email) {
      emailError.textContent = 'Email is required';
      emailError.style.display = 'block';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailError.textContent = 'Invalid email format';
      emailError.style.display = 'block';
      return;
    }

    // Submit
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      const result = await authApi.forgotPassword(email);
      successDiv.textContent = result.message || 'If an account exists for that email, password reset instructions have been prepared.';
      successDiv.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Reset Instructions';
    } catch (err) {
      errorDiv.textContent = err.message || 'An error occurred. Please try again.';
      errorDiv.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Reset Instructions';
    }
  });
}

/**
 * Initialize reset password form event handlers
 */
export function initResetPasswordForm() {
  const form = document.getElementById('reset-password-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const token = document.getElementById('reset-token').value;
    const password = document.getElementById('reset-password').value;
    const passwordConfirm = document.getElementById('reset-password-confirm').value;
    const errorDiv = document.getElementById('reset-password-error');
    const passwordError = document.getElementById('reset-password-error-field');
    const confirmError = document.getElementById('reset-password-confirm-error');
    const submitBtn = document.getElementById('reset-password-submit');

    // Clear previous errors
    errorDiv.style.display = 'none';
    passwordError.style.display = 'none';
    confirmError.style.display = 'none';

    // Validate
    let hasError = false;
    if (!password) {
      passwordError.textContent = 'Password is required';
      passwordError.style.display = 'block';
      hasError = true;
    } else if (password.length < 8) {
      passwordError.textContent = 'Password must be at least 8 characters';
      passwordError.style.display = 'block';
      hasError = true;
    }
    if (!passwordConfirm) {
      confirmError.textContent = 'Please confirm your password';
      confirmError.style.display = 'block';
      hasError = true;
    } else if (password !== passwordConfirm) {
      confirmError.textContent = 'Passwords do not match';
      confirmError.style.display = 'block';
      hasError = true;
    }
    if (hasError) return;

    // Submit
    submitBtn.disabled = true;
    submitBtn.textContent = 'Resetting...';

    try {
      await authApi.resetPassword(token, password, passwordConfirm);
      navigate('/reset-success');
    } catch (err) {
      errorDiv.textContent = err.message || 'Failed to reset password. The link may be expired or invalid.';
      errorDiv.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reset Password';
    }
  });
}
