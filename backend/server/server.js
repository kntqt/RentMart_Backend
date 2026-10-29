const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { initDB } = require('./config/db');

const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const spacesRoutes = require('./routes/spaces.routes');
const rentalsRoutes = require('./routes/rentals.routes');
const billingsRoutes = require('./routes/billings.routes');
const paymentsRoutes = require('./routes/payments.routes');
const reportsRoutes = require('./routes/reports.routes');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allowed origins for Duero Market CSS System
const defaultOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'https://rentmart.bscs4b.com',
  'http://rentmart.bscs4b.com'
];

const envOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman, mobile)
      if (!origin) return callback(null, true);
      
      // Match exact allowed origin or subdomains/proxies (bscs4b.com, localhost, ngrok)
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.bscs4b.com') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.includes('ngrok')
      ) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// ─── Body Parsers ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Static Uploads ───────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/spaces', spacesRoutes);
app.use('/api/rentals', rentalsRoutes);
app.use('/api/billings', billingsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/dashboard', reportsRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    system: 'RentMart Commercial Spaces Services (CSS) API',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date(),
  });
});

// ─── Uploads directory guard ──────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ message: err.message || 'Internal Server Error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(` RentMart CSS Backend running on port ${PORT}`);
      console.log(` ENV: ${process.env.NODE_ENV || 'development'}`);
      console.log(` Hostinger domain: https://rentmart.bscs4b.com`);
      console.log(` Health check: http://localhost:${PORT}/api/health`);
      console.log(`=======================================================`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
