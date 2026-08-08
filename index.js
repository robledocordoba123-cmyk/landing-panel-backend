require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());
const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware para verificar el token
function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'No autorizado, falta el token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const datosUsuario = jwt.verify(token, JWT_SECRET);
    req.usuario = datosUsuario;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

app.get('/', (req, res) => {
  res.send('¡Hola! El servidor está funcionando 🚀');
});

// Ruta para GUARDAR un mensaje nuevo
app.post('/api/mensajes', async (req, res) => {
  try {
    const { nombre, email, telefono, mensaje } = req.body;

    const nuevoMensaje = await prisma.mensaje.create({
      data: { nombre, email, telefono, mensaje }
    });

    res.status(201).json(nuevoMensaje);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo guardar el mensaje' });
  }
});

// Ruta para LEER todos los mensajes (protegida)
app.get('/api/mensajes', verificarToken, async (req, res) => {
  try {
    const mensajes = await prisma.mensaje.findMany({
      orderBy: { creadoEn: 'desc' }
    });

    res.json(mensajes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudieron obtener los mensajes' });
  }
});

// Ruta para crear un usuario administrador (solo la usamos una vez)
app.post('/api/registro', async (req, res) => {
  try {
    const { email, password } = req.body;

    const passwordHasheado = await bcrypt.hash(password, 10);

    const nuevoUsuario = await prisma.usuario.create({
      data: {
        email,
        password: passwordHasheado
      }
    });

    res.status(201).json({ id: nuevoUsuario.id, email: nuevoUsuario.email });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo crear el usuario' });
  }
});

// Ruta para hacer LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const usuario = await prisma.usuario.findUnique({
      where: { email }
    });

    if (!usuario) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const passwordCorrecto = await bcrypt.compare(password, usuario.password);

    if (!passwordCorrecto) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});