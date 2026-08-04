const { query } = require('../config/db');

// List billings
exports.listBillings = async (req, res) => {
  try {
    const { search, status } = req.query;
    let sql = `
      SELECT b.id, b.billing_month, b.amount_due, b.downpayment, b.balance, b.due_date, b.status, b.created_at,
             u.id as renter_id, u.first_name, u.last_name, u.email, u.contact_number,
             s.space_number, s.location, s.monthly_rate,
             r.id as rental_id
      FROM billings b
      JOIN users u ON b.renter_id = u.id
      JOIN rentals r ON b.rental_id = r.id
      JOIN spaces s ON r.space_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND b.status = ?';
      params.push(status);
    }

    if (search) {
      sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR s.space_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    sql += ' ORDER BY b.id DESC';

    const billings = await query(sql, params);
    return res.json(billings);
  } catch (error) {
    console.error('Error listing billings:', error);
    return res.status(500).json({ message: 'Error retrieving billing records.' });
  }
};

// Billing Setup (Staff)
exports.setupBilling = async (req, res) => {
  try {
    const { rental_id, billing_month, downpayment = 0, due_date } = req.body;
    const staffId = req.user.id;

    if (!rental_id || !billing_month || !due_date) {
      return res.status(400).json({ message: 'Rental ID, billing start month, and due date are required.' });
    }

    // Get Rental and Space details
    const rentals = await query(`
      SELECT r.id, r.renter_id, s.monthly_rate, s.space_number
      FROM rentals r
      JOIN spaces s ON r.space_id = s.id
      WHERE r.id = ?
    `, [rental_id]);

    if (!rentals || rentals.length === 0) {
      return res.status(404).json({ message: 'Rental agreement not found.' });
    }

    const rental = rentals[0];
    const amountDue = parseFloat(rental.monthly_rate);
    const dp = parseFloat(downpayment) || 0;
    const balance = amountDue - dp;
    const initialStatus = balance <= 0 ? 'paid' : 'unpaid';

    // Insert Billing Record
    const result = await query(`
      INSERT INTO billings (renter_id, rental_id, billing_month, amount_due, downpayment, balance, due_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [rental.renter_id, rental.id, billing_month, amountDue, dp, balance, due_date, initialStatus]);

    const billingId = result.insertId || result.lastInsertRowid;

    // Update rental end_date
    await query('UPDATE rentals SET end_date = ? WHERE id = ?', [due_date, rental.id]);

    // If downpayment is provided, record an initial payment
    if (dp > 0) {
      const refNum = `DP-${Date.now().toString().slice(-6)}`;
      await query(`
        INSERT INTO payments (billing_id, renter_id, amount_paid, payment_type, balance_after, payment_date, payment_method, reference_number, received_by_staff_id)
        VALUES (?, ?, ?, 'down_payment', ?, CURRENT_TIMESTAMP, 'Cash', ?, ?)
      `, [billingId, rental.renter_id, dp, balance, refNum, staffId]);
    }

    return res.status(201).json({
      message: 'Billing setup completed successfully.',
      billing_id: billingId,
      net_balance: balance,
      monthly_installment: balance > 0 ? (balance / 12).toFixed(2) : 0
    });
  } catch (error) {
    console.error('Error during billing setup:', error);
    return res.status(500).json({ message: 'Server error during billing setup.' });
  }
};

// Update billing status (unpaid, paid, overdue, waived)
exports.updateBillingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await query('UPDATE billings SET status = ? WHERE id = ?', [status, id]);
    return res.json({ message: `Billing status updated to ${status}.` });
  } catch (error) {
    return res.status(500).json({ message: 'Error updating billing status.' });
  }
};

// Delete billing (Only unpaid billings can be deleted)
exports.deleteBilling = async (req, res) => {
  try {
    const { id } = req.params;

    const billings = await query('SELECT status FROM billings WHERE id = ?', [id]);
    if (!billings || billings.length === 0) {
      return res.status(404).json({ message: 'Billing record not found.' });
    }

    if (billings[0].status === 'paid') {
      return res.status(400).json({ message: 'Paid billing records cannot be deleted.' });
    }

    await query('DELETE FROM billings WHERE id = ?', [id]);
    return res.json({ message: 'Billing record deleted.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error deleting billing record.' });
  }
};
