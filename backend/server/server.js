const express = require('express');
const cors = require('cors');
const path = require('path');
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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/spaces', spacesRoutes);
app.use('/api/rentals', rentalsRoutes);
app.use('/api/billings', billingsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/dashboard', reportsRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', system: 'RentMart Commercial Spaces Services (CSS) API', timestamp: new Date() });
});

// Create uploads directory if not exists
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize Database and start server
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(` RentMart CSS Backend API Server running on port ${PORT}`);
      console.log(` Health check available at http://localhost:${PORT}/api/health`);
      console.log(`=======================================================`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
  });
