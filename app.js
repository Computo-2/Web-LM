const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { engine } = require('express-handlebars');
const path = require('path');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const Handlebars = require('handlebars');

// Conexión pool a MySQL
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root',   // Cambia por tu contraseña
  database: 'web_lm'
});

// Nodemailer (Gmail)
const transporter = nodemailer.createTransport({
  host: 'mail.liceomichoacano.com',      // Cambia esto por tu SMTP
  port: 465,                             // 465 (SSL), 587 (TLS)
  secure: true,                          // true para 465, false para 587
  auth: {
    user: 'test@liceomichoacano.com',    // Tu correo completo
    pass: 'qgmR1cfgD]5#'      // Contraseña real del correo
  },
  tls: {
    // No rechaza certificados autofirmados, solo si tu hosting lo requiere
    rejectUnauthorized: false
  }
});

const app = express();
require('./passport-config')(passport, pool); // Ya NO pasamos bcrypt

// Handlebars
app.engine('hbs', engine({
  extname: '.hbs',
  partialsDir: path.join(__dirname, 'views', 'partials'),
  helpers: {
    eq: function (a, b) { return a === b; },
    divideInColumns: function (arr, numCols, options) {
      if (!Array.isArray(arr)) return '';
      numCols = parseInt(numCols) || 1;
      let out = Array.from({ length: numCols }, () => []);
      arr.forEach((item, idx) => {
        out[Math.floor(idx / Math.ceil(arr.length / numCols))].push(item);
      });
      let html = '';
      out.forEach(col => {
        html += '<div class="col-md-6 col-lg-5"><div class="list-group list-group-flush">';
        col.forEach(item => {
          html += `<a href="${item.ruta}" class="list-group-item list-group-item-action">${item.nombre}</a>`;
        });
        html += '</div></div>';
      });
      return new Handlebars.SafeString(html);
    },
    // --- Agrega este helper para formatear la fecha ---
    formatFechaLarga: function (fechaStr) {
      if (!fechaStr) return '';
      const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sabado'];
      const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const fecha = new Date(fechaStr);
      if (isNaN(fecha)) return fechaStr;
      // Asegura el primer carácter en mayúscula
      let diaTexto = dias[fecha.getDay()];
      diaTexto = diaTexto.charAt(0).toUpperCase() + diaTexto.slice(1);
      return `${diaTexto} ${fecha.getDate()} de ${meses[fecha.getMonth()]} de ${fecha.getFullYear()}`;
    },
     formatHora12: function (hora24) {
    if (!hora24) return '';
    let [h, m] = hora24.split(':');
    h = parseInt(h, 10);
    const sufijo = h >= 12 ? 'pm' : 'am';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return `${h12.toString().padStart(2, '0')}:${m} ${sufijo}`;
  },
  }
}));

app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Importante para recibir JSON por POST
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Servir archivos estáticos (asegúrate de poner tu HTML en /public)
app.use(express.static(path.join(__dirname, 'public')));

// Middlewares
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: 'secreto',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

// Mantenimiento
app.use(async (req, res, next) => {
  const admin = req.user && req.user.rol === 'admin';
  const rutasPermitidas = ['/accesoweb', '/logout'];
  if (!admin && !rutasPermitidas.includes(req.path)) {
    // CAMBIO: usa "activo" en lugar de "valor"
    const [rows] = await pool.query("SELECT activo FROM configuracion WHERE nombre = 'mantenimiento'");
    // activo debe ser 1 (o '1' según tipo de dato)
    if (rows.length && rows[0].activo === 1) {
      return res.render('mantenimiento', { layout: false });
    }
  }
  next();
});

app.post('/admin/mantenimiento', isAdmin, express.json(), async (req, res) => {
  const activo = req.body.activo ? '1' : '0';
  await pool.query("UPDATE configuracion SET activo = ? WHERE nombre = 'mantenimiento'", [activo]);
  res.json({ ok: true, mantenimiento: activo === '1' });
});

// Protege rutas privadas
function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/accesoweb');
}
function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.rol === 'admin') return next();
  res.redirect('/dashboard');
}
function isVentas(req, res, next) {
  if (req.isAuthenticated() && req.user.rol === 'ventas') return next();
  res.redirect('/dashboard');
}

// Rutas
app.get('/', async (req, res) => {
  // Menú principal
  const [menus] = await pool.query('SELECT * FROM menu_principal');
  // Submenús
  const [submenus] = await pool.query('SELECT * FROM submenu');
  // Relaciona submenús a su menú
  menus.forEach(menu => {
    menu.submenus = submenus.filter(s => s.id_menu === menu.id);
  });
  // --- NUEVO: Consulta la portada dinámica ---
  const [rows] = await pool.query('SELECT * FROM portada ORDER BY id DESC LIMIT 1');
  const portada = rows[0] || { tipo: 'imagen', url: '/img/protada.png' }; // Default si no hay portada

  // Ahora pasas tanto menus como portada a la vista:
  res.render('home', { menus, portada });
});

app.use(async (req, res, next) => {
  const [menus] = await pool.query('SELECT * FROM menu_principal');
  const [submenus] = await pool.query('SELECT * FROM submenu');
  menus.forEach(menu => {
    menu.submenus = submenus.filter(s => s.id_menu === menu.id);
  });
  res.locals.menus = menus;
  next();
});

// login
app.get('/accesoweb', (req, res) => {
  res.render('login', { message: req.session.messages, noLayoutParts: true });
});

app.post('/accesoweb', passport.authenticate('local', {
  successRedirect: '/dashboard',
  failureRedirect: '/accesoweb',
  failureMessage: true
}));

// dashboard
app.get('/dashboard', isLoggedIn, async (req, res) => {
  const [rows] = await pool.query("SELECT activo FROM configuracion WHERE nombre = 'mantenimiento'");
  const mantenimiento = rows.length && rows[0].activo == '1';
  res.render('dashboard', { user: req.user, mantenimiento, noLayoutParts: true });
});

app.get('/admin/web/portada', isAdmin, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM portada ORDER BY id DESC LIMIT 1');
  const portada = rows[0] || { tipo: 'imagen', url: '' };
  res.render('edit-portada', { user: req.user, portada, noLayoutParts: true });
});

app.post('/admin/web/portada', isAdmin, async (req, res) => {
  const { tipo, url } = req.body;
  // Borra anteriores y agrega nuevo, o haz un UPDATE si solo hay 1 registro:
  await pool.query('DELETE FROM portada');
  await pool.query('INSERT INTO portada (tipo, url) VALUES (?, ?)', [tipo, url]);
  res.redirect('/admin/web/portada');
});


app.get('/logout', (req, res, next) => {
  req.logout(function (err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

// ------- GESTIÓN DE USUARIOS --------
app.get('/admin/usuarios', isAdmin, async (req, res) => {
  const [users] = await pool.query('SELECT * FROM usuarios');
  res.render('admin-usuarios', { user: req.user, users, noLayoutParts: true });
});

app.post('/admin/usuarios/add', isAdmin, async (req, res) => {
  const { username, password, rol } = req.body;
  await pool.query('INSERT INTO usuarios (username, password, rol) VALUES (?, ?, ?)', [username, password, rol]);
  res.redirect('/admin/usuarios');
});

app.post('/admin/usuarios/delete', isAdmin, async (req, res) => {
  const id = parseInt(req.body.id);
  await pool.query('DELETE FROM usuarios WHERE id = ?', [id]);
  res.redirect('/admin/usuarios');
});

app.get('/admin/usuarios/edit/:id', isAdmin, async (req, res) => {
  const [users] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [req.params.id]);
  const userToEdit = users[0];
  res.render('edit-usuario', { user: req.user, userToEdit });
});

app.post('/admin/usuarios/edit/:id', isAdmin, async (req, res) => {
  const { username, password, rol } = req.body;
  let query, params;
  if (password && password.trim() !== '') {
    query = 'UPDATE usuarios SET username = ?, password = ?, rol = ? WHERE id = ?';
    params = [username, password, rol, req.params.id];
  } else {
    query = 'UPDATE usuarios SET username = ?, rol = ? WHERE id = ?';
    params = [username, rol, req.params.id];
  }
  await pool.query(query, params);
  res.redirect('/admin/usuarios');
});

// ----- GESTIÓN DE MENÚS PRINCIPALES -----

// Ver todos los menús principales
app.get('/admin/menus', isAdmin, async (req, res) => {
  const [menus] = await pool.query('SELECT * FROM menu_principal');
  res.render('admin-menus', { user: req.user, menus, noLayoutParts: true });
});

// Agregar menú principal
app.post('/admin/menus/add', isAdmin, async (req, res) => {
  const { nombre, ruta } = req.body;
  await pool.query('INSERT INTO menu_principal (nombre, ruta) VALUES (?, ?)', [nombre, ruta || null]);
  res.redirect('/admin/menus');
});

// Eliminar menú principal (elimina sus submenús por ON DELETE CASCADE)
app.post('/admin/menus/delete', isAdmin, async (req, res) => {
  const id = parseInt(req.body.id);
  await pool.query('DELETE FROM menu_principal WHERE id = ?', [id]);
  res.redirect('/admin/menus');
});

// Editar menú principal (formulario)
app.get('/admin/menus/edit/:id', isAdmin, async (req, res) => {
  const [menus] = await pool.query('SELECT * FROM menu_principal WHERE id = ?', [req.params.id]);
  res.render('edit-menu', { user: req.user, menu: menus[0], noLayoutParts: true });
});
// Guardar cambios
app.post('/admin/menus/edit/:id', isAdmin, async (req, res) => {
  const { nombre, ruta } = req.body;
  await pool.query('UPDATE menu_principal SET nombre=?, ruta=? WHERE id=?', [nombre, ruta || null, req.params.id]);
  res.redirect('/admin/menus');
});
//Editar web
app.get('/admin/web', isAdmin, async (req, res) => {
  const [menus] = await pool.query('SELECT * FROM menu_principal');
  // Para cada menú, trae sus submenús:
  for (let menu of menus) {
    const [submenus] = await pool.query('SELECT * FROM submenu WHERE id_menu = ?', [menu.id]);
    menu.submenus = submenus;
  }
  res.render('admin-web', { user: req.user, menus, noLayoutParts: true });
});

// ----- GESTIÓN DE SUBMENÚS -----

// Ver submenús de un menú principal
app.get('/admin/submenus/:menuId', isAdmin, async (req, res) => {
  const menuId = req.params.menuId;
  const [menu] = await pool.query('SELECT * FROM menu_principal WHERE id = ?', [menuId]);
  const [submenus] = await pool.query('SELECT * FROM submenu WHERE id_menu = ?', [menuId]);
  res.render('admin-submenus', { user: req.user, menu: menu[0], submenus, noLayoutParts: true });
});

// Agregar submenú
app.post('/admin/submenus/add', isAdmin, async (req, res) => {
  const { id_menu, nombre, ruta } = req.body;
  await pool.query('INSERT INTO submenu (id_menu, nombre, ruta) VALUES (?, ?, ?)', [id_menu, nombre, ruta || null]);
  res.redirect('/admin/submenus/' + id_menu);
});

// Eliminar submenú
app.post('/admin/submenus/delete', isAdmin, async (req, res) => {
  const { id, id_menu } = req.body;
  await pool.query('DELETE FROM submenu WHERE id = ?', [id]);
  res.redirect('/admin/submenus/' + id_menu);
});

// Editar submenú (formulario)
app.get('/admin/submenus/edit/:id', isAdmin, async (req, res) => {
  const [submenus] = await pool.query('SELECT * FROM submenu WHERE id = ?', [req.params.id]);
  res.render('edit-submenu', { user: req.user, submenu: submenus[0], noLayoutParts: true });
});
app.post('/admin/submenus/edit/:id', isAdmin, async (req, res) => {
  const { nombre, ruta, id_menu } = req.body;
  await pool.query('UPDATE submenu SET nombre=?, ruta=? WHERE id=?', [nombre, ruta || null, req.params.id]);
  res.redirect('/admin/submenus/' + id_menu);
});

function hora12h(hora24) {
  let [h, m] = hora24.split(':');
  h = parseInt(h, 10);
  let sufijo = h >= 12 ? 'pm' : 'am';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12.toString().padStart(2, '0')}:${m} ${sufijo}`;
}

function formatFechaLarga(fechaStr) {
  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const [anio, mes, dia] = fechaStr.split('-').map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  if (isNaN(fecha)) return fechaStr;
  let diaTexto = dias[fecha.getDay()];
  diaTexto = diaTexto.charAt(0).toUpperCase() + diaTexto.slice(1);
  return `${diaTexto} ${fecha.getDate()} de ${meses[fecha.getMonth()]} de ${fecha.getFullYear()}`;
}

// Ruta para guardar una cita
app.post('/api/citas', async (req, res) => {
  const { fecha, tipo_cita, hora, nombre, contacto, nota } = req.body;

  // Validación básica
  const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacto);
  const celularValido = /^[0-9]{7,15}$/.test(contacto);

  if (!fecha || !tipo_cita || !hora || !nombre || !contacto) {
    return res.status(400).json({ ok: false, error: 'Datos incompletos.' });
  }

  // Validación de fecha y hora no pasadas
  try {
    const ahora = new Date();
    const citaFechaHora = new Date(`${fecha}T${hora}`);
    if (citaFechaHora < ahora) {
      return res.status(400).json({ ok: false, error: 'No puedes agendar una cita en el pasado.' });
    }
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'Fecha u hora inválida.' });
  }

  try {
    // Guardar cita en la base de datos
    await pool.query(
      'INSERT INTO citas (fecha, tipo_cita, hora, nombre, contacto, nota) VALUES (?, ?, ?, ?, ?, ?)',
      [fecha, tipo_cita, hora, nombre, contacto, nota]
    );

    // ENVÍO DE NOTIFICACIONES
    const fechaLarga = formatFechaLarga(fecha); // Asumes que esta función ya existe
    const horaBonita = hora12h(hora); // Asumes que esta función ya existe

    // Correos internos para notificación
    const correosInternos = [
      "tebanluc29@gmail.com",
      "tebanluc24@gmail.com",
      "tebanluc26@gmail.com"
    ];

    // Si el contacto es correo electrónico (usuario)
    if (correoValido) {
      // 1. Confirmación al usuario
      await transporter.sendMail({
        from: '"Citas Liceo Michoacano" <test@liceomichoacano.com>',
        to: contacto,
        subject: 'Confirmación de cita',
        html: `
      <div style="background:#181818;padding:36px 0;">
        <table style="max-width:420px;margin:0 auto;background:#232323;border-radius:18px;box-shadow:0 3px 16px rgba(0,0,0,0.17);border-collapse:collapse;" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:32px 32px 12px 32px;text-align:center;">
              <img src="https://cdn-icons-png.flaticon.com/512/3135/3135715.png" alt="User Icon" style="width:60px;margin-bottom:14px;opacity:.92;border-radius:50%;">
              <h2 style="color:#fff;margin-bottom:2px;font-family:Segoe UI,Arial,sans-serif;font-weight:600;letter-spacing:.1px;">
                Citas Liceo Michoacano
              </h2>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 12px 32px;text-align:center;">
              <p style="color:#fff;font-size:15px;line-height:1.5;font-family:Segoe UI,Arial,sans-serif;margin:0;">
                ¡Hola <b style="color:#46aaf8;">${nombre}</b>!
              </p>
              <p style="color:#fff;font-size:15px;line-height:1.5;font-family:Segoe UI,Arial,sans-serif;margin:6px 0 0 0;">
                Tu cita para <b style="color:#fff;font-weight:700;">${tipo_cita}</b> está agendada el
              </p>
              <p style="margin:10px 0 0 0;">
                <span style="font-size:16px;color:#e1ba34;display:inline-block;font-weight:bold;letter-spacing:0.2px;">
                  ${fechaLarga} a las ${horaBonita}
                </span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 20px 32px;text-align:center;">
              <div style="color:#b0b0b0;font-size:13px;margin-top:16px;font-family:Segoe UI,Arial,sans-serif;">
                Si tienes dudas, responde a este correo.<br>
                ¡Te esperamos!
              </div>
            </td>
          </tr>
        </table>
      </div>
      `
      });

      // 2. Notificación a internos
      await transporter.sendMail({
        from: '"Citas Liceo Michoacano" <test@liceomichoacano.com>',
        to: correosInternos.join(','),
        subject: 'Nuevo usuario agendó una cita',
        html: `
        <div style="background:#f5f6fa;padding:32px 0;">
          <table style="max-width:420px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 2px 10px rgba(60,60,80,0.10);border-collapse:collapse;" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:28px 28px 10px 28px;text-align:center;">
                <h2 style="color:#3634a3;margin-bottom:4px;font-family:Segoe UI,Arial,sans-serif;font-weight:600;">
                  Nuevo usuario agendó una cita
                </h2>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 12px 28px;">
                <p style="color:#222;font-size:15px;line-height:1.5;font-family:Segoe UI,Arial,sans-serif;margin:0;">
                  <b>Nombre:</b> ${nombre}<br>
                  <b>Cita:</b> ${tipo_cita}<br>
                  <b>Fecha:</b> ${fechaLarga} <b>a las</b> ${horaBonita}<br>
                  <b>Contacto:</b> ${contacto}<br>
                  ${nota ? `<b>Nota:</b> ${nota}<br>` : ""}
                </p>
              </td>
            </tr>
          </table>
        </div>
        `
      });

      return res.json({ ok: true, tipo: 'correo' });

    } else if (celularValido) {
      // Si el contacto es celular, no mandamos email, pero podrías avisar a los internos si lo deseas.
      const msg = `Hola ${nombre}, tu cita para "${tipo_cita}" está agendada el ${fechaLarga} a las ${horaBonita}.`;
      const waUrl = 'https://wa.me/' + contacto + '?text=' + encodeURIComponent(msg);

      // También puedes notificar a internos por WhatsApp, aquí solo es por email.
      await transporter.sendMail({
        from: '"Citas Liceo Michoacano" <test@liceomichoacano.com>',
        to: correosInternos.join(','),
        subject: 'Nuevo usuario agendó una cita (vía celular)',
        html: `
        <div style="background:#f5f6fa;padding:32px 0;">
          <table style="max-width:420px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 2px 10px rgba(60,60,80,0.10);border-collapse:collapse;" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:28px 28px 10px 28px;text-align:center;">
                <h2 style="color:#3634a3;margin-bottom:4px;font-family:Segoe UI,Arial,sans-serif;font-weight:600;">
                  Nuevo usuario agendó una cita (vía celular)
                </h2>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 12px 28px;">
                <p style="color:#222;font-size:15px;line-height:1.5;font-family:Segoe UI,Arial,sans-serif;margin:0;">
                  <b>Nombre:</b> ${nombre}<br>
                  <b>Cita:</b> ${tipo_cita}<br>
                  <b>Fecha:</b> ${fechaLarga} <b>a las</b> ${horaBonita}<br>
                  <b>Contacto:</b> ${contacto}<br>
                  ${nota ? `<b>Nota:</b> ${nota}<br>` : ""}
                </p>
              </td>
            </tr>
          </table>
        </div>
        `
      });

      return res.json({ ok: true, tipo: 'whatsapp', waUrl });
    } else {
      return res.status(400).json({ ok: false, error: 'Contacto inválido.' });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Error al guardar la cita.' });
  }
});


// --- Middleware para obtener la IP real ---
function getClientIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress;
}

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post('/formulario-contacto', async (req, res) => {
  const { nombre, email, mensaje, website, interes } = req.body;
  const ip = getClientIP(req);

  // Anti-bot: Si el honeypot está lleno, ignora el registro
  if (website) return res.json({ ok: false, error: 'Bot detectado.' });

  // Validación simple (lado servidor)
  if (!nombre || nombre.length < 2 || !email || !mensaje || !interes) {
    return res.json({ ok: false, error: 'Datos inválidos.' });
  }

  // Anti-spam: No permitir más de 3 mensajes por IP por hora
  const [recent] = await pool.query(
    'SELECT COUNT(*) AS total FROM contactos WHERE ip = ? AND fecha > (NOW() - INTERVAL 1 HOUR)', [ip]
  );
  if (recent[0].total >= 3) {
    return res.json({ ok: false, error: 'Has enviado demasiados mensajes, intenta más tarde.' });
  }

  try {
    await pool.query(
      'INSERT INTO contactos (nombre, email, interes, mensaje, ip) VALUES (?, ?, ?, ?, ?)',
      [nombre, email, interes, mensaje, ip]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'No se pudo guardar el mensaje.' });
  }
});

// Ver todas las citas
app.get('/admin/citas', isAdmin, async (req, res) => {
  const [citas] = await pool.query('SELECT * FROM citas ORDER BY fecha DESC, hora DESC');
  const [contactos] = await pool.query('SELECT * FROM contactos ORDER BY fecha DESC, id DESC');
  res.render('admin-citas', { user: req.user, citas, contactos, noLayoutParts: true });
});

// Eliminar cita
app.post('/admin/citas/delete', isAdmin, async (req, res) => {
  const { id } = req.body;
  await pool.query('DELETE FROM citas WHERE id = ?', [id]);
  res.redirect('/admin/citas');
});

// Mostrar formulario para editar cita
app.get('/admin/citas/edit/:id', isAdmin, async (req, res) => {
  const [cita] = await pool.query('SELECT * FROM citas WHERE id = ?', [req.params.id]);
  res.render('edit-cita', { user: req.user, cita: cita[0], noLayoutParts: true });
});

// Guardar cambios en la cita editada
app.post('/admin/citas/edit/:id', isAdmin, async (req, res) => {
  const { fecha, tipo_cita, hora, nombre, contacto, nota } = req.body;
  await pool.query(
    'UPDATE citas SET fecha = ?, tipo_cita = ?, hora = ?, nombre = ?, contacto = ?, nota = ? WHERE id = ?',
    [fecha, tipo_cita, hora, nombre, contacto, nota, req.params.id]
  );
  res.redirect('/admin/citas');
});

// Eliminar cita
app.post('/admin/citas/delete', isAdmin, async (req, res) => {
  const { id } = req.body;
  await pool.query('DELETE FROM citas WHERE id = ?', [id]);
  res.redirect('/admin/citas-y-contactos');
});

// Eliminar contacto
app.post('/admin/contactos/delete', isAdmin, async (req, res) => {
  const { id } = req.body;
  await pool.query('DELETE FROM contactos WHERE id = ?', [id]);
  res.redirect('/admin/citas-y-contactos');
});

// ------- VENTAS -------------

app.get('/ventas/citas', isVentas, async (req, res) => {
  const [citas] = await pool.query('SELECT * FROM citas ORDER BY fecha DESC, hora DESC');
  const [contactos] = await pool.query('SELECT * FROM contactos ORDER BY fecha DESC, id DESC');
  res.render('ventas-citas', { user: req.user, citas, contactos, noLayoutParts: true });
});

// 404
app.use((req, res) => {
  res.status(404).send('Página no encontrada');
});

app.listen(3000, () => console.log('Servidor en http://localhost:3000'));
