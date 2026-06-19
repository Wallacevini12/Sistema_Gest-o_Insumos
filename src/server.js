import express from 'express';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, initDb } from './db.js';
import {
  exigirAuth, senhaConfere, definirCookieSessao,
  limparCookieSessao, estaAutenticado
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const app = express();
app.use(express.json());

const TIPOS = ['Insertos', 'Brocas', 'Machos', 'Bedames', 'Fresas', 'Outros'];

// Páginas de gestão que exigem login. A retirada e a etiqueta ficam livres.
const PAGINAS_PROTEGIDAS = ['/', '/index.html', '/estoque.html', '/historico.html'];

// ---------- AUTENTICAÇÃO ----------

// Faz login validando a senha única; cria a sessão (cookie).
app.post('/api/login', (req, res) => {
  if (senhaConfere(req.body.senha)) {
    definirCookieSessao(res);
    return res.json({ ok: true });
  }
  res.status(401).json({ erro: 'Senha incorreta' });
});

app.post('/api/logout', (req, res) => {
  limparCookieSessao(res);
  res.json({ ok: true });
});

// Permite ao frontend saber se já está autenticado.
app.get('/api/sessao', (req, res) => {
  res.json({ autenticado: estaAutenticado(req) });
});

// ---------- PROTEÇÃO DAS PÁGINAS DE GESTÃO ----------
// Precisa vir ANTES do express.static, senão o arquivo é servido sem checar.
app.get(PAGINAS_PROTEGIDAS, (req, res, next) => {
  if (estaAutenticado(req)) return next();
  return res.redirect('/login.html');
});

// Arquivos estáticos livres: login.html, retirada.html, etiqueta.html, estilo.css.
// (As páginas de gestão já foram interceptadas acima.)
app.use(express.static(PUBLIC_DIR));

// ---------- API PÚBLICA (usada pela retirada via QR) ----------

// Busca um item específico (a tela de retirada usa isto ao escanear o QR)
app.get('/api/itens/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM itens WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Item não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Registra uma retirada e subtrai do estoque (transação) — livre para o operador
app.post('/api/retiradas', async (req, res) => {
  const { item_id, maquina, quantidade, operador } = req.body;
  if (!item_id || !maquina || !quantidade) {
    return res.status(400).json({ erro: 'item_id, maquina e quantidade são obrigatórios' });
  }
  const qtd = Number(quantidade);
  if (qtd <= 0) return res.status(400).json({ erro: 'quantidade deve ser positiva' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT quantidade FROM itens WHERE id = ? FOR UPDATE', [item_id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Item não encontrado' });
    }
    if (rows[0].quantidade < qtd) {
      await conn.rollback();
      return res.status(400).json({ erro: `Estoque insuficiente. Disponível: ${rows[0].quantidade}` });
    }
    await conn.query('UPDATE itens SET quantidade = quantidade - ? WHERE id = ?', [qtd, item_id]);
    await conn.query(
      'INSERT INTO retiradas (item_id, maquina, quantidade, operador) VALUES (?, ?, ?, ?)',
      [item_id, maquina, qtd, operador || null]
    );
    await conn.commit();
    res.status(201).json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ erro: e.message });
  } finally {
    conn.release();
  }
});

// QR code (PNG) — livre, é só a imagem que aponta para a retirada
app.get('/api/qrcode/:id', async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const url = `${base}/retirada.html?item=${req.params.id}`;
    const png = await QRCode.toBuffer(url, { width: 400, margin: 2 });
    res.type('png').send(png);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.get('/api/tipos', (req, res) => res.json(TIPOS));

// Healthcheck pro Railway — livre
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ---------- API PROTEGIDA (telas de gestão) ----------
// Tudo daqui pra baixo exige sessão válida.
app.use('/api', exigirAuth);

// Lista todos os itens com estoque atual
app.get('/api/itens', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM itens ORDER BY criado_em DESC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Cria um novo item (caixa). Retorna o id para gerar a etiqueta.
app.post('/api/itens', async (req, res) => {
  const { tipo, marca, descricao, quantidade } = req.body;
  if (!tipo || !marca || quantidade == null) {
    return res.status(400).json({ erro: 'tipo, marca e quantidade são obrigatórios' });
  }
  if (!TIPOS.includes(tipo)) {
    return res.status(400).json({ erro: 'tipo inválido' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO itens (tipo, marca, descricao, quantidade) VALUES (?, ?, ?, ?)',
      [tipo, marca, descricao || null, Number(quantidade)]
    );
    res.status(201).json({ id: result.insertId });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Histórico de retiradas com nome do item
app.get('/api/retiradas', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.*, i.tipo, i.marca
      FROM retiradas r
      JOIN itens i ON i.id = r.item_id
      ORDER BY r.retirado_em DESC
      LIMIT 500
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Repõe estoque de uma caixa (soma quantidade)
app.post('/api/itens/:id/repor', async (req, res) => {
  const quantidade = Number(req.body.quantidade);
  if (!quantidade || quantidade <= 0) {
    return res.status(400).json({ erro: 'quantidade deve ser positiva' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT quantidade FROM itens WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Item não encontrado' });
    }
    await conn.query('UPDATE itens SET quantidade = quantidade + ? WHERE id = ?', [quantidade, req.params.id]);
    await conn.commit();
    res.json({ ok: true, quantidade: rows[0].quantidade + quantidade });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ erro: e.message });
  } finally {
    conn.release();
  }
});

// Remove uma caixa (e seu histórico, via ON DELETE CASCADE)
app.delete('/api/itens/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM itens WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ erro: 'Item não encontrado' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`)))
  .catch((e) => {
    console.error('Falha ao inicializar:', e);
    process.exit(1);
  });
