# Gestão de insumos

Sistema de controle de insertos, brocas, machos, bedames etc. com etiquetas QR code.
Backend Node.js + Express, banco MySQL.

## Telas

- **Cadastrar caixa** (`/`) — cria uma caixa nova e gera a etiqueta QR para imprimir.
- **Estoque** (`/estoque.html`) — lista as caixas e permite reimprimir etiquetas.
- **Retirada** (`/retirada.html?item=ID`) — abre quando o operador escaneia o QR. Já vem com os dados da caixa; o operador só informa máquina e quantidade.
- **Histórico** (`/historico.html`) — todas as retiradas registradas.

Cada QR code aponta para `https://SEU-APP.up.railway.app/retirada.html?item=ID`.
A câmera nativa do celular abre o link direto.

## Deploy no Railway

1. Suba este projeto para um repositório no GitHub.
2. No Railway: **New Project → Deploy from GitHub repo** e selecione o repositório.
3. Adicione o banco: **New → Database → Add MySQL**. O Railway cria as variáveis
   `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE` e `MYSQL_URL`
   automaticamente e as injeta no serviço da aplicação.
4. Garanta que o serviço da app referencie essas variáveis. Se elas estiverem no
   plugin MySQL mas não na app, adicione em **Variables → Reference** apontando para o MySQL.
5. O Railway roda `npm start` por padrão (definido no `package.json`). As tabelas
   são criadas sozinhas na primeira inicialização.
6. Em **Settings → Networking**, gere o domínio público. Pronto.

## Rodando localmente

```bash
npm install
cp .env.example .env   # ajuste MYSQL_URL para o seu MySQL local
npm start
```

Acesse http://localhost:3000

## Estrutura

```
src/server.js   API + rotas + geração de QR
src/db.js       conexão e schema (tabelas itens e retiradas)
public/         as 4 telas em HTML/CSS/JS puro
```

## Notas

- A retirada usa transação com `SELECT ... FOR UPDATE`, então duas pessoas
  escaneando a mesma caixa ao mesmo tempo não furam o estoque.
- Tipos disponíveis estão em `TIPOS` no `server.js`. Para adicionar (ex.: "Alargadores"),
  edite essa lista.
- Estoque ≤ 5 unidades aparece em vermelho.

## Acesso restrito (senha)

As telas de gestão (cadastrar caixa, estoque, histórico) exigem login com uma
senha única compartilhada. A tela de retirada acessada via QR code continua
livre — o operador escaneia e dá baixa sem senha.

Defina a senha na variável de ambiente `APP_SENHA`:

- **No Railway:** serviço da app → aba **Variables** → New Variable →
  `APP_SENHA` = sua senha.
- **Local:** no `.env`, `APP_SENHA=...`

Para trocar a senha depois, basta alterar `APP_SENHA` e redeployar. As sessões
abertas continuam válidas por até 12h; para invalidar todas imediatamente,
defina também `APP_SESSION_SECRET` com qualquer texto novo.

Sair: há um link "Sair" na navegação das telas de gestão.
