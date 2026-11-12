import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MailAttachment, MailMessage } from './mailer.js';

export type Idioma = 'pt' | 'en';

export interface DadosEmailRecuperacao {
  nome: string;
  login: string;
  link: string;
  idioma: Idioma;
  solicitadoEm: Date;
  validadeMinutos: number;
  appUrl: string;
  supportEmail?: string;
  siteUrl?: string;
}

const HEADER_CID = 'eduassets-header';
let headerCache: Buffer | null | undefined;

/** Banner shipped in the image (backend/assets/email/header.jpg); embedded inline so clients show it without remote fetches. */
function headerImage(): Buffer | null {
  if (headerCache !== undefined) return headerCache;
  try {
    headerCache = readFileSync(resolve(process.cwd(), 'assets/email/header.jpg'));
  } catch {
    headerCache = null;
  }
  return headerCache;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function formatarData(data: Date, idioma: Idioma): string {
  const texto = new Intl.DateTimeFormat(idioma === 'en' ? 'en-US' : 'pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(data);
  return idioma === 'en' ? `${texto} (Brasília time)` : `${texto} (horário de Brasília)`;
}

function textos(d: DadosEmailRecuperacao) {
  const quando = formatarData(d.solicitadoEm, d.idioma);
  if (d.idioma === 'en') {
    return {
      lang: 'en',
      subject: 'Reset your eduAssets password',
      preheader: `Use this link within ${d.validadeMinutos} minutes to choose a new password.`,
      title: 'Password reset',
      hello: `Hello, ${d.nome}.`,
      intro: 'We received a request to reset the password of your eduAssets account. To choose a new password, click the button below.',
      action: 'Set a new password',
      fallback: 'If the button does not work, copy and paste this address into your browser:',
      detailsTitle: 'Request details',
      account: 'Account',
      requested: 'Requested on',
      validity: 'Valid for',
      validityValue: `${d.validadeMinutos} minutes, single use`,
      requested_value: quando,
      nextTitle: 'What happens next',
      next: [
        'The new password must have at least 12 characters, with uppercase and lowercase letters, a number and a symbol.',
        'After saving it, every open session of the account is signed out, and you sign in again with the new password.',
        'Only the most recent link is valid: requesting a new one cancels this one.',
      ],
      securityTitle: "Didn't request this?",
      security: 'You can safely ignore this message: your current password keeps working and nothing changes. eduAssets never asks for your password by email.',
      securitySupport: 'If you receive this message repeatedly without asking for it, contact support.',
      tagline: 'School asset management',
      supportLabel: 'Support',
      openApp: 'Open eduAssets',
      site: 'Website',
      auto: 'This is an automatic message; replies to the sending address are not monitored.',
      reason: `You received this email because a password reset was requested for the eduAssets account ${d.login}.`,
    };
  }
  return {
    lang: 'pt-BR',
    subject: 'Redefinição de senha do eduAssets',
    preheader: `Use este link em até ${d.validadeMinutos} minutos para definir uma nova senha.`,
    title: 'Redefinição de senha',
    hello: `Olá, ${d.nome}.`,
    intro: 'Recebemos um pedido para redefinir a senha da sua conta no eduAssets. Para escolher uma nova senha, clique no botão abaixo.',
    action: 'Definir nova senha',
    fallback: 'Se o botão não funcionar, copie e cole este endereço no navegador:',
    detailsTitle: 'Detalhes da solicitação',
    account: 'Conta',
    requested: 'Solicitado em',
    validity: 'Validade',
    validityValue: `${d.validadeMinutos} minutos, uso único`,
    requested_value: quando,
    nextTitle: 'O que acontece em seguida',
    next: [
      'A nova senha precisa ter pelo menos 12 caracteres, com letras maiúsculas e minúsculas, número e símbolo.',
      'Ao salvar, todas as sessões abertas da conta são encerradas e você entra novamente com a nova senha.',
      'Só o link mais recente é válido: um novo pedido cancela este.',
    ],
    securityTitle: 'Não foi você?',
    security: 'Pode ignorar esta mensagem com segurança: sua senha atual continua valendo e nada é alterado. O eduAssets nunca pede sua senha por e-mail.',
    securitySupport: 'Se você receber esta mensagem repetidamente sem ter feito o pedido, fale com o suporte.',
    tagline: 'Gestão de ativos escolares',
    supportLabel: 'Suporte',
    openApp: 'Acessar o eduAssets',
    site: 'Site',
    auto: 'Esta é uma mensagem automática; respostas ao endereço de envio não são monitoradas.',
    reason: `Você recebeu este e-mail porque foi solicitada a redefinição de senha da conta ${d.login} no eduAssets.`,
  };
}

export function montarEmailRecuperacao(d: DadosEmailRecuperacao): Omit<MailMessage, 'to'> {
  const t = textos(d);
  const e = escapeHtml;
  const ano = d.solicitadoEm.getUTCFullYear();
  const banner = headerImage();
  const attachments: MailAttachment[] = banner
    ? [{ filename: 'eduassets-header.jpg', content: banner, cid: HEADER_CID, contentType: 'image/jpeg' }]
    : [];

  const supportText = d.supportEmail ? `${t.supportLabel}: ${d.supportEmail}` : '';
  const text = [
    `eduAssets — ${t.title}`,
    '',
    t.hello,
    '',
    t.intro,
    '',
    `${t.action}:`,
    d.link,
    '',
    `${t.detailsTitle}`,
    `- ${t.account}: ${d.login}`,
    `- ${t.requested}: ${t.requested_value}`,
    `- ${t.validity}: ${t.validityValue}`,
    '',
    t.nextTitle,
    ...t.next.map((linha) => `- ${linha}`),
    '',
    t.securityTitle,
    t.security,
    t.securitySupport,
    '',
    '—',
    `eduAssets · ${t.tagline}`,
    `${t.openApp}: ${d.appUrl}`,
    ...(d.siteUrl ? [`${t.site}: ${d.siteUrl}`] : []),
    ...(supportText ? [supportText] : []),
    '',
    t.auto,
    t.reason,
    `© ${ano} eduAssets`,
  ].join('\n');

  const font = "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;";
  const header = banner
    ? `<img src="cid:${HEADER_CID}" width="600" height="200" alt="eduAssets" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;color:#ffffff;font-size:28px;font-weight:bold;${font}">`
    : `<div style="padding:44px 24px;text-align:center;${font}font-size:30px;font-weight:bold;color:#ffffff;">edu<span style="color:#3b82f6;">Assets</span></div>`;
  const linhaDetalhe = (rotulo: string, valor: string) => `
                <tr>
                  <td style="padding:6px 0;${font}font-size:13px;color:#64748b;width:110px;padding-right:12px;vertical-align:top;">${e(rotulo)}</td>
                  <td style="padding:6px 0;${font}font-size:13px;color:#0f172a;font-weight:bold;vertical-align:top;overflow-wrap:break-word;word-break:break-word;">${e(valor)}</td>
                </tr>`;
  const footerLinks = [
    `<a href="${e(d.appUrl)}" style="color:#93c5fd;text-decoration:none;">${e(t.openApp)}</a>`,
    ...(d.siteUrl ? [`<a href="${e(d.siteUrl)}" style="color:#93c5fd;text-decoration:none;">${e(t.site)}</a>`] : []),
    ...(d.supportEmail ? [`<a href="mailto:${e(d.supportEmail)}" style="color:#93c5fd;text-decoration:none;">${e(d.supportEmail)}</a>`] : []),
  ].join(' &nbsp;·&nbsp; ');

  const html = `<!doctype html>
<html lang="${t.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(t.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef2f7;font-size:1px;line-height:1px;">${e(t.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f7;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dbe3ee;">
        <tr>
          <td style="background-color:#000318;line-height:0;">${header}</td>
        </tr>
        <tr>
          <td style="padding:32px 36px 8px 36px;">
            <p style="margin:0 0 6px 0;${font}font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#2563eb;font-weight:bold;">eduAssets</p>
            <h1 style="margin:0 0 20px 0;${font}font-size:24px;line-height:1.3;color:#0f172a;">${e(t.title)}</h1>
            <p style="margin:0 0 12px 0;${font}font-size:15px;line-height:1.6;color:#334155;">${e(t.hello)}</p>
            <p style="margin:0 0 24px 0;${font}font-size:15px;line-height:1.6;color:#334155;">${e(t.intro)}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
              <tr>
                <td align="center" bgcolor="#2563eb" style="border-radius:8px;">
                  <a href="${e(d.link)}" target="_blank" style="display:inline-block;padding:14px 30px;${font}font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${e(t.action)}</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 6px 0;${font}font-size:12px;line-height:1.5;color:#64748b;">${e(t.fallback)}</p>
            <p style="margin:0 0 28px 0;${font}font-size:12px;line-height:1.5;word-break:break-all;"><a href="${e(d.link)}" style="color:#2563eb;text-decoration:underline;">${e(d.link)}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 8px 0;${font}font-size:13px;font-weight:bold;color:#0f172a;">${e(t.detailsTitle)}</p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${linhaDetalhe(t.account, d.login)}${linhaDetalhe(t.requested, t.requested_value)}${linhaDetalhe(t.validity, t.validityValue)}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 36px 0 36px;">
            <p style="margin:0 0 8px 0;${font}font-size:14px;font-weight:bold;color:#0f172a;">${e(t.nextTitle)}</p>
            <ul style="margin:0;padding:0 0 0 18px;${font}font-size:13px;line-height:1.6;color:#475569;">
              ${t.next.map((linha) => `<li style="margin:0 0 4px 0;">${e(linha)}</li>`).join('\n              ')}
            </ul>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 36px 32px 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fff7ed;border-left:4px solid #f59e0b;border-radius:6px;">
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0 0 6px 0;${font}font-size:14px;font-weight:bold;color:#9a3412;">${e(t.securityTitle)}</p>
                  <p style="margin:0 0 6px 0;${font}font-size:13px;line-height:1.55;color:#7c2d12;">${e(t.security)}</p>
                  <p style="margin:0;${font}font-size:13px;line-height:1.55;color:#7c2d12;">${e(t.securitySupport)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background-color:#0b1220;padding:24px 36px;">
            <p style="margin:0 0 4px 0;${font}font-size:16px;font-weight:bold;color:#ffffff;">edu<span style="color:#60a5fa;">Assets</span></p>
            <p style="margin:0 0 14px 0;${font}font-size:12px;color:#94a3b8;">${e(t.tagline)}</p>
            <p style="margin:0 0 14px 0;${font}font-size:12px;line-height:1.6;color:#cbd5e1;">${footerLinks}</p>
            <p style="margin:0 0 6px 0;${font}font-size:11px;line-height:1.5;color:#94a3b8;">${e(t.auto)}</p>
            <p style="margin:0 0 6px 0;${font}font-size:11px;line-height:1.5;color:#94a3b8;">${e(t.reason)}</p>
            <p style="margin:0;${font}font-size:11px;color:#64748b;">© ${ano} eduAssets</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return {
    subject: t.subject,
    text,
    html,
    ...(attachments.length ? { attachments } : {}),
    ...(d.supportEmail ? { replyTo: d.supportEmail } : {}),
  };
}
