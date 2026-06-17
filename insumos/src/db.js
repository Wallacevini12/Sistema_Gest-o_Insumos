import mysql from 'mysql2/promise';

// O Railway injeta MYSQL_URL automaticamente quando você adiciona o plugin MySQL.
// Localmente, defina MYSQL_URL no .env ou use as variáveis individuais.
const connectionConfig = process.env.MYSQL_URL
  ? process.env.MYSQL_URL
  : {
      host: process.env.MYSQLHOST || 'localhost',
      port: process.env.MYSQLPORT || 3306,
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || '',
      database: process.env.MYSQLDATABASE || 'insumos',
    };

export const pool = mysql.createPool(
  typeof connectionConfig === 'string'
    ? connectionConfig
    : { ...connectionConfig, waitForConnections: true, connectionLimit: 10 }
);

export async function initDb() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS itens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tipo VARCHAR(50) NOT NULL,
        marca VARCHAR(120) NOT NULL,
        descricao VARCHAR(255) DEFAULT NULL,
        quantidade INT NOT NULL DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS retiradas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_id INT NOT NULL,
        maquina VARCHAR(120) NOT NULL,
        quantidade INT NOT NULL,
        operador VARCHAR(120) DEFAULT NULL,
        retirado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_id) REFERENCES itens(id) ON DELETE CASCADE
      )
    `);
    console.log('Banco inicializado.');
  } finally {
    conn.release();
  }
}
