export interface SeedConfig {
  adminEmail: string;
  adminPassword: string;
  editorEmail?: string;
  editorPassword?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requiredEmail(value: string | undefined, variable: string): string {
  const email = value?.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    throw new Error(`${variable} must be set to a valid email address.`);
  }
  return email;
}

function requiredPassword(value: string | undefined, variable: string): string {
  if (!value || Array.from(value).length < 16 || Buffer.byteLength(value, 'utf8') > 72) {
    throw new Error(`${variable} must contain at least 16 characters and at most 72 UTF-8 bytes.`);
  }
  return value;
}

export function readSeedConfig(env: NodeJS.ProcessEnv): SeedConfig {
  const adminEmail = requiredEmail(env.SEED_ADMIN_EMAIL, 'SEED_ADMIN_EMAIL');
  const adminPassword = requiredPassword(env.SEED_ADMIN_PASSWORD, 'SEED_ADMIN_PASSWORD');
  const hasEditorEmail = Boolean(env.SEED_EDITOR_EMAIL?.trim());
  const hasEditorPassword = Boolean(env.SEED_EDITOR_PASSWORD);

  if (hasEditorEmail !== hasEditorPassword) {
    throw new Error('SEED_EDITOR_EMAIL and SEED_EDITOR_PASSWORD must either both be set or both be omitted.');
  }

  if (!hasEditorEmail) return { adminEmail, adminPassword };

  const editorEmail = requiredEmail(env.SEED_EDITOR_EMAIL, 'SEED_EDITOR_EMAIL');
  if (editorEmail === adminEmail) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_EDITOR_EMAIL must identify different accounts.');
  }

  return {
    adminEmail,
    adminPassword,
    editorEmail,
    editorPassword: requiredPassword(env.SEED_EDITOR_PASSWORD, 'SEED_EDITOR_PASSWORD'),
  };
}
