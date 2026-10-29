const mysql = require('mysql2/promise');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

let dbDriver = null;
let sqliteDb = null;
let mysqlPool = null;

async function initDB() {
  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'duero_market_db';
  const port = process.env.DB_PORT || 3306;

  // Try MySQL connection first
  try {
    const tempConn = await mysql.createConnection({ host, user, password, port });
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await tempConn.end();

    mysqlPool = mysql.createPool({
      host,
      user,
      password,
      database,
      port,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Test query
    await mysqlPool.query('SELECT 1');
    dbDriver = 'mysql';
    console.log('Connected successfully to MySQL Database:', database);
  } catch (mysqlErr) {
    console.log('MySQL connection not available, initializing embedded SQLite fallback database.');
    const dbPath = path.join(__dirname, '../duero_market_db.sqlite');
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma('journal_mode = WAL');
    dbDriver = 'sqlite';
  }

  await createTables();
  await seedInitialData();
}

async function createTables() {
  if (dbDriver === 'mysql') {
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        role ENUM('admin','staff','renter') NOT NULL,
        first_name VARCHAR(50) NOT NULL,
        middle_name VARCHAR(50),
        last_name VARCHAR(50) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        password_plain VARCHAR(255),
        contact_number VARCHAR(20),
        address TEXT,
        gender VARCHAR(20),
        civil_status VARCHAR(20),
        valid_id LONGBLOB,
        profile_image VARCHAR(255),
        status ENUM('active','inactive') DEFAULT 'active',
        approval_status ENUM('pending','approved','rejected') DEFAULT 'approved',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS spaces (
        id INT AUTO_INCREMENT PRIMARY KEY,
        space_number VARCHAR(20) UNIQUE NOT NULL,
        location VARCHAR(100),
        size_sqm DECIMAL(10,2),
        monthly_rate DECIMAL(10,2) NOT NULL,
        image LONGBLOB,
        status ENUM('available','rented','maintenance') DEFAULT 'available',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS rentals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        renter_id INT NOT NULL,
        space_id INT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE,
        status ENUM('active','terminated','expired','pending') DEFAULT 'active',
        created_by_staff_id INT,
        valid_id_snapshot LONGBLOB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS billings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        renter_id INT NOT NULL,
        rental_id INT NOT NULL,
        billing_month DATE NOT NULL,
        amount_due DECIMAL(10,2) NOT NULL,
        downpayment DECIMAL(10,2) DEFAULT 0,
        balance DECIMAL(10,2) NOT NULL,
        due_date DATE NOT NULL,
        status ENUM('unpaid','paid','overdue','waived') DEFAULT 'unpaid',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        billing_id INT NOT NULL,
        renter_id INT NOT NULL,
        amount_paid DECIMAL(10,2) NOT NULL,
        payment_type VARCHAR(20) DEFAULT 'monthly',
        balance_after DECIMAL(10,2) DEFAULT 0,
        payment_date DATETIME NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'Cash',
        reference_number VARCHAR(100),
        received_by_staff_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } else {
    // SQLite Tables
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        first_name TEXT NOT NULL,
        middle_name TEXT,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        password_plain TEXT,
        contact_number TEXT,
        address TEXT,
        gender TEXT,
        civil_status TEXT,
        valid_id TEXT,
        profile_image TEXT,
        status TEXT DEFAULT 'active',
        approval_status TEXT DEFAULT 'approved',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS spaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_number TEXT UNIQUE NOT NULL,
        location TEXT,
        size_sqm REAL,
        monthly_rate REAL NOT NULL,
        image TEXT,
        status TEXT DEFAULT 'available',
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rentals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        renter_id INTEGER NOT NULL,
        space_id INTEGER NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE,
        status TEXT DEFAULT 'active',
        created_by_staff_id INTEGER,
        valid_id_snapshot TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS billings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        renter_id INTEGER NOT NULL,
        rental_id INTEGER NOT NULL,
        billing_month DATE NOT NULL,
        amount_due REAL NOT NULL,
        downpayment REAL DEFAULT 0,
        balance REAL NOT NULL,
        due_date DATE NOT NULL,
        status TEXT DEFAULT 'unpaid',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        billing_id INTEGER NOT NULL,
        renter_id INTEGER NOT NULL,
        amount_paid REAL NOT NULL,
        payment_type TEXT DEFAULT 'monthly',
        balance_after REAL DEFAULT 0,
        payment_date DATETIME NOT NULL,
        payment_method TEXT DEFAULT 'Cash',
        reference_number TEXT,
        received_by_staff_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
}

async function seedInitialData() {
  const users = await query('SELECT count(*) as cnt FROM users');
  const count = users[0].cnt || users[0]['count(*)'] || 0;
  
  if (count === 0) {
    console.log('Seeding initial default accounts and market spaces...');
    const hashedAdminPass = await bcrypt.hash('Admin1234', 10);
    const hashedStaffPass = await bcrypt.hash('Staff1234', 10);
    const hashedRenterPass = await bcrypt.hash('Juan1234', 10);

    // Default Admin
    await query(`
      INSERT INTO users (role, first_name, last_name, email, password, password_plain, status, approval_status, contact_number, address)
      VALUES ('admin', 'System', 'Admin', 'admin@duero.com', ?, 'Admin1234', 'active', 'approved', '09170000001', 'Municipal Hall, Duero, Bohol')
    `, [hashedAdminPass]);

    // Default Staff
    await query(`
      INSERT INTO users (role, first_name, last_name, email, password, password_plain, status, approval_status, contact_number, address)
      VALUES ('staff', 'Market', 'Staff', 'staff@duero.com', ?, 'Staff1234', 'active', 'approved', '09170000002', 'Public Market Office, Duero, Bohol')
    `, [hashedStaffPass]);

    // Default Renter (Juan Dela Cruz)
    const renterRes = await query(`
      INSERT INTO users (role, first_name, last_name, email, password, password_plain, status, approval_status, contact_number, address, gender, civil_status)
      VALUES ('renter', 'Juan', 'Dela Cruz', 'juandelacruz@duero.com', ?, 'Juan1234', 'active', 'approved', '09171234567', 'Poblacion, Duero, Bohol', 'Male', 'Married')
    `, [hashedRenterPass]);

    const renterId = renterRes.insertId || renterRes.lastInsertRowid || 3;

    // Seed Sample Market Spaces
    const defaultSpaces = [
      ['BLK-101', 'Section A - Wet Market Front', 25.00, 36000.00, 'rented', 'Prime wet market front corner stall suitable for fresh meats & seafood.'],
      ['BLK-102', 'Section A - Wet Market Inner', 20.00, 30000.00, 'available', 'Spacious stall with tiled flooring and drainage for market vendors.'],
      ['BLK-103', 'Section B - Dry Goods Entrance', 30.00, 48000.00, 'available', 'High foot traffic dry goods commercial unit near main gate.'],
      ['BLK-104', 'Section B - Dry Goods Inner', 22.50, 32000.00, 'available', 'Ideal for clothing, footwear, and general dry goods retail.'],
      ['BLK-105', 'Section C - Food Court Hall 1', 18.00, 40000.00, 'available', 'Food stall equiped with stainless exhaust hood setup.'],
      ['BLK-106', 'Section C - Food Court Hall 2', 18.00, 40000.00, 'available', 'Food stall location near customer seating section.'],
      ['BLK-107', 'Section D - Grocery & Grains', 35.00, 55000.00, 'available', 'Large commercial space for rice wholesaling and grocery store.'],
      ['BLK-108', 'Section E - Services & Repair', 15.00, 24000.00, 'maintenance', 'Service booth space undergoing electrical maintenance upgrades.']
    ];

    let space1Id = null;
    for (let i = 0; i < defaultSpaces.length; i++) {
      const s = defaultSpaces[i];
      const sRes = await query(`
        INSERT INTO spaces (space_number, location, size_sqm, monthly_rate, status, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [s[0], s[1], s[2], s[3], s[4], s[5]]);
      if (i === 0) space1Id = sRes.insertId || sRes.lastInsertRowid || 1;
    }

    // Seed Active Rental for Juan Dela Cruz on BLK-101
    const rentalRes = await query(`
      INSERT INTO rentals (renter_id, space_id, start_date, end_date, status, created_by_staff_id)
      VALUES (?, ?, '2026-01-01', '2026-12-31', 'active', 2)
    `, [renterId, space1Id]);
    const rentalId = rentalRes.insertId || rentalRes.lastInsertRowid || 1;

    // Seed Billing for BLK-101 (Rate: 36000, Downpayment: 6000, Balance: 30000)
    const billingRes = await query(`
      INSERT INTO billings (renter_id, rental_id, billing_month, amount_due, downpayment, balance, due_date, status)
      VALUES (?, ?, '2026-01-01', 36000.00, 6000.00, 27000.00, '2026-12-31', 'unpaid')
    `, [renterId, rentalId]);
    const billingId = billingRes.insertId || billingRes.lastInsertRowid || 1;

    // Seed Payments (Initial downpayment of 6000 + 1 monthly payment of 3000)
    await query(`
      INSERT INTO payments (billing_id, renter_id, amount_paid, payment_type, balance_after, payment_date, payment_method, reference_number, received_by_staff_id)
      VALUES (?, ?, 6000.00, 'down_payment', 30000.00, '2026-01-01 10:00:00', 'Cash', 'DP-2026-001', 2)
    `, [billingId, renterId]);

    await query(`
      INSERT INTO payments (billing_id, renter_id, amount_paid, payment_type, balance_after, payment_date, payment_method, reference_number, received_by_staff_id)
      VALUES (?, ?, 3000.00, 'monthly', 27000.00, '2026-02-01 09:30:00', 'Cash', 'OR-2026-012', 2)
    `, [billingId, renterId]);

    console.log('Seeding completed successfully!');
  }
}

// Universal Query Helper compatible with MySQL and SQLite
async function query(sql, params = []) {
  if (dbDriver === 'mysql') {
    const [rows] = await mysqlPool.execute(sql, params);
    return rows;
  } else {
    // Normalize MySQL syntax to SQLite syntax
    let sqliteSql = sql
      .replace(/ENGINE=InnoDB/gi, '')
      .replace(/DEFAULT CHARSET=utf8mb4/gi, '')
      .replace(/LONGBLOB/gi, 'TEXT')
      .replace(/TIMESTAMP DEFAULT CURRENT_TIMESTAMP/gi, 'DATETIME DEFAULT CURRENT_TIMESTAMP')
      .replace(/AUTO_INCREMENT/gi, 'AUTOINCREMENT');

    const trimmed = sqliteSql.trim().toUpperCase();
    if (trimmed.startsWith('SELECT')) {
      return sqliteDb.prepare(sqliteSql).all(params);
    } else {
      const info = sqliteDb.prepare(sqliteSql).run(params);
      return {
        insertId: Number(info.lastInsertRowid),
        lastInsertRowid: Number(info.lastInsertRowid),
        affectedRows: info.changes
      };
    }
  }
}

module.exports = {
  initDB,
  query,
  getDriver: () => dbDriver
};
