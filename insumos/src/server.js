import express from 'express';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const TIPOS = ['Insertos', 'Brocas', 'Machos', 'Bedames', 'Fresas', 'Outros'];

// ---------- API ----------

// Lista todos os itens com estoque atual
app.get('/api/itens', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM itens ORDER BY criado_em DESC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Busca um item específico (usado pela tela de retirada via QR)
app.get('/api/itens/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM itens WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: 'Item não encontrado' });
    res.json(rows[0]);
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

// Registra uma retirada e subtrai do estoque (transação)
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

// Gera o QR code (PNG) que aponta para a tela de retirada do item
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

// Healthcheck pro Railway
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`)))
  .catch((e) => {
    console.error('Falha ao inicializar:', e);
    process.exit(1);
  });
