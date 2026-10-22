import assert from 'node:assert/strict';
import test from 'node:test';
import { loginSchema } from '../src/schemas/auth.schema.js';
import { usuarioCreateSchema } from '../src/schemas/usuario.schema.js';

test('normalizes login identifiers before authentication and persistence', () => {
  assert.equal(loginSchema.parse({ login: '  Admin@Example.COM ', password: 'secret' }).login, 'admin@example.com');
  assert.equal(
    usuarioCreateSchema.parse({
      nome: 'Admin',
      login: '  Admin@Example.COM ',
      senha: 'strong-password',
      nivelAcesso: 'ADMINISTRADOR',
    }).login,
    'admin@example.com'
  );
});
