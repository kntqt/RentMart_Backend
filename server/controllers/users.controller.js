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

    // If created by admin, auto-approve; if created by staff, set to pending admin approval
    const isStaff = req.user && req.user.role === 'staff';
    const initialStatus = isStaff ? 'inactive' : 'active';
    const initialApproval = isStaff ? 'pending' : 'approved';

    const result = await query(`
      INSERT INTO users (role, first_name, middle_name, last_name, email, password, password_plain, contact_number, address, gender, civil_status, status, approval_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [role, first_name, middle_name || '', last_name, autoEmail, hashedPassword, autoPassword, contact_number || '', address || '', gender || '', civil_status || '', initialStatus, initialApproval]);

    return res.status(201).json({
      message: isStaff
        ? 'Renter account created! Account is pending approval by the market administrator.'
        : 'User account created successfully.',
      id: result.insertId || result.lastInsertRowid,
      email: autoEmail,
      password_plain: autoPassword,
      approval_status: initialApproval
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

// Approve renter (with account credential creation)
exports.approveRenter = async (req, res) => {
  try {
    const { id } = req.params;
    let { email, password } = req.body;

    const targetUsers = await query('SELECT id, first_name, last_name, email, contact_number FROM users WHERE id = ?', [id]);
    if (!targetUsers || targetUsers.length === 0) {
      return res.status(404).json({ message: 'Renter account not found.' });
    }
    const targetUser = targetUsers[0];

    // Auto-generate email if omitted
    if (!email || !email.trim()) {
      const cleanFirst = (targetUser.first_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanLast = (targetUser.last_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      email = targetUser.email || `${cleanFirst}${cleanLast}@gmail.com`;
    }

    // Auto-generate password if omitted (e.g. Juan1234 or First+Last4Digits)
    if (!password || password.trim().length < 6) {
      const cleanFirst = targetUser.first_name ? targetUser.first_name.charAt(0).toUpperCase() + targetUser.first_name.slice(1).toLowerCase() : 'Renter';
      const suffix = targetUser.contact_number && targetUser.contact_number.length >= 4 ? targetUser.contact_number.slice(-4) : '1234';
      password = `${cleanFirst}${suffix}`;
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if this email is already used by another user
    const existing = await query('SELECT id FROM users WHERE email = ? AND id != ?', [cleanEmail, id]);
    if (existing && existing.length > 0) {
      return res.status(400).json({ message: `The email ${cleanEmail} is already in use by another account.` });
    }

    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    // Activate user and set email + password
    await query("UPDATE users SET status='active', approval_status='approved', email=?, password=?, password_plain=? WHERE id = ?", [cleanEmail, hashedPassword, password.trim(), id]);

    // Activate pending rental and update space to rented
    const pendingRentals = await query("SELECT id, space_id FROM rentals WHERE renter_id = ? AND status = 'pending'", [id]);
    for (const rental of pendingRentals) {
      await query("UPDATE rentals SET status='active' WHERE id = ?", [rental.id]);
      await query("UPDATE spaces SET status='rented' WHERE id = ?", [rental.space_id]);
    }

    // Fetch the approved user info to return
    const users = await query('SELECT id, first_name, last_name, email FROM users WHERE id = ?', [id]);
    const user = users[0];

    return res.json({
      message: 'Renter approved and account created successfully.',
      user: {
        id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        password_plain: password.trim()
      }
    });
  } catch (error) {
    console.error('Error approving renter:', error);
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
