const { query } = require('../config/db');

// List active/all rentals
exports.listRentals = async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT r.id, r.start_date, r.end_date, r.status, r.created_at,
             u.id as renter_id, u.first_name, u.last_name, u.email, u.contact_number,
             s.id as space_id, s.space_number, s.location, s.monthly_rate
      FROM rentals r
      JOIN users u ON r.renter_id = u.id
      JOIN spaces s ON r.space_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND r.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY r.id DESC';

    const rentals = await query(sql, params);
    return res.json(rentals);
  } catch (error) {
    return res.status(500).json({ message: 'Error retrieving rentals.' });
  }
};

// List pending rentals for Admin approval
exports.listPendingRentals = async (req, res) => {
  try {
    const sql = `
      SELECT r.id as rental_id, r.start_date, r.end_date, r.created_at,
             u.id as renter_id, u.first_name, u.last_name, u.email, u.contact_number,
             s.id as space_id, s.space_number, s.location, s.monthly_rate
      FROM rentals r
      JOIN users u ON r.renter_id = u.id
      JOIN spaces s ON r.space_id = s.id
      WHERE r.status = 'pending'
      ORDER BY r.id DESC
    `;
    const pending = await query(sql);
    return res.json(pending);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching pending rentals.' });
  }
};

// AJAX Lookup renter by email (for Staff when assigning spaces)
exports.lookupRenterByEmail = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ message: 'Email param is required.' });
    }

    const users = await query(`
      SELECT id, first_name, middle_name, last_name, email, contact_number, address, gender, civil_status, status, approval_status
      FROM users WHERE email = ? AND role = 'renter'
    `, [email.trim().toLowerCase()]);

    if (!users || users.length === 0) {
      return res.status(404).json({ message: 'No registered renter found with this email.' });
    }

    const renter = users[0];

    // Check unpaid billing count
    const billings = await query(`
      SELECT COUNT(*) as unpaid_count FROM billings WHERE renter_id = ? AND status = 'unpaid'
    `, [renter.id]);

    renter.unpaid_bill_count = billings[0].unpaid_count || billings[0]['COUNT(*)'] || 0;

    return res.json(renter);
  } catch (error) {
    return res.status(500).json({ message: 'Error executing renter lookup.' });
  }
};

// Create / Assign Rental (Staff)
exports.createRental = async (req, res) => {
  try {
    const { space_id, renter_email, start_date, end_date } = req.body;
    const staffId = req.user.id;

    if (!space_id || !renter_email || !start_date) {
      return res.status(400).json({ message: 'Space ID, renter email, and start date are required.' });
    }

    // Verify Space availability
    const spaces = await query('SELECT * FROM spaces WHERE id = ?', [space_id]);
    if (!spaces || spaces.length === 0) {
      return res.status(404).json({ message: 'Target space not found.' });
    }

    const space = spaces[0];
    if (space.status !== 'available') {
      return res.status(400).json({ message: `Space ${space.space_number} is currently ${space.status} and cannot be rented.` });
    }

    // Find user by email
    const users = await query('SELECT * FROM users WHERE email = ? AND role = "renter"', [renter_email.trim().toLowerCase()]);
    if (!users || users.length === 0) {
      return res.status(404).json({ message: 'Renter user account not found for this email.' });
    }

    const renter = users[0];

    // Calculate default end_date to 1 year if not provided
    const calculatedEndDate = end_date || new Date(new Date(start_date).setFullYear(new Date(start_date).getFullYear() + 1)).toISOString().split('T')[0];

    // Create rental record with status='pending'
    const result = await query(`
      INSERT INTO rentals (renter_id, space_id, start_date, end_date, status, created_by_staff_id)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `, [renter.id, space_id, start_date, calculatedEndDate, staffId]);

    // Set renter approval_status to pending
    await query("UPDATE users SET approval_status='pending' WHERE id=?", [renter.id]);

    return res.status(201).json({
      message: 'Rental assignment created successfully. Awaiting Admin approval.',
      rental_id: result.insertId || result.lastInsertRowid
    });
  } catch (error) {
    console.error('Error creating rental assignment:', error);
    return res.status(500).json({ message: 'Server error creating rental assignment.' });
  }
};

// Approve Pending Rental (Admin)
exports.approveRental = async (req, res) => {
  try {
    const { id } = req.params;

    const rentals = await query('SELECT * FROM rentals WHERE id = ?', [id]);
    if (!rentals || rentals.length === 0) {
      return res.status(404).json({ message: 'Rental request not found.' });
    }

    const rental = rentals[0];

    // Transaction logic: Activate rental, mark space rented, activate renter
    await query("UPDATE rentals SET status='active' WHERE id = ?", [id]);
    await query("UPDATE spaces SET status='rented' WHERE id = ?", [rental.space_id]);
    await query("UPDATE users SET status='active', approval_status='approved' WHERE id = ?", [rental.renter_id]);

    return res.json({ message: 'Rental request approved successfully. Space marked as rented.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error approving rental request.' });
  }
};

// Reject Pending Rental (Admin)
exports.rejectRental = async (req, res) => {
  try {
    const { id } = req.params;

    const rentals = await query('SELECT * FROM rentals WHERE id = ?', [id]);
    if (!rentals || rentals.length === 0) {
      return res.status(404).json({ message: 'Rental request not found.' });
    }

    const rental = rentals[0];

    await query("UPDATE rentals SET status='terminated' WHERE id = ?", [id]);
    await query("UPDATE users SET status='inactive', approval_status='rejected' WHERE id = ?", [rental.renter_id]);

    return res.json({ message: 'Rental request rejected.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error rejecting rental request.' });
  }
};
