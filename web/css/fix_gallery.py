#!/usr/bin/env python3
import re

with open('D:\\FILES\\project\\KomuniPH\\web\\css\\styles.css', 'r') as f:
    content = f.read()

# Replace the .photo-gallery-grid base and remove old responsive rules
old_base = '''.photo-gallery-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.photo-gallery-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--theme-card-radius, var(--kp-card-radius));
  overflow: hidden;
  cursor: pointer;
  background: var(--theme-card-background, #fff7ec);
  border: 1px solid var(--theme-card-border-color, var(--kp-border));
}'''

new_base = '''.photo-gallery-grid {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: 1fr;
}

.photo-gallery-item {
  position: relative;
  border-radius: var(--theme-card-radius, var(--kp-card-radius));
  overflow: hidden;
  cursor: pointer;
  background: var(--theme-card-background, #fff7ec);
  border: 1px solid var(--theme-card-border-color, var(--kp-border));
}'''

if old_base in content:
    content = content.replace(old_base, new_base)
    print('Replaced base .photo-gallery-grid')
else:
    print('Base not found, checking...')
    # Check what's there
    idx = content.find('.photo-gallery-grid')
    if idx != -1:
        print(f'Found at index {idx}: {content[idx:idx+100]}')

# Remove old responsive media queries
old_media = '''/* Photo Gallery responsive */
@media (min-width: 1440px) {
  .photo-gallery-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (min-width: 1025px) {
  .photo-gallery-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (min-width: 769px) {
  .photo-gallery-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .photo-gallery-grid {
    grid-template-columns: 1fr;
  }
}'''

if old_media in content:
    content = content.replace(old_media, '')
    print('Removed old responsive media queries')
else:
    print('Old media queries not found at expected location')

# Add new mobile-first responsive rules
new_media = '''

@media (min-width: 769px) {
  .photo-gallery-grid {
    grid-template-columns: 2fr;
  }
}

@media (min-width: 1025px) {
  .photo-gallery-grid {
    grid-template-columns: 3fr;
  }
}

@media (min-width: 1440px) {
  .photo-gallery-grid {
    grid-template-columns: 4fr;
  }
}'''

content = content + new_media

with open('D:\\FILES\\project\\KomuniPH\\web\\css\\styles.css', 'w') as f:
    f.write(content)
print('CSS file updated successfully')