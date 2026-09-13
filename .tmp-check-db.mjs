import Database from 'better-sqlite3';
const db = new Database('./data/komuniph.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name));

try {
  const themes = db.prepare('SELECT id, name, config FROM profile_themes').all();
  console.log('Themes:', JSON.stringify(themes, null, 2));
} catch(e) { console.log('No themes table:', e.message); }

try {
  const users = db.prepare('SELECT id, username, email FROM users').all();
  console.log('Users:', JSON.stringify(users, null, 2));
} catch(e) { console.log('No users table:', e.message); }

try {
  const profiles = db.prepare('SELECT id, user_id, display_name, custom_theme_config FROM profiles').all();
  console.log('Profiles:', JSON.stringify(profiles, null, 2));
} catch(e) { console.log('No profiles table:', e.message); }

db.close();
