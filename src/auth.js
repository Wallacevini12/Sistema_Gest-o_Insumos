import crypto from 'crypto';

// Senha única compartilhada, vinda da variável de ambiente.
// Em produção (Railway), defina APP_SENHA nas Variables do serviço.
const SENHA = process.env.APP_SENHA || '';

// Segredo para assinar o cookie de sessão. Deriva da senha + um sal fixo.
// Se APP_SESSION_SECRET for definido, usa ele (recomendado em produção).
const SEGREDO = process.env.APP_SESSION_SECRET || ('sessao::' + SENHA);

const COOKIE = 'insumos_auth';
const DUR_MS = 1000 * 60 * 60 * 12; // sessão válida por 12h

if (!SENHA) {
  console.warn('[AVISO] APP_SENHA não definida — as telas de gestão ficarão inacessíveis até configurar a senha.');
}

// Gera um token assinado contendo o instante de expiração.
function gerarToken() {
  const exp = Date.now() + DUR_MS;
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(String(exp)).digest('hex');
  return `${exp}.${assinatura}`;
}

// Verifica se um token é válido e não expirou.
function tokenValido(token) {
  if (!token || !token.includes('.')) return false;
  const [exp, assinatura] = token.split('.');
  const esperada = crypto.createHmac('sha256', SEGREDO).update(String(exp)).digest('hex');
  // Comparação em tempo constante
  if (assinatura.length !== esperada.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada))) return false;
  return Date.now() < Number(exp);
}

// Lê o cookie de auth da requisição (parse simples, sem dependência).
function lerCookie(req) {
  const raw = req.headers.cookie || '';
  for (const parte of raw.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function estaAutenticado(req) {
  return tokenValido(lerCookie(req));
}

// Compara a senha enviada com a configurada, em tempo constante.
export function senhaConfere(enviada) {
  if (!SENHA || !enviada) return false;
  const a = Buffer.from(String(enviada));
  const b = Buffer.from(SENHA);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function definirCookieSessao(res) {
  const token = gerarToken();
  const seguro = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${DUR_MS / 1000}; SameSite=Lax${seguro ? '; Secure' : ''}`
  );
}

export function limparCookieSessao(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// Middleware que exige sessão válida; usado nas rotas de gestão.
export function exigirAuth(req, res, next) {
  if (estaAutenticado(req)) return next();
  // Para chamadas de API, responde 401; para páginas, redireciona ao login.
  // Quando montado com app.use('/api', ...), o prefixo cai em baseUrl/originalUrl.
  const url = req.originalUrl || req.path;
  if (url.startsWith('/api/')) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  return res.redirect('/login.html');
}
