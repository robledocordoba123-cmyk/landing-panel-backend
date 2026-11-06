const request = require('supertest');
const bcrypt = require('bcrypt');
const { app } = require('../app');

// Crea una cuenta y devuelve la cookie de sesión para usarla en las pruebas.
async function sesionDe(prisma, { email, rol = 'ADMIN', password = 'clave-de-pruebas-123', nombre = 'Prueba' }) {
  await prisma.usuario.deleteMany({ where: { email } });
  await prisma.usuario.create({ data: { email, rol, nombre, password: await bcrypt.hash(password, 4) } });
  const res = await request(app).post('/api/login').send({ email, password });
  return res.headers['set-cookie'][0].split(';')[0];
}

module.exports = { sesionDe };
