const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

// Login endpoint
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password.' });
    }

    const users = await query('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (!users || users.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials or account does not exist.' });
    }

    const user = users[0];

    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Your account is inactive. Please contact the market administrator.' });
    }

    if (user.approval_status === 'pending') {
      return res.status(403).json({ message: 'Your registration is pending approval by the market administrator.' });
    }

    if (user.approval_status === 'rejected') {
      return res.status(403).json({ message: 'Your account registration was rejected.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials or incorrect password.' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        email: user.email,
        name: `${user.first_name} ${user.last_name}`
      },
      process.env.JWT_SECRET || 'duero_market_super_secret_jwt_key_2026',
      { expiresIn: '24h' }
    );

    const { password: p, password_plain: pp, ...userData } = user;

    return res.json({
      message: 'Login successful',
      token,
      user: userData
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error during login processing.' });
  }
};

// Get current user profile
exports.getMe = async (req, res) => {
  try {
    const users = await query('SELECT id, role, first_name, middle_name, last_name, email, contact_number, address, gender, civil_status, status, approval_status, profile_image, created_at FROM users WHERE id = ?', [req.user.id]);
    if (!users || users.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    return res.json(users[0]);
  } catch (error) {
    return res.status(500).json({ message: 'Server error retrieving profile.' });
  }
};

// Update profile details
exports.updateProfile = async (req, res) => {
  try {
    const { first_name, middle_name, last_name, contact_number, address, gender, civil_status } = req.body;
    await query(
      `UPDATE users SET first_name = ?, middle_name = ?, last_name = ?, contact_number = ?, address = ?, gender = ?, civil_status = ? WHERE id = ?`,
      [first_name, middle_name, last_name, contact_number, address, gender, civil_status, req.user.id]
    );

    return res.json({ message: 'Profile updated successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Server error updating profile.' });
  }
};

// Change Password
exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ message: 'Both current and new password are required.' });
    }

    const users = await query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const user = users[0];

    const match = await bcrypt.compare(current_password, user.password);
    if (!match) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    const hashedNew = await bcrypt.hash(new_password, 10);
    await query('UPDATE users SET password = ?, password_plain = ? WHERE id = ?', [hashedNew, new_password, req.user.id]);

    return res.json({ message: 'Password changed successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Server error changing password.' });
  }
};
