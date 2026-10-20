// Las pruebas usan su propia base de datos (huellitas_test), nunca la de desarrollo.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgresql://ritmoapp:ritmoapp_dev@localhost:5432/huellitas_test?schema=public';
process.env.JWT_SECRET = 'secreto-de-pruebas';
delete process.env.ANTHROPIC_API_KEY;
