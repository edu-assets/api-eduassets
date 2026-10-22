import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { readSeedConfig } from './seedConfig.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const config = readSeedConfig(process.env);
  const adminPasswordHash = await bcrypt.hash(config.adminPassword, 12);

  // Upsert preserves existing accounts and passwords on repeated seed runs.
  await prisma.usuario.upsert({
    where: { login: config.adminEmail },
    update: {},
    create: {
      nome: 'Initial Administrator',
      login: config.adminEmail,
      passwordHash: adminPasswordHash,
      nivelAcesso: 'ADMINISTRADOR',
    },
  });

  if (config.editorEmail && config.editorPassword) {
    const editorPasswordHash = await bcrypt.hash(config.editorPassword, 12);
    await prisma.usuario.upsert({
      where: { login: config.editorEmail },
      update: {},
      create: {
        nome: 'Initial Editor',
        login: config.editorEmail,
        passwordHash: editorPasswordHash,
        nivelAcesso: 'EDITOR',
      },
    });
  }

  console.log('Seed completed. Existing accounts were left unchanged.');
}

main()
  .catch(() => {
    // ORM errors can include connection details; never print environment-derived credentials.
    console.error('Seed failed. Check required seed settings and database connectivity.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
