/** Dedicated owner workspace; profile data and uploads use the existing APIs. */
import { profileApi } from './api.js';
import { applyProfileBackground, renderProfileView, renderThemeControls, setEditorProfile, getThemeDraft, renderProfilePage, loadProfilePreviewContent } from './profile.js';

let root = null;
let dirty = false;
let identityDirty = false;
let themeDirty = false;
let savedProfile = null;
let busy = false;
let photoFile = null;
let photoPreviewUrl = null;
let privacyDirty = false;
let previewLoaded = false;
let activeTab = 'identity';

export function renderProfileEditorPage() {
  return `<main id="profile-editor" class="profile-editor">
    <header class="editor-heading"><a href="#/profile">← Return to profile</a>
      <p class="editor-eyebrow">YOUR PERSONAL SPACE</p><h1>Edit Profile</h1>
      <p>Manage how people see you. Make this space your own.</p></header>
    <p id="editor-status" role="status" aria-live="polite">Loading your profile…</p>
    <div id="editor-workspace" hidden>
      <div class="editor-tabs" role="tablist" aria-label="Profile management">
        <button id="identity-tab" role="tab" aria-selected="true" aria-controls="identity-panel" data-tab="identity">Edit Profile</button>
        <button id="customize-tab" role="tab" aria-selected="false" aria-controls="customize-panel" data-tab="customize" tabindex="-1">Customize Profile</button>
        <button id="privacy-tab" role="tab" aria-selected="false" aria-controls="privacy-panel" data-tab="privacy" tabindex="-1">Privacy</button>
      </div>
      <button id="editor-open-preview" class="btn btn-secondary">Preview Profile ↗</button>
      <div class="editor-layout"><div class="editor-controls">
        <section id="identity-panel" role="tabpanel" aria-labelledby="identity-tab">
          <h2>Profile Photo</h2><p>Choose a photo, preview it, then upload. Photo uploads save immediately.</p>
          <div id="editor-current-photo" aria-label="Current profile photo"></div>
          <label for="editor-photo-input">Change Profile Photo</label>
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
        <section id="privacy-panel" role="tabpanel" aria-labelledby="privacy-tab" hidden>
          <h2>Privacy</h2><p>Choose what belongs on your public profile.</p>
          <h3>Profile identity</h3>
          <p>Your display name, nickname and bio are public. Your username stays your account handle. Legal-name fields and email are never included in the public profile response.</p>
          <h3>Birthday</h3><p>Your birthday is hidden unless you choose to share it. Edit the date under Edit Profile.</p>
          <label class="editor-toggle" for="editor-birthday-visible"><span>Show my birthday<span class="editor-help">Off means hidden from everyone visiting your profile.</span></span><input id="editor-birthday-visible" type="checkbox" role="switch"></label>
          <h3>Real Name</h3><p>Your legal name is hidden unless you choose to share it. Edit the name under Edit Profile.</p>
          <label class="editor-toggle" for="editor-real-name-visible"><span>Show my real name<span class="editor-help">Off means hidden from everyone visiting your profile.</span></span><input id="editor-real-name-visible" type="checkbox" role="switch"></label>
          <p>Profiles are public. Private-profile access is not currently supported.</p>
          <div class="edit-actions"><button id="editor-save-privacy" class="btn btn-primary">Save Privacy Changes</button><button id="editor-cancel-privacy" class="btn btn-secondary">Discard Changes</button></div>
        </section>
      </div></div>
      <section id="editor-full-preview" hidden aria-label="Full profile preview">
        <div class="editor-preview-toolbar"><div><strong>Preview</strong><p>Visitor view with your unsaved changes. Nothing is saved by opening preview.</p></div><button id="editor-back" class="btn btn-secondary">← Back to Editor</button></div>
        <p id="editor-preview-status" role="status"></p>
        <div id="editor-preview-content">${renderProfilePage(null, { preview: true })}</div>
      </section>
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
  privacyDirty = false;
  previewLoaded = false;
  activeTab = 'identity';
}

function setStatus(message) {
  const status = root?.querySelector('#editor-status');
  if (status) status.textContent = message;
}

function selectTab(name) {
  activeTab = name;
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
        const names = ['identity', 'customize', 'privacy'];
        const index = names.indexOf(tab.dataset.tab);
        const next = event.key === 'Home' ? names[0] : event.key === 'End' ? names[2] : names[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
        selectTab(next);
        root.querySelector(`#${next}-tab`).focus();
      });
    });
    bindIdentityForm();
    bindUploads();
    bindThemeActions();
    bindPrivacy();
    root.querySelector('#editor-open-preview').onclick = openFullPreview;
    root.querySelector('#editor-back').onclick = closeFullPreview;
    // Preview is read-only, including gallery links and testimonial actions.
    root.querySelector('#editor-preview-content').addEventListener('click', event => {
      if (event.target.closest('a, button, .photo-gallery-item')) { event.preventDefault(); event.stopPropagation(); }
    }, true);
    renderIdentityDraft();
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
  dirty = identityDirty || themeDirty || privacyDirty || !!photoFile;
}

function renderIdentityDraft() {
  if (!savedProfile) return;
  const value = id => root.querySelector(`#${id}`)?.value || '';
  renderProfileView({ ...savedProfile, display_name: value('edit-display-name'),
    bio: value('edit-bio'),
    real_name: value('edit-real-name'),
    birthday: value('edit-birthday'), birthday_visible: root.querySelector('#editor-birthday-visible').checked,
    real_name_visible: root.querySelector('#editor-real-name-visible').checked,
    country: value('edit-country'), city: value('edit-city'), barangay: value('edit-barangay'),
    profile_photo_url: photoPreviewUrl || savedProfile.profile_photo_url });
  root.querySelector('#editor-current-photo').replaceChildren(root.querySelector('#profile-photo-display').cloneNode(true));
  root.querySelector('#editor-current-photo [id]')?.removeAttribute('id');
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
    renderIdentityDraft();
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
      previewLoaded = false;
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

function bindPrivacy() {
  const birthday = root.querySelector('#editor-birthday-visible');
  const realName = root.querySelector('#editor-real-name-visible');
  const reset = () => {
    birthday.checked = !!savedProfile.birthday_visible;
    realName.checked = !!savedProfile.real_name_visible;
    privacyDirty = false;
    updateDirty();
    renderIdentityDraft();
  };
  reset();
  birthday.onchange = () => {
    privacyDirty = true;
    updateDirty();
    renderIdentityDraft();
  };
  realName.onchange = () => {
    privacyDirty = true;
    updateDirty();
    renderIdentityDraft();
  };
  root.querySelector('#editor-save-privacy').onclick = () => runAction(async () => {
    savedProfile = await profileApi.updateProfile({ birthday_visible: birthday.checked, real_name_visible: realName.checked });
    setEditorProfile(savedProfile);
    privacyDirty = false;
    updateDirty();
    renderIdentityDraft();
    setStatus('Privacy changes saved successfully.');
  });
  root.querySelector('#editor-cancel-privacy').onclick = () => {
    if (privacyDirty && !window.confirm('Discard your privacy changes?')) return;
    reset();
    setStatus('Privacy changes discarded.');
  };
}

async function openFullPreview() {
  if (busy) return;
  renderIdentityDraft();
  // Replace the merged custom config too, so cleared background values do not
  // fall back to an older saved image. Opening preview performs no writes.
  const custom = themeDirty ? getThemeDraft() : savedProfile.theme?.custom || {};
  applyProfileBackground({ ...savedProfile, theme: { ...savedProfile.theme,
    config: { ...savedProfile.theme?.config, ...custom }, custom } });
  root.classList.add('is-previewing');
  root.querySelector('#editor-full-preview').hidden = false;
  root.querySelector('#editor-back').focus();
  window.scrollTo(0, 0);
  if (!previewLoaded) {
    const mounted = root;
    const status = root.querySelector('#editor-preview-status');
    status.textContent = 'Loading your gallery, albums and testimonials…';
    await runAction(async () => {
      try {
        await loadProfilePreviewContent(savedProfile.username);
        if (root !== mounted) return;
        // Read-only preview: keep links visually faithful but out of tab order.
        root.querySelectorAll('#editor-preview-content a, #editor-preview-content button').forEach(control => {
          control.tabIndex = -1;
          control.setAttribute('aria-disabled', 'true');
        });
        previewLoaded = true;
        status.textContent = '';
      } catch (error) {
        status.textContent = `Could not load profile content: ${error.message}. Return to the editor and reopen preview to retry.`;
      }
    });
    if (root === mounted) root.querySelector('#editor-back').focus();
  }
}

function closeFullPreview() {
  root.classList.remove('is-previewing');
  root.querySelector('#editor-full-preview').hidden = true;
  selectTab(activeTab);
  root.querySelector('#editor-open-preview').focus();
  window.scrollTo(0, 0);
}

function validateImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image must be 5MB or smaller.');
}
