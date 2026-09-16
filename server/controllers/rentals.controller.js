const { query, getDriver, getConnection } = require('../config/db');

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

// Create / Assign Rental (Staff/Admin)
// Uses MySQL transaction with row-level locking to prevent double-rental
exports.createRental = async (req, res) => {
  const conn = await getConnection();

  try {
    const { space_id, renter_email, start_date, end_date } = req.body;
    const staffId = req.user.id;

    if (!space_id || !renter_email || !start_date) {
      return res.status(400).json({ message: 'Space ID, renter email, and start date are required.' });
    }

    // Validate start_date is not in the past
    const startDateObj = new Date(start_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (startDateObj < today) {
      return res.status(400).json({ message: 'Start date cannot be in the past.' });
    }

    // Find user by email first (outside transaction)
    const users = await query('SELECT * FROM users WHERE email = ? AND role = "renter"', [renter_email.trim().toLowerCase()]);
    if (!users || users.length === 0) {
      return res.status(404).json({ message: 'Renter user account not found for this email.' });
    }
    const renter = users[0];

    // Calculate default end_date to 1 year if not provided
    const calculatedEndDate = end_date || new Date(new Date(start_date).setFullYear(new Date(start_date).getFullYear() + 1)).toISOString().split('T')[0];

    // === MySQL Transaction with Row Locking ===
    if (conn) {
      await conn.beginTransaction();

      try {
        // Lock the space row to prevent concurrent modifications
        const [spaces] = await conn.execute('SELECT * FROM spaces WHERE id = ? FOR UPDATE', [space_id]);
        if (!spaces || spaces.length === 0) {
          await conn.rollback();
          conn.release();
          return res.status(404).json({ message: 'Target space not found.' });
        }

        const space = spaces[0];
        if (space.status !== 'available') {
          await conn.rollback();
          conn.release();
          return res.status(409).json({ message: `Space ${space.space_number} is currently ${space.status} and cannot be rented.` });
        }

        // Create rental record with status='pending'
        const [result] = await conn.execute(`
          INSERT INTO rentals (renter_id, space_id, start_date, end_date, status, created_by_staff_id)
          VALUES (?, ?, ?, ?, 'pending', ?)
        `, [renter.id, space_id, start_date, calculatedEndDate, staffId]);

        // Mark space as reserved immediately to prevent double-rental
        await conn.execute("UPDATE spaces SET status='reserved' WHERE id = ?", [space_id]);

        // Set renter approval_status to pending
        await conn.execute("UPDATE users SET approval_status='pending' WHERE id=?", [renter.id]);

        await conn.commit();
        conn.release();

        return res.status(201).json({
          message: 'Rental assignment created successfully. Space is now reserved. Awaiting Staff approval.',
          rental_id: result.insertId
        });
      } catch (txErr) {
        await conn.rollback();
        conn.release();
        throw txErr;
      }
    } else {
      // SQLite fallback — no row-level locking, but still atomic
      const spaces = await query('SELECT * FROM spaces WHERE id = ?', [space_id]);
      if (!spaces || spaces.length === 0) {
        return res.status(404).json({ message: 'Target space not found.' });
      }

      const space = spaces[0];
      if (space.status !== 'available') {
        return res.status(409).json({ message: `Space ${space.space_number} is currently ${space.status} and cannot be rented.` });
      }

      const result = await query(`
        INSERT INTO rentals (renter_id, space_id, start_date, end_date, status, created_by_staff_id)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `, [renter.id, space_id, start_date, calculatedEndDate, staffId]);

      await query("UPDATE spaces SET status='reserved' WHERE id=?", [space_id]);
      await query("UPDATE users SET approval_status='pending' WHERE id=?", [renter.id]);

      return res.status(201).json({
        message: 'Rental assignment created successfully. Space is now reserved. Awaiting Staff approval.',
        rental_id: result.insertId || result.lastInsertRowid
      });
    }
  } catch (error) {
    console.error('Error creating rental assignment:', error);
    if (conn) {
      try { conn.release(); } catch (e) { /* ignore */ }
    }
    return res.status(500).json({ message: 'Server error creating rental assignment.' });
  }
};

// Renter Self-Service Rental Request
// Uses MySQL transaction with row-level locking to prevent double-rental
exports.renterRequestRental = async (req, res) => {
  const conn = await getConnection();

  try {
    const { space_id, start_date, end_date } = req.body;
    const renterId = req.user.id;

    if (!space_id || !start_date) {
      return res.status(400).json({ message: 'Space ID and start date are required.' });
    }

    // Validate start_date is not in the past
    const startDateObj = new Date(start_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (startDateObj < today) {
      return res.status(400).json({ message: 'Start date cannot be in the past.' });
    }

    // Verify the renter exists and is active
    const renterRows = await query('SELECT * FROM users WHERE id = ? AND role = "renter"', [renterId]);
    if (!renterRows || renterRows.length === 0) {
      return res.status(403).json({ message: 'Only registered renters can request a rental.' });
    }

    const renter = renterRows[0];
    if (renter.status !== 'active') {
      return res.status(403).json({ message: 'Your account is not active. Please contact the market administrator.' });
    }

    // Check if renter already has a pending rental request
    const existingPending = await query(
      "SELECT id FROM rentals WHERE renter_id = ? AND status = 'pending'",
      [renterId]
    );
    if (existingPending && existingPending.length > 0) {
      return res.status(400).json({ message: 'You already have a pending rental request. Please wait for staff approval before submitting another.' });
    }

    // Calculate default end_date to 1 year if not provided
    const calculatedEndDate = end_date || new Date(new Date(start_date).setFullYear(new Date(start_date).getFullYear() + 1)).toISOString().split('T')[0];

    // Validate end_date is after start_date
    if (calculatedEndDate && new Date(calculatedEndDate) <= new Date(start_date)) {
      return res.status(400).json({ message: 'End date must be after start date.' });
    }

    // === MySQL Transaction with Row Locking ===
    if (conn) {
      await conn.beginTransaction();

      try {
        // Lock the space row to prevent concurrent modifications
        const [spaces] = await conn.execute('SELECT * FROM spaces WHERE id = ? FOR UPDATE', [space_id]);
        if (!spaces || spaces.length === 0) {
          await conn.rollback();
          conn.release();
          return res.status(404).json({ message: 'Market space not found.' });
        }

        const space = spaces[0];
        if (space.status !== 'available') {
          await conn.rollback();
          conn.release();
          return res.status(409).json({
            message: `Market Space ${space.space_number} is no longer available. Current status: ${space.status}.`
          });
        }

        // Create rental record with status='pending'
        const [result] = await conn.execute(`
          INSERT INTO rentals (renter_id, space_id, start_date, end_date, status)
          VALUES (?, ?, ?, ?, 'pending')
        `, [renterId, space_id, start_date, calculatedEndDate]);

        // Mark space as reserved immediately
        await conn.execute("UPDATE spaces SET status='reserved' WHERE id = ?", [space_id]);

        await conn.commit();
        conn.release();

        return res.status(201).json({
          message: 'Rental request submitted successfully! The space is now reserved for you pending staff approval.',
          rental_id: result.insertId,
          space_number: space.space_number
        });
      } catch (txErr) {
        await conn.rollback();
        conn.release();
        throw txErr;
      }
    } else {
      // SQLite fallback
      const spaces = await query('SELECT * FROM spaces WHERE id = ?', [space_id]);
      if (!spaces || spaces.length === 0) {
        return res.status(404).json({ message: 'Market space not found.' });
      }

      const space = spaces[0];
      if (space.status !== 'available') {
        return res.status(409).json({
          message: `Market Space ${space.space_number} is no longer available. Current status: ${space.status}.`
        });
      }

      const result = await query(`
        INSERT INTO rentals (renter_id, space_id, start_date, end_date, status)
        VALUES (?, ?, ?, ?, 'pending')
      `, [renterId, space_id, start_date, calculatedEndDate]);

      await query("UPDATE spaces SET status='reserved' WHERE id=?", [space_id]);

      return res.status(201).json({
        message: 'Rental request submitted successfully! The space is now reserved for you pending staff approval.',
        rental_id: result.insertId || result.lastInsertRowid,
        space_number: space.space_number
      });
    }
  } catch (error) {
    console.error('Error processing renter rental request:', error);
    if (conn) {
      try { conn.release(); } catch (e) { /* ignore */ }
    }
    return res.status(500).json({ message: 'Server error processing your rental request.' });
  }
};

// Get current renter's own rentals
exports.getMyRentals = async (req, res) => {
  try {
    const renterId = req.user.id;

    const rentals = await query(`
      SELECT r.id, r.start_date, r.end_date, r.status, r.created_at,
             s.id as space_id, s.space_number, s.location, s.size_sqm, s.monthly_rate, s.status as space_status
      FROM rentals r
      JOIN spaces s ON r.space_id = s.id
      WHERE r.renter_id = ?
      ORDER BY r.id DESC
    `, [renterId]);

    return res.json(rentals);
  } catch (error) {
    return res.status(500).json({ message: 'Error retrieving your rentals.' });
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
    if (rental.status !== 'pending') {
      return res.status(400).json({ message: `Cannot approve a rental with status '${rental.status}'. Only pending rentals can be approved.` });
    }

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
    if (rental.status !== 'pending') {
      return res.status(400).json({ message: `Cannot reject a rental with status '${rental.status}'. Only pending rentals can be rejected.` });
    }

    await query("UPDATE rentals SET status='terminated' WHERE id = ?", [id]);
    // Reset space back to available (was 'reserved' during pending)
    await query("UPDATE spaces SET status='available' WHERE id = ?", [rental.space_id]);
    await query("UPDATE users SET status='inactive', approval_status='rejected' WHERE id = ?", [rental.renter_id]);

    return res.json({ message: 'Rental request rejected. Space is now available again.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error rejecting rental request.' });
  }
};

// Cancel Rental (Admin) — for active or pending rentals
exports.cancelRental = async (req, res) => {
  try {
    const { id } = req.params;

    const rentals = await query('SELECT * FROM rentals WHERE id = ?', [id]);
    if (!rentals || rentals.length === 0) {
      return res.status(404).json({ message: 'Rental not found.' });
    }

    const rental = rentals[0];
    if (!['active', 'pending'].includes(rental.status)) {
      return res.status(400).json({ message: `Cannot cancel a rental with status '${rental.status}'. Only active or pending rentals can be cancelled.` });
    }

    // Cancel the rental and free up the space
    await query("UPDATE rentals SET status='cancelled' WHERE id = ?", [id]);
    await query("UPDATE spaces SET status='available' WHERE id = ?", [rental.space_id]);

    return res.json({ message: 'Rental cancelled successfully. Space is now available for new tenants.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error cancelling rental.' });
  }
};

// Complete Rental (Admin) — when lease term ends
exports.completeRental = async (req, res) => {
  try {
    const { id } = req.params;

    const rentals = await query('SELECT * FROM rentals WHERE id = ?', [id]);
    if (!rentals || rentals.length === 0) {
      return res.status(404).json({ message: 'Rental not found.' });
    }

    const rental = rentals[0];
    if (rental.status !== 'active') {
      return res.status(400).json({ message: `Cannot complete a rental with status '${rental.status}'. Only active rentals can be completed.` });
    }

    // Complete the rental and free up the space
    await query("UPDATE rentals SET status='completed' WHERE id = ?", [id]);
    await query("UPDATE spaces SET status='available' WHERE id = ?", [rental.space_id]);

    return res.json({ message: 'Rental completed successfully. Space is now available for new tenants.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error completing rental.' });
  }
};
