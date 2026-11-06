#!/usr/bin/env node
// Monta o catálogo do Cockpit: skills (pacote), MCPs e o manifesto assinado.
//   node scripts/build.mjs            reconstrói nos commits fixados em sources.json
//   node scripts/build.mjs --latest   antes, move cada fonte para o último commit dela (sources.json é atualizado)
//   --sources-dir <pasta>             usa cópias locais (testes), sem rede
// Cada fonte que falhar no commit novo volta ao commit anterior dela; o catálogo nunca perde skills por causa de uma fonte.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createHash, createPrivateKey, sign } from 'node:crypto';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(repoRoot, 'dist');
const sourcesFile = join(repoRoot, 'sources.json');
const config = JSON.parse(readFileSync(sourcesFile, 'utf8'));
const latest = process.argv.includes('--latest');
const arg = process.argv.indexOf('--sources-dir');
const localSources = arg >= 0 ? resolve(process.argv[arg + 1]) : undefined;
const temporary = mkdtempSync(join(tmpdir(), 'cockpit-catalog-build-'));
const MAX_MEDIA_BYTES = 400_000;
const MEDIA = /\.(jpe?g|png|gif|webp|bmp|tiff?|mp3|wav|ogg|m4a|mp4|mov|webm|avi)$/i;
let skipped = [];
const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Conteúdo de uma skill: o mesmo cálculo que o Cockpit refaz na pasta instalada para saber se a pessoa a editou. */
export function contentHash(entries) {
  return sha256(entries.map(entry => `${entry.path}\0${sha256(Buffer.from(entry.data, 'base64'))}`).sort().join('\n'));
}

function entries(root, base = root) {
  return readdirSync(base).sort().flatMap(name => {
    if (['.git', 'node_modules', '__pycache__', '.DS_Store'].includes(name)) return [];
    const path = join(base, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Symlink requires explicit mapping: ${path}`);
    if (stat.isDirectory()) return entries(root, path);
    // Skill é instrução, não mídia: imagens e áudio grandes de demonstração só pesariam no download de todo usuário.
    if (stat.size > MAX_MEDIA_BYTES && MEDIA.test(name)) { skipped.push(`${relative(root, path).split('\\').join('/')} (${Math.round(stat.size / 1024)} KB)`); return []; }
    return [{ path: relative(root, path).split('\\').join('/'), data: readFileSync(path).toString('base64'), executable: Boolean(stat.mode & 0o111) }];
  });
}

function upstreamHead(source) {
  try {
    const out = execFileSync('git', ['ls-remote', `https://github.com/${source.repo}.git`, 'HEAD'], { encoding: 'utf8', timeout: 60_000 });
    const sha = out.split(/\s/)[0];
    return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
  } catch { return undefined; }
}

/** Baixa a fonte no commit pedido (ou usa a cópia local) e devolve a pasta. */
function fetchSource(source, sha, index) {
  if (localSources) return join(localSources, source.repo.replace('/', '--'));
  const root = join(temporary, `${index}-${source.repo.replace('/', '--')}-${sha.slice(0, 8)}`);
  if (source.kind === 'archive') {
    const archive = join(temporary, `upstream-${index}.zip`);
    execFileSync('curl', ['-fLs', '--max-time', '90', source.url, '-o', archive]);
    if (sha256(readFileSync(archive)) !== source.sha) throw new Error(`Upstream checksum mismatch: ${source.repo}`);
    // Valida os caminhos do ZIP antes de extrair.
    execFileSync('python3', ['-c', `import sys,zipfile,pathlib,stat
root=pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for entry in z.infolist():
  target=(root/entry.filename).resolve()
  if not target.is_relative_to(root) or stat.S_ISLNK(entry.external_attr >> 16):
   raise ValueError('Unsafe archive entry: '+entry.filename)
 z.extractall(root)
`, archive, root]);
    return root;
  }
  execFileSync('git', ['init', root], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', `https://github.com/${source.repo}.git`]);
  execFileSync('git', ['-C', root, 'fetch', '--depth=1', 'origin', sha], { stdio: 'inherit' });
  execFileSync('git', ['-C', root, 'checkout', '--detach', 'FETCH_HEAD'], { stdio: 'ignore' });
  return root;
}

/** Skills de uma fonte num commit. Lança erro se algo nela for inválido (o chamador volta ao commit anterior). */
function collect(source, root, sha, index) {
  const files = {};
  const skills = [];
  const selected = source.paths.flatMap(path => {
    const full = join(root, path);
    if (lstatSync(full).isFile()) return [full];
    if (existsSync(join(full, 'SKILL.md'))) return [join(full, 'SKILL.md')];
    return readdirSync(full).sort().filter(name => existsSync(join(full, name, 'SKILL.md'))).map(name => join(full, name, 'SKILL.md'));
  });
  if (source.adapter) selected.push(join(repoRoot, 'skill-adapters', source.adapter, 'SKILL.md'));
  for (const skillFile of selected) {
    const text = readFileSync(skillFile, 'utf8');
    const name = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
    if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name) || files[name]) throw new Error(`Invalid or duplicate skill name: ${skillFile}`);
    const stage = join(temporary, 'stage', `${index}-${name}`);
    mkdirSync(stage, { recursive: true });
    // Um SKILL.md na raiz não é licença para empacotar o repositório de uma ferramenta inteira.
    if (source.paths.length === 1 && lstatSync(join(root, source.paths[0])).isFile()) cpSync(skillFile, join(stage, 'SKILL.md'));
    else cpSync(dirname(skillFile), stage, { recursive: true });
    for (const [from, to] of Object.entries(source.extra || {})) cpSync(join(root, from), join(stage, to), { recursive: true });
    for (const license of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'NOTICE']) {
      if (existsSync(join(root, license))) cpSync(join(root, license), join(stage, `UPSTREAM-${license}`));
    }
    writeFileSync(join(stage, 'COCKPIT-SOURCE.json'), JSON.stringify({ name, source: source.repo, sha }));
    skipped = [];
    files[name] = entries(stage);
    if (skipped.length) report.push(`${name}: sem arquivos grandes: ${skipped.join(', ')}`);
    const requirements = source.skillRequirements?.[name] || source.requirements;
    const setup = source.skillSetup?.[name] || source.setup || (requirements.length ? {
      title: name,
      steps: ["Confira os requisitos abaixo e as instruções da skill antes de instalar ferramentas ou conectar contas.", "Siga o guia oficial para configurar as ferramentas no servidor do Cockpit ou no projeto, conforme indicado.", "Valide a configuração no agente que usará a skill. Ativar a skill disponibiliza suas instruções; não configura ferramentas externas."],
      links: [{ label: "Guia oficial", url: source.kind === 'archive' ? 'https://uizze.com' : `https://github.com/${source.repo}` }],
    } : undefined);
    skills.push({ name, source: source.repo, path: source.adapter ? `cockpit-adapter:${source.adapter}` : relative(root, skillFile).split('\\').join('/'), categories: source.skillCategories?.[name] || source.categories, requirements, ...(setup ? { setup } : {}), hash: contentHash(files[name]) });
  }
  return { files, skills };
}

const allFiles = {};
const allSkills = [];
const report = [];
try {
  for (const [index, source] of config.sources.entries()) {
    const pinned = source.sha;
    const candidates = [];
    if (latest && source.kind !== 'archive') {
      const head = upstreamHead(source);
      if (head && head !== pinned) candidates.push(head);
    }
    candidates.push(pinned);
    let done;
    let lastError;
    for (const sha of candidates) {
      try {
        const root = fetchSource(source, sha, index);
        done = { sha, ...collect(source, root, sha, index) };
        break;
      } catch (error) { lastError = error; report.push(`${source.repo}: ${sha.slice(0, 8)} falhou (${String(error.message).split('\n')[0]})`); }
    }
    if (!done) throw new Error(`${source.repo}: nenhum commit válido (${lastError?.message})`);
    if (done.sha !== pinned) { report.push(`${source.repo}: ${pinned.slice(0, 8)} -> ${done.sha.slice(0, 8)}`); source.sha = done.sha; }
    for (const skill of done.skills) {
      if (allFiles[skill.name]) throw new Error(`Skill duplicada entre fontes: ${skill.name}`);
      allSkills.push(skill);
    }
    Object.assign(allFiles, done.files);
  }

  mkdirSync(output, { recursive: true });
  const archive = gzipSync(Buffer.from(JSON.stringify(allFiles)), { level: 9 });
  const mcp = readFileSync(join(repoRoot, 'mcp/presets.json'));
  const bundleHash = sha256(archive);
  const mcpHash = sha256(mcp);
  // Versão = conteúdo: só muda (e só gera release) quando o pacote ou os MCPs mudam de fato.
  const version = sha256(`${bundleHash}:${mcpHash}`).slice(0, 12);
  const manifest = { schema: 1, version, bundle: { file: 'bundle.json.gz', sha256: bundleHash, bytes: archive.length }, mcp: { file: 'mcp.json', sha256: mcpHash }, sources: config.sources, skills: allSkills, unavailable: config.unavailable };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(output, 'bundle.json.gz'), archive);
  writeFileSync(join(output, 'mcp.json'), mcp);
  writeFileSync(join(output, 'manifest.json'), manifestBytes);
  if (process.env.CATALOG_SIGNING_KEY) {
    const signature = sign(null, manifestBytes, createPrivateKey(process.env.CATALOG_SIGNING_KEY));
    writeFileSync(join(output, 'manifest.sig'), signature.toString('base64'));
  }
  writeFileSync(sourcesFile, JSON.stringify(config, null, 2) + '\n');
  writeFileSync(join(output, 'report.txt'), report.join('\n') + (report.length ? '\n' : ''));
  console.log(`${allSkills.length} skills, versão ${version} (${archive.length} bytes).`);
  for (const line of report) console.log(`  ${line}`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
