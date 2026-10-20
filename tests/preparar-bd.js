// Aplica las migraciones a la base de pruebas antes de correr Jest.
require('./entorno');
require('child_process').execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
