import('../server/database.js').then(m=>{
  const db=m.getDb();
  console.log(db.prepare("SELECT sql FROM sqlite_master WHERE name='profiles'").get().sql);
  console.log(JSON.stringify(db.prepare("SELECT name, sql FROM sqlite_master WHERE tbl_name='profiles' AND type='index'").all(),null,2));
  console.log('count', db.prepare('SELECT COUNT(*) c FROM profiles').get());
  console.log(JSON.stringify(db.prepare('SELECT display_name, alias, bio FROM profiles LIMIT 5').all()));
});
