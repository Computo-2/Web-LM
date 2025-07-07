const LocalStrategy = require('passport-local').Strategy;

module.exports = function(passport, pool) {
  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      const [users] = await pool.query('SELECT * FROM usuarios WHERE username = ?', [username]);
      const user = users[0];
      if (!user) return done(null, false, { message: 'Usuario o contraseña incorrectos' });
      if (user.password !== password) return done(null, false, { message: 'Usuario o contraseña incorrectos' });
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }));

  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser(async (id, done) => {
    try {
      const [users] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [id]);
      done(null, users[0]);
    } catch (error) {
      done(error);
    }
  });
};
