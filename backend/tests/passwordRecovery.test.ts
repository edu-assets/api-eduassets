import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  gerarResetToken,
  hashResetToken,
  getAppPublicUrl,
  montarLinkRecuperacao,
  getEmailContacts,
} from '../src/services/passwordRecovery.service.js';
import { montarEmailRecuperacao, type DadosEmailRecuperacao } from '../src/lib/passwordRecoveryEmail.js';
import { getMailConfig } from '../src/lib/mailer.js';
import { getRuntimeConfig } from '../src/config/runtimeConfig.js';
import { solicitarRecuperacaoSchema, redefinirSenhaTokenSchema } from '../src/schemas/auth.schema.js';

describe('password recovery tokens and links', () => {
  it('generates 256-bit URL-safe tokens and stores only a SHA-256 hash', () => {
    const token = gerarResetToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(gerarResetToken(), token);
    assert.match(hashResetToken(token), /^[0-9a-f]{64}$/);
    assert.equal(hashResetToken(token), hashResetToken(token));
  });

  it('puts the token in the URL fragment of the public app URL', () => {
    assert.equal(montarLinkRecuperacao('abc', 'https://app.example.test'), 'https://app.example.test/#redefinir-senha=abc');
    assert.equal(getAppPublicUrl({ NODE_ENV: 'test', APP_PUBLIC_URL: 'https://app.example.test/' }), 'https://app.example.test');
    assert.equal(getAppPublicUrl({ NODE_ENV: 'test', CORS_ORIGIN: 'https://a.example.test,https://b.example.test' }), 'https://a.example.test');
  });

  const base: DadosEmailRecuperacao = {
    nome: 'Ana',
    login: 'ana@example.test',
    link: 'https://app.example.test/#redefinir-senha=tok',
    idioma: 'pt',
    solicitadoEm: new Date('2026-11-12T14:45:00Z'),
    validadeMinutos: 30,
    appUrl: 'https://app.example.test',
  };

  it('escapes user data in the HTML email and localizes the content', () => {
    const pt = montarEmailRecuperacao({ ...base, nome: '<script>x</script>' });
    assert.match(pt.subject, /Redefinição de senha/);
    assert.doesNotMatch(pt.html, /<script>/);
    assert.match(pt.html, /&lt;script&gt;/);
    assert.match(pt.text, /30 minutos, uso único/);
    assert.match(pt.text, /12 de novembro de 2026.*11:45.*horário de Brasília/);
    const en = montarEmailRecuperacao({ ...base, idioma: 'en' });
    assert.match(en.subject, /Reset your eduAssets password/);
    assert.match(en.text, /30 minutes, single use/);
    assert.match(en.text, /November 12, 2026.*11:45.*Brasília time/);
  });

  it('includes the reset link as button and fallback, the account and the banner inline', () => {
    const email = montarEmailRecuperacao(base);
    assert.equal(email.html.split('https://app.example.test/#redefinir-senha=tok').length - 1, 3, 'button href, fallback href and fallback text');
    assert.match(email.text, /https:\/\/app\.example\.test\/#redefinir-senha=tok/);
    assert.match(email.html, /ana@example\.test/);
    assert.match(email.html, /src="cid:eduassets-header"/);
    assert.equal(email.attachments?.[0]?.cid, 'eduassets-header');
    assert.ok((email.attachments?.[0]?.content.length ?? 0) > 1000);
    assert.equal(email.replyTo, undefined);
  });

  it('adds support and site contacts only when configured', () => {
    const contacts = getEmailContacts({ SUPPORT_EMAIL: ' suporte@example.test ', PUBLIC_SITE_URL: 'https://example.test/' });
    assert.deepEqual(contacts, { supportEmail: 'suporte@example.test', siteUrl: 'https://example.test' });
    const email = montarEmailRecuperacao({ ...base, ...contacts });
    assert.equal(email.replyTo, 'suporte@example.test');
    assert.match(email.html, /mailto:suporte@example\.test/);
    assert.match(email.text, /Suporte: suporte@example\.test/);
    assert.match(email.html, /href="https:\/\/example\.test"/);
    assert.deepEqual(getEmailContacts({}), {});
  });
});

describe('password recovery configuration', () => {
  it('treats mail as disabled when no SMTP variable is set and rejects partial configuration', () => {
    assert.equal(getMailConfig({}), null);
    assert.throws(() => getMailConfig({ SMTP_HOST: 'smtp.example.test' }), /SMTP_USER, SMTP_PASS, MAIL_FROM/);
    assert.throws(() => getRuntimeConfig({ NODE_ENV: 'test', SMTP_HOST: 'smtp.example.test' }), /incompleta/);
    assert.throws(() => getRuntimeConfig({ NODE_ENV: 'test', SUPPORT_EMAIL: 'not-an-email' }), /SUPPORT_EMAIL/);
    assert.throws(() => getRuntimeConfig({ NODE_ENV: 'test', PUBLIC_SITE_URL: 'ftp://x' }), /PUBLIC_SITE_URL/);
  });

  it('uses implicit TLS on 465 and STARTTLS on other ports', () => {
    const base = { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'u@example.test', SMTP_PASS: 'p', MAIL_FROM: 'eduAssets <u@example.test>' };
    assert.deepEqual(getMailConfig(base), {
      host: 'smtp.example.test', port: 465, secure: true, user: 'u@example.test', pass: 'p', from: 'eduAssets <u@example.test>',
    });
    assert.equal(getMailConfig({ ...base, SMTP_PORT: '587' })?.secure, false);
    assert.throws(() => getMailConfig({ ...base, SMTP_PORT: 'abc' }), /SMTP_PORT/);
  });

  it('requires an HTTPS APP_PUBLIC_URL in production', () => {
    const prod = {
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://u@h/db', JWT_SECRET: 'x'.repeat(32),
      CORS_ORIGIN: 'https://app.example.test', TRUST_PROXY: '1',
    };
    assert.throws(() => getRuntimeConfig({ ...prod, APP_PUBLIC_URL: 'http://app.example.test' }), /HTTPS/);
    assert.doesNotThrow(() => getRuntimeConfig({ ...prod, APP_PUBLIC_URL: 'https://app.example.test' }));
  });
});

describe('password recovery request validation', () => {
  it('accepts a login and an optional language only', () => {
    assert.equal(solicitarRecuperacaoSchema.safeParse({ login: ' Ana@Example.test ' }).data?.login, 'ana@example.test');
    assert.equal(solicitarRecuperacaoSchema.safeParse({ login: 'a@b.c', idioma: 'fr' }).success, false);
    assert.equal(solicitarRecuperacaoSchema.safeParse({ login: 'a@b.c', extra: 1 }).success, false);
  });

  it('requires a well-formed token and a strong password', () => {
    const token = gerarResetToken();
    assert.equal(redefinirSenhaTokenSchema.safeParse({ token, senha: 'Strong-Password-01' }).success, true);
    assert.equal(redefinirSenhaTokenSchema.safeParse({ token, senha: 'weakpassword' }).success, false);
    assert.equal(redefinirSenhaTokenSchema.safeParse({ token: 'short', senha: 'Strong-Password-01' }).success, false);
    assert.equal(redefinirSenhaTokenSchema.safeParse({ token, senha: `Aa1!${'é'.repeat(40)}` }).success, false);
  });
});
