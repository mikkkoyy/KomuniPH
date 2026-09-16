/** Dedicated owner workspace; profile data and uploads use the existing APIs. */
import { profileApi } from './api.js';
import { applyProfileBackground, renderProfileView, renderThemeControls, setEditorProfile, getThemeDraft } from './profile.js';

let root = null;
let dirty = false;
let identityDirty = false;
let themeDirty = false;
let savedProfile = null;
let busy = false;
let photoFile = null;
let photoPreviewUrl = null;

export function renderProfileEditorPage() {
  return `<main id="profile-editor" class="profile-editor">
    <header class="editor-heading"><a href="#/profile">← Return to profile</a>
      <p>YOUR PERSONAL SPACE</p><h1>Profile Management</h1>
      <p>Edit your identity and make your KomuniPH profile your own.</p></header>
    <p id="editor-status" role="status" aria-live="polite">Loading your profile…</p>
    <div id="editor-workspace" hidden>
      <div class="editor-tabs" role="tablist" aria-label="Profile management">
        <button id="identity-tab" role="tab" aria-selected="true" aria-controls="identity-panel" data-tab="identity">Edit Profile</button>
        <button id="customize-tab" role="tab" aria-selected="false" aria-controls="customize-panel" data-tab="customize" tabindex="-1">Customize Profile</button>
      </div>
      <div class="editor-layout"><div class="editor-controls">
        <section id="identity-panel" role="tabpanel" aria-labelledby="identity-tab">
          <h2>Profile Photo</h2><p>Choose a photo, preview it, then upload. Photo uploads save immediately.</p>
          <label class="btn btn-secondary" for="editor-photo-input">Change Profile Photo</label>
          <input id="editor-photo-input" type="file" accept="image/jpeg,image/png,image/webp">
          <img id="editor-photo-preview" class="editor-photo-preview" alt="Selected profile photo" hidden>
          <button id="editor-photo-upload" class="btn btn-primary" disabled>Upload Photo</button>
          <p id="editor-photo-status" role="status"></p>
          <h2>Profile Information</h2><p id="editor-username"></p>
          <div id="profile-edit"></div>
        </section>
        <section id="customize-panel" role="tabpanel" aria-labelledby="customize-tab" hidden>
          <p>Preview your colors, background and profile cards. Save Changes to apply them.</p>
          ${renderThemeControls()}
          <p>Testimonials, gallery and albums remain on your profile. Widget visibility and decorations are not configurable yet.</p>
        </section>
      </div>
      <aside class="editor-preview" aria-label="Live profile preview">
        <h2>Profile Preview</h2><p>Your identity and profile-card styling, without the editing controls.</p>
        <div class="profile-frame" id="profile-frame" data-view="preview">
          <div class="profile-background-layer" id="profile-background-layer" aria-hidden="true"></div>
          <div class="profile-module"><div class="profile-module-header">Profile</div>
            <div class="profile-module-body"><div id="profile-photo-display"></div>
              <div id="profile-view"><h2 id="profile-name" class="profile-name"></h2>
              <p id="profile-username" class="profile-username"></p><p id="profile-nickname"></p><p id="profile-alias"></p>
              <p id="profile-info-bio"></p></div>
            </div></div>
        </div>
      </aside></div>
    </div>
  </main>`;
}

function beforeUnload(event) {
  if (dirty || busy) { event.preventDefault(); event.returnValue = ''; }
}

export function canLeaveProfileEditor() {
  if (!root) return true;
  if (busy) { setStatus('Please wait for the current upload or save to finish.'); return false; }
  return !dirty || window.confirm('Leave without saving your profile changes?');
}

export function destroyProfileEditorPage() {
  window.removeEventListener('beforeunload', beforeUnload);
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  root = null;
  dirty = false;
  identityDirty = false;
  themeDirty = false;
  savedProfile = null;
  busy = false;
  photoFile = null;
  photoPreviewUrl = null;
}

function setStatus(message) {
  const status = root?.querySelector('#editor-status');
  if (status) status.textContent = message;
}

function selectTab(name) {
  for (const tab of root.querySelectorAll('[data-tab]')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    root.querySelector(`#${tab.dataset.tab}-panel`).hidden = !selected;
  }
}

export async function initProfileEditorPage() {
  root = document.getElementById('profile-editor');
  const mounted = root;
  if (!root) return;
  window.addEventListener('beforeunload', beforeUnload);
  try {
    const profile = await profileApi.getOwnProfile();
    if (root !== mounted || !mounted.isConnected) return;
    savedProfile = profile;
    setEditorProfile(profile);
    applyProfileBackground(profile);
    renderProfileView(profile);
    await window.startEditProfile();
    if (root !== mounted || !mounted.isConnected) return;
    root.querySelector('#profile-view').style.display = 'block';
    root.querySelector('#editor-username').textContent = `Account username: @${profile.username}. Your display identity is separate.`;
    window.openCustomization();
    applyProfileBackground(profile);
    root.querySelector('#editor-workspace').hidden = false;
    setStatus('Changes stay in this workspace until you save. Uploads save immediately.');
    root.querySelectorAll('[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => selectTab(tab.dataset.tab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'identity' : event.key === 'End' ? 'customize' : tab.dataset.tab === 'identity' ? 'customize' : 'identity';
        selectTab(next);
        root.querySelector(`#${next}-tab`).focus();
      });
    });
    bindIdentityForm();
    bindUploads();
    bindThemeActions();
    const onDraftChange = event => {
      if (event.target.closest('#profile-edit')) {
        identityDirty = true;
        renderIdentityDraft();
      }
      if (event.target.closest('#theme-customization-panel') && event.target.type !== 'file') themeDirty = true;
      updateDirty();
    };
    root.addEventListener('input', onDraftChange);
    root.addEventListener('change', onDraftChange);
    // Make the inherited color/range controls accessible without duplicating them.
    root.querySelectorAll('.theme-field, .theme-controls').forEach(field => {
      const label = field.querySelector('label');
      const control = field.querySelector('input[id], select[id]');
      if (label && control) label.htmlFor = control.id;
    });
  } catch (error) {
    if (root === mounted) setStatus(`Could not load your profile: ${error.message}. Return to your profile or sign in again.`);
  }
}


function updateDirty() {
  dirty = identityDirty || themeDirty || !!photoFile;
}

function renderIdentityDraft() {
  if (!savedProfile) return;
  const value = id => root.querySelector(`#${id}`)?.value || '';
  renderProfileView({ ...savedProfile, display_name: value('edit-display-name'),
    bio: value('edit-bio'), nickname: value('edit-nickname'), alias: value('edit-alias') });
  root.querySelector('#profile-view').style.display = 'block';
}

async function runAction(action) {
  if (busy) return;
  busy = true;
  const controls = [...root.querySelectorAll('button, input, select, textarea')];
  const states = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  try { return await action(); }
  catch (error) { setStatus(error.message || 'Could not save changes. Please try again.'); }
  finally {
    controls.forEach((control, index) => { control.disabled = states[index]; });
    busy = false;
    if (root) root.querySelector('#editor-photo-upload').disabled = !photoFile;
  }
}

function bindIdentityForm() {
  const save = root.querySelector('#save-profile-btn');
  save.removeAttribute('onclick');
  save.onclick = () => {
    if (busy) return;
    runAction(async () => {
      // The existing save handler manages its own disabled state.
      save.disabled = false;
      setStatus('Saving profile information…');
      const updated = await window.saveProfile();
      if (updated) {
        savedProfile = updated;
        setEditorProfile(updated);
        identityDirty = false;
        updateDirty();
        if (themeDirty) window.updatePreview();
        setStatus('Profile information saved successfully.');
      } else setStatus('Profile not saved. Check the validation message below the form.');
    });
  };
  const cancel = root.querySelector('#cancel-profile-btn');
  cancel.removeAttribute('onclick');
  cancel.textContent = 'Discard Changes';
  cancel.onclick = async () => {
    if (identityDirty && !window.confirm('Discard your profile information changes?')) return;
    setEditorProfile(savedProfile);
    await window.startEditProfile();
    bindIdentityForm();
    identityDirty = false;
    updateDirty();
    renderIdentityDraft();
    setStatus('Profile information changes discarded.');
  };
}

function bindThemeActions() {
  root.querySelector('#editor-save-theme').onclick = () => runAction(async () => {
    setStatus('Saving profile customization…');
    const updated = await profileApi.updateTheme(getThemeDraft());
    savedProfile = updated;
    setEditorProfile(updated);
    themeDirty = false;
    updateDirty();
    applyProfileBackground(updated);
    renderIdentityDraft();
    setStatus('Profile customization saved successfully.');
  });
  root.querySelector('#editor-cancel-theme').onclick = () => {
    if (themeDirty && !window.confirm('Discard your customization changes?')) return;
    setEditorProfile(savedProfile);
    window.openCustomization();
    themeDirty = false;
    updateDirty();
    setStatus('Customization changes discarded.');
  };
  root.querySelector('#editor-reset-theme').onclick = () => {
    if (!window.confirm('Reset your profile appearance to the default theme? This saves immediately.')) return;
    runAction(async () => {
      const payload = Object.fromEntries(Object.keys(getThemeDraft()).map(key => [key, null]));
      savedProfile = await profileApi.updateTheme(payload);
      setEditorProfile(savedProfile);
      window.openCustomization();
      themeDirty = false;
      updateDirty();
      setStatus('Default profile theme restored and saved.');
    });
  };
  root.querySelector('#editor-remove-background').onclick = () => runAction(async () => {
    savedProfile = await profileApi.updateTheme({ backgroundImage: null });
    setEditorProfile(savedProfile);
    root.querySelector('#theme-background-preview').style.display = 'none';
    root.querySelector('#theme-background-preview').replaceChildren();
    root.querySelector('input[name="bg-type"][value="default"]').checked = true;
    window.setBgType('default');
    themeDirty = true;
    updateDirty();
    setStatus('Background image removed and saved. Save Changes to apply any remaining appearance changes.');
  });
}

function bindUploads() {
  const input = root.querySelector('#editor-photo-input');
  const preview = root.querySelector('#editor-photo-preview');
  const status = root.querySelector('#editor-photo-status');
  input.onchange = () => {
    photoFile = null;
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = null;
    preview.hidden = true;
    try {
      const file = input.files[0];
      if (file) {
        validateImage(file);
        photoFile = file;
        photoPreviewUrl = URL.createObjectURL(file);
        preview.src = photoPreviewUrl;
        preview.hidden = false;
        status.textContent = 'Photo selected. Upload Photo to save it.';
      }
    } catch (error) { status.textContent = error.message; input.value = ''; }
    root.querySelector('#editor-photo-upload').disabled = !photoFile;
    updateDirty();
  };
  root.querySelector('#editor-photo-upload').onclick = () => runAction(async () => {
    if (!photoFile) return;
    status.textContent = 'Uploading profile photo…';
    try {
      await profileApi.uploadPhoto(photoFile);
      savedProfile = await profileApi.getOwnProfile();
      setEditorProfile(savedProfile);
      renderIdentityDraft();
      photoFile = null;
      input.value = '';
      preview.hidden = true;
      URL.revokeObjectURL(photoPreviewUrl);
      photoPreviewUrl = null;
      updateDirty();
      status.textContent = 'Profile photo uploaded and saved successfully.';
    } catch (error) { status.textContent = error.message; }
  });
  root.querySelector('#theme-background-input').onchange = event => {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    const status = root.querySelector('#theme-background-status');
    runAction(async () => {
      try {
        validateImage(file);
        status.textContent = 'Uploading background…';
        const result = await profileApi.uploadBackground(file);
        savedProfile = { ...savedProfile, theme: { ...savedProfile.theme,
          custom: { ...savedProfile.theme.custom, backgroundImage: result.background_url } } };
        setEditorProfile(savedProfile);
        const preview = root.querySelector('#theme-background-preview');
        const image = document.createElement('img');
        image.src = result.background_url;
        image.alt = 'Current background';
        preview.replaceChildren(image);
        preview.style.display = 'block';
        root.querySelector('input[name="bg-type"][value="image"]').checked = true;
        window.setBgType('image');
        themeDirty = true;
        updateDirty();
        status.textContent = 'Background uploaded and saved. Save Changes to apply positioning and styles.';
      } catch (error) { status.textContent = error.message; }
      finally { input.value = ''; }
    });
  };
}

function validateImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image must be 5MB or smaller.');
}
