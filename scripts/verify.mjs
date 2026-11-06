#!/usr/bin/env node
// Confere o que o build gerou, do mesmo jeito que o Cockpit vai conferir: assinatura, hashes e skills completas.
import { createPublicKey, createHash, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(process.argv[2] || 'dist');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const fail = message => { console.error(`ERRO: ${message}`); process.exit(1); };

const manifestBytes = readFileSync(join(dir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const publicKey = createPublicKey(readFileSync(join(root, 'public-key.pem')));
const signature = Buffer.from(readFileSync(join(dir, 'manifest.sig'), 'utf8').trim(), 'base64');
if (!verify(null, manifestBytes, publicKey, signature)) fail('assinatura do manifesto não confere');
const bundle = readFileSync(join(dir, manifest.bundle.file));
if (sha256(bundle) !== manifest.bundle.sha256) fail('hash do pacote não confere');
if (sha256(readFileSync(join(dir, manifest.mcp.file))) !== manifest.mcp.sha256) fail('hash dos MCPs não confere');
const files = JSON.parse(gunzipSync(bundle));
for (const skill of manifest.skills) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(skill.name)) fail(`nome inválido: ${skill.name}`);
  const entries = files[skill.name];
  if (!entries?.some(entry => entry.path === 'SKILL.md')) fail(`skill incompleta: ${skill.name}`);
  for (const entry of entries) if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) fail(`caminho inválido em ${skill.name}`);
}
const presets = JSON.parse(readFileSync(join(dir, manifest.mcp.file), 'utf8')).presets;
for (const preset of presets) if (!preset.url || preset.command || preset.args || preset.engine) fail(`MCP remoto só pode ser de serviço online: ${preset.id}`);
console.log(`OK: ${manifest.skills.length} skills, ${presets.length} MCPs, versão ${manifest.version}.`);
