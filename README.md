# Catálogo do Cockpit

Skills e MCPs que o Cockpit usa, mantidos em dia automaticamente.

Todo dia (e a cada mudança neste repositório) uma rotina do GitHub Actions:

1. move cada fonte de `sources.json` para o **último commit** dela (se a fonte falhar, fica no commit anterior);
2. reconstrói o pacote de skills (`bundle.json.gz`) e a lista de MCPs (`mcp.json`);
3. assina o manifesto (ed25519) e confere tudo (`scripts/verify.mjs`);
4. publica uma release `catalog-<versão>` se algo mudou. A release traz como changelog quais fontes subiram.

O Cockpit lê a release mais recente, confere a assinatura com `public-key.pem` e os hashes do manifesto, e só então atualiza.

## Como adicionar algo ao catálogo

- **Skills de um repositório:** acrescente uma fonte em `sources.json` (`repo`, `sha`, `paths`, `categories`). A rotina cuida do resto.
- **MCP de serviço online:** acrescente em `mcp/presets.json`. Só são aceitos MCPs por URL; conectores que rodam comandos no computador do usuário ficam no código do Cockpit, nunca vêm daqui.

## Regras de segurança

- O manifesto é assinado; o Cockpit rejeita o que não bate com a chave pública daqui.
- Arquivos de mídia grandes (imagens/áudio de demonstração) não entram no pacote.
- Skill editada pelo usuário nunca é sobrescrita pelo Cockpit.

## Comandos

```
node scripts/build.mjs --latest   # reconstrói no último commit de cada fonte
node scripts/verify.mjs dist      # confere assinatura, hashes e skills
```
