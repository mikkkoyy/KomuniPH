import { execute, queryOne } from '../server/database.js';

const stamp = Date.now();
const uname = `invaltest${stamp}`;
const email = `${uname}@test.com`;

// Register the user directly in DB (simplified)
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const userId = uuidv4();
const passwordHash = await bcrypt.hash('Password123!', 10);

execute(`INSERT INTO users (id, email, username, password_hash, role, account_status) VALUES (?, ?, ?, ?, 'member', 'active')`, [userId, email, uname, passwordHash]);
execute(`INSERT INTO profiles (id, user_id, display_name, alias_enabled) VALUES (?, ?, ?, 0)`, [uuidv4(), userId, uname]);

// Set theme_id to default
execute(`UPDATE profiles SET theme_id = 'default' WHERE user_id = ?`, [userId]);

// Corrupt custom_theme_config with invalid JSON
execute(`UPDATE profiles SET custom_theme_config = 'BROKEN_JSON{invalid' WHERE user_id = ?`, [userId]);

console.log('TEST USER:', uname, 'ID:', userId);

// Verify the corruption
const corrupted = queryOne('SELECT custom_theme_config FROM profiles WHERE user_id = ?', [userId]);
console.log('CORRUPTED VALUE:', corrupted.custom_theme_config);

// Export for use by the HTTP test
export { userId, uname as username, stamp };
