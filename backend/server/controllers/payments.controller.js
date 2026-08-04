const { query } = require('../config/db');

// List recent transactions across all renters (Staff / Admin)
exports.listPayments = async (req, res) => {
  try {
    const { limit = 50, search } = req.query;
    let sql = `
      SELECT p.id, p.amount_paid, p.payment_type, p.balance_after, p.payment_date, p.payment_method, p.reference_number,
             u.id as renter_id, u.first_name, u.last_name, u.email,
             s.space_number,
             st.first_name as staff_first, st.last_name as staff_last
      FROM payments p
      JOIN users u ON p.renter_id = u.id
      JOIN billings b ON p.billing_id = b.id
      JOIN rentals r ON b.rental_id = r.id
      JOIN spaces s ON r.space_id = s.id
      LEFT JOIN users st ON p.received_by_staff_id = st.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR s.space_number LIKE ? OR p.reference_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    sql += ' ORDER BY p.payment_date DESC';

    const payments = await query(sql, params);
    return res.json(payments);
  } catch (error) {
    console.error('Error listing payments:', error);
    return res.status(500).json({ message: 'Error retrieving transaction history.' });
  }
};

// Get payments for a specific renter (Renter self-service)
exports.getRenterPayments = async (req, res) => {
  try {
    const renterId = req.params.renterId || req.user.id;
    const sql = `
      SELECT p.id, p.amount_paid, p.payment_type, p.balance_after, p.payment_date, p.payment_method, p.reference_number,
             b.billing_month, s.space_number
      FROM payments p
      JOIN billings b ON p.billing_id = b.id
      JOIN rentals r ON b.rental_id = r.id
      JOIN spaces s ON r.space_id = s.id
      WHERE p.renter_id = ?
      ORDER BY p.payment_date DESC
    `;
    const payments = await query(sql, [renterId]);
    return res.json(payments);
  } catch (error) {
    return res.status(500).json({ message: 'Error retrieving renter payments.' });
  }
};

// Record payment with FIFO logic across unpaid billings (Staff)
exports.processPayment = async (req, res) => {
  try {
    const { renter_id, amount_paid, payment_type = 'monthly', payment_method = 'Cash', reference_number } = req.body;
    const staffId = req.user.id;
    const amountToApply = parseFloat(amount_paid);

    if (!renter_id || !amountToApply || amountToApply <= 0) {
      return res.status(400).json({ message: 'Valid renter ID and positive payment amount are required.' });
    }

    // 1. Fetch all unpaid/overdue billings for this renter ordered oldest first (FIFO)
    const unpaidBillings = await query(`
      SELECT b.id, b.balance, b.amount_due, b.status
      FROM billings b
      WHERE b.renter_id = ? AND b.status IN ('unpaid', 'overdue')
      ORDER BY b.billing_month ASC, b.id ASC
    `, [renter_id]);

    if (!unpaidBillings || unpaidBillings.length === 0) {
      return res.status(400).json({ message: 'No outstanding unpaid balance found for this renter.' });
    }

    // Calculate total unpaid balance
    const totalUnpaidBalance = unpaidBillings.reduce((sum, bill) => sum + parseFloat(bill.balance), 0);

    if (amountToApply > totalUnpaidBalance) {
      return res.status(400).json({ 
        message: `Payment amount (₱${amountToApply.toFixed(2)}) exceeds total unpaid balance (₱${totalUnpaidBalance.toFixed(2)}).`
      });
    }

    let remainingPayment = amountToApply;
    const processedPayments = [];
    const generatedRef = reference_number || `OR-${Date.now().toString().slice(-6)}`;

    // 2. FIFO Application loop
    for (const bill of unpaidBillings) {
      if (remainingPayment <= 0) break;

      const currentBalance = parseFloat(bill.balance);
      const paymentForThisBill = Math.min(remainingPayment, currentBalance);
      const newBalance = currentBalance - paymentForThisBill;
      const newStatus = newBalance <= 0 ? 'paid' : 'unpaid';

      // Update billing record
      await query(`
        UPDATE billings SET balance = ?, status = ? WHERE id = ?
      `, [newBalance, newStatus, bill.id]);

      // Record payment entry
      const pRes = await query(`
        INSERT INTO payments (billing_id, renter_id, amount_paid, payment_type, balance_after, payment_date, payment_method, reference_number, received_by_staff_id)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
      `, [bill.id, renter_id, paymentForThisBill, payment_type, newBalance, payment_method, generatedRef, staffId]);

      processedPayments.push({
        billing_id: bill.id,
        applied: paymentForThisBill,
        balance_after: newBalance,
        status: newStatus
      });

      remainingPayment -= paymentForThisBill;
    }

    return res.status(201).json({
      message: 'Payment processed and recorded successfully.',
      reference_number: generatedRef,
      total_paid: amountToApply,
      remaining_unpaid_balance: totalUnpaidBalance - amountToApply,
      details: processedPayments
    });
  } catch (error) {
    console.error('Error processing payment:', error);
    return res.status(500).json({ message: 'Server error while processing payment transaction.' });
  }
};
