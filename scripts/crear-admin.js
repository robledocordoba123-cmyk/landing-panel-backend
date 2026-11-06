// Crea (o actualiza la contraseña de) la cuenta del panel.
// Uso: ADMIN_EMAIL=correo@negocio.co ADMIN_PASSWORD='clave-larga' npm run crear-admin
require('dotenv').config();
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';

if (!email || password.length < 12) {
  console.error('Define ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres).');
  process.exit(1);
}

const prisma = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash(password, 12);
  const nombre = process.env.ADMIN_NOMBRE || 'Administración';
  await prisma.usuario.upsert({
    where: { email },
    update: { password: hash, rol: 'ADMIN', activo: true, sesionVersion: { increment: 1 } },
    create: { email, password: hash, nombre, rol: 'ADMIN' },
  });
  console.log(`Cuenta del panel lista: ${email}`);
  await prisma.$disconnect();
})();
