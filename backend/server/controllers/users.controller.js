const bcrypt = require('bcryptjs');
const { query } = require('../config/db');

// List users with optional role & search filtering
exports.listUsers = async (req, res) => {
  try {
    const { role, search } = req.query;
    let sql = 'SELECT id, role, first_name, middle_name, last_name, email, password_plain, contact_number, address, gender, civil_status, status, approval_status, created_at FROM users WHERE 1=1';
    const params = [];

    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }

    if (search) {
      sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    sql += ' ORDER BY id DESC';

    const users = await query(sql, params);
    return res.json(users);
  } catch (error) {
    return res.status(500).json({ message: 'Error retrieving users list.' });
  }
};

// List renters with assigned spaces
exports.listRenters = async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `
      SELECT u.id, u.first_name, u.middle_name, u.last_name, u.email, u.password_plain, u.contact_number, 
             u.address, u.status, u.approval_status, u.created_at,
             s.space_number, s.location, r.id as rental_id, r.status as rental_status
      FROM users u
      LEFT JOIN rentals r ON u.id = r.renter_id AND r.status = 'active'
      LEFT JOIN spaces s ON r.space_id = s.id
      WHERE u.role = 'renter'
    `;
    const params = [];

    if (search) {
      sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR s.space_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    sql += ' ORDER BY u.id DESC';

    const renters = await query(sql, params);
    return res.json(renters);
  } catch (error) {
    return res.status(500).json({ message: 'Error retrieving renters list.' });
  }
};

// Create user (Admin feature)
exports.createUser = async (req, res) => {
  try {
    const { role, first_name, middle_name, last_name, email, password, contact_number, address, gender, civil_status } = req.body;

    if (!role || !first_name || !last_name) {
      return res.status(400).json({ message: 'Role, first name, and last name are required.' });
    }

    // Auto generate email and password if omitted according to specification
    const autoEmail = email || `${first_name.toLowerCase().trim()}${last_name.toLowerCase().trim()}@duero.com`;
    const autoPassword = password || `${first_name.charAt(0).toUpperCase() + first_name.slice(1)}1234`;

    // Check duplicate email
    const existing = await query('SELECT id FROM users WHERE email = ?', [autoEmail]);
    if (existing && existing.length > 0) {
      return res.status(400).json({ message: `User with email ${autoEmail} already exists.` });
    }

    const hashedPassword = await bcrypt.hash(autoPassword, 10);

    const result = await query(`
      INSERT INTO users (role, first_name, middle_name, last_name, email, password, password_plain, contact_number, address, gender, civil_status, status, approval_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'approved')
    `, [role, first_name, middle_name || '', last_name, autoEmail, hashedPassword, autoPassword, contact_number || '', address || '', gender || '', civil_status || '']);

    return res.status(201).json({
      message: 'User account created successfully.',
      id: result.insertId || result.lastInsertRowid,
      email: autoEmail,
      password_plain: autoPassword
    });
  } catch (error) {
    console.error('Error creating user:', error);
    return res.status(500).json({ message: 'Server error creating user.' });
  }
};

// Update user details
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, middle_name, last_name, email, role, status, contact_number, address, password } = req.body;

    let sql = 'UPDATE users SET first_name=?, middle_name=?, last_name=?, email=?, role=?, status=?, contact_number=?, address=?';
    const params = [first_name, middle_name, last_name, email, role, status, contact_number, address];

    if (password && password.trim() !== '') {
      const hashed = await bcrypt.hash(password, 10);
      sql += ', password=?, password_plain=?';
      params.push(hashed, password);
    }

    sql += ' WHERE id=?';
    params.push(id);

    await query(sql, params);
    return res.json({ message: 'User updated successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error updating user.' });
  }
};

// Toggle active/inactive status
exports.toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await query('UPDATE users SET status = ? WHERE id = ?', [status, id]);
    return res.json({ message: `User status changed to ${status}.` });
  } catch (error) {
    return res.status(500).json({ message: 'Error updating user status.' });
  }
};

// Approve renter
exports.approveRenter = async (req, res) => {
  try {
    const { id } = req.params;

    // Activate user
    await query("UPDATE users SET status='active', approval_status='approved' WHERE id = ?", [id]);

    // Activate pending rental and update space to rented
    const pendingRentals = await query("SELECT id, space_id FROM rentals WHERE renter_id = ? AND status = 'pending'", [id]);
    for (const rental of pendingRentals) {
      await query("UPDATE rentals SET status='active' WHERE id = ?", [rental.id]);
      await query("UPDATE spaces SET status='rented' WHERE id = ?", [rental.space_id]);
    }

    return res.json({ message: 'Renter approved successfully. Rental activated.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error approving renter.' });
  }
};

// Reject renter
exports.rejectRenter = async (req, res) => {
  try {
    const { id } = req.params;

    await query("UPDATE users SET status='inactive', approval_status='rejected' WHERE id = ?", [id]);
    await query("UPDATE rentals SET status='terminated' WHERE renter_id = ? AND status = 'pending'", [id]);

    return res.json({ message: 'Renter registration rejected.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error rejecting renter.' });
  }
};

// Delete user
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM users WHERE id = ?', [id]);
    return res.json({ message: 'User account deleted.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error deleting user.' });
  }
};
