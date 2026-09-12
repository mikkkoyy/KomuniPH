import('../server/database.js').then(m => {
  m.seedDefaultTheme();
  const rows = m.queryAll(`SELECT p.id, u.username, p.theme_id FROM profiles p JOIN users u ON p.user_id = u.id WHERE u.username LIKE 'p02a%' OR u.username LIKE 'p02b%'`);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
});
