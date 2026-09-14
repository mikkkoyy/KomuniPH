KomuniPH — changed files from this session
===========================================

Drop these into your project at:
D:\FILES\project\KomuniPH\

overwriting the matching paths:
  server/index.js
  server/profile.js
  web/js/profile.js

1) server/index.js
   - serveStatic() now sends `Cache-Control: no-cache` on every response.
     Previously it sent no caching headers at all, so the browser could
     keep serving an old cached copy of styles.css/profile.js/index.html
     even after you saved a fix to disk. This forces the browser to always
     revalidate with the server instead of guessing.

2) server/profile.js
   - ALLOWED_BACKGROUND_SIZES now includes 'stretch' (alongside the
     existing cover/contain/auto), so PATCH /api/profile/theme no longer
     rejects it.

3) web/js/profile.js
   - Added a "Stretch (fill exactly)" option to the background Size
     dropdown in the customization panel.
   - Added resolveBackgroundSizeCss(), which maps the stored 'stretch'
     value to the actual CSS needed (`100% 100%`) — there's no CSS
     keyword for it. cover/contain/auto pass through unchanged.
   - Used that helper in both places that write to #profile-frame's
     style: applyProfileBackground() (page load) and updatePreview()
     (live preview in the customization panel), so Save and the live
     preview behave identically.

STILL OPEN (diagnosed, not yet fixed — say the word if you want these too):
  - Profile photo upload: #photo-input has no 'change' event listener,
    so the hidden #upload-btn never appears after picking a file and
    window.uploadPhoto() never fires from the UI. Needs a change
    listener added in web/js/profile.js.
  - server/locations.json: barangay lists for Marikina, Pasig,
    Mandaluyong, and San Juan contain corrupted/truncated fragments
    (e.g. "San", "Santo", "Kal", "Dela") instead of real barangay names.
  - handleUpdateProfile() in server/profile.js does not validate that
    the submitted city belongs to the submitted country, or that the
    barangay belongs to the city.
