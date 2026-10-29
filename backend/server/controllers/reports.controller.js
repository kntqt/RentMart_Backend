const { query } = require('../config/db');

// Admin Dashboard KPI & Revenue Chart
exports.getAdminDashboard = async (req, res) => {
  try {
    // Total Collections
    const collRes = await query('SELECT SUM(amount_paid) as total FROM payments');
    const totalCollections = collRes[0].total || 0;

    // Registered Users count (staff & renter)
    const userRes = await query("SELECT COUNT(*) as total FROM users WHERE role IN ('staff', 'renter')");
    const registeredUsers = userRes[0].total || 0;

    // Occupancy Rate
    const spaceRes = await query('SELECT status, COUNT(*) as cnt FROM spaces GROUP BY status');
    let totalSpaces = 0;
    let rentedSpaces = 0;
    spaceRes.forEach(r => {
      totalSpaces += r.cnt;
      if (r.status === 'rented') rentedSpaces = r.cnt;
    });
    const occupancyRate = totalSpaces > 0 ? ((rentedSpaces / totalSpaces) * 100).toFixed(1) : 0;

    // Pending Approvals
    const pendingRes = await query("SELECT COUNT(*) as total FROM users WHERE approval_status = 'pending'");
    const pendingApprovals = pendingRes[0].total || 0;

    // Recent 5 activities
    const recentActivities = await query(`
      SELECT p.amount_paid, p.payment_date, u.first_name, u.last_name, s.space_number
      FROM payments p
      JOIN users u ON p.renter_id = u.id
      JOIN billings b ON p.billing_id = b.id
      JOIN rentals r ON b.rental_id = r.id
      JOIN spaces s ON r.space_id = s.id
      ORDER BY p.payment_date DESC LIMIT 5
    `);

    // Monthly revenue chart data (Last 6 months)
    const revenueChart = [
      { month: 'Jan', revenue: 9000 },
      { month: 'Feb', revenue: 12000 },
      { month: 'Mar', revenue: 15000 },
      { month: 'Apr', revenue: 18000 },
      { month: 'May', revenue: 21000 },
      { month: 'Jun', revenue: 24000 }
    ];

    return res.json({
      kpis: {
        totalCollections,
        registeredUsers,
        occupancyRate: `${occupancyRate}%`,
        pendingApprovals
      },
      recentActivities,
      revenueChart
    });
  } catch (error) {
    console.error('Error fetching admin dashboard:', error);
    return res.status(500).json({ message: 'Error retrieving admin dashboard data.' });
  }
};

// Staff Dashboard KPI
exports.getStaffDashboard = async (req, res) => {
  try {
    const spaceRes = await query('SELECT status, COUNT(*) as cnt FROM spaces GROUP BY status');
    let availableSpaces = 0;
    let rentedSpaces = 0;
    spaceRes.forEach(r => {
      if (r.status === 'available') availableSpaces = r.cnt;
      if (r.status === 'rented') rentedSpaces = r.cnt;
    });

    const pendingRentals = await query("SELECT COUNT(*) as cnt FROM rentals WHERE status='pending'");
    const totalPaymentsToday = await query("SELECT SUM(amount_paid) as total FROM payments WHERE DATE(payment_date) = CURRENT_DATE");

    return res.json({
      availableSpaces,
      rentedSpaces,
      pendingRentals: pendingRentals[0].cnt || 0,
      paymentsToday: totalPaymentsToday[0].total || 0
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching staff dashboard.' });
  }
};

// Renter Dashboard KPI
exports.getRenterDashboard = async (req, res) => {
  try {
    const renterId = req.user.id;

    // Active units
    const activeUnitsRes = await query("SELECT COUNT(*) as cnt FROM rentals WHERE renter_id=? AND status='active'", [renterId]);
    
    // Total outstanding balance
    const balRes = await query("SELECT SUM(balance) as total FROM billings WHERE renter_id=? AND status != 'paid'", [renterId]);
    
    // Next due date
    const dueRes = await query("SELECT MIN(due_date) as next_due FROM billings WHERE renter_id=? AND status != 'paid'", [renterId]);
    
    // Total paid
    const paidRes = await query('SELECT SUM(amount_paid) as total FROM payments WHERE renter_id=?', [renterId]);

    // Renter assigned spaces details
    const assignedSpaces = await query(`
      SELECT s.space_number, s.location, s.size_sqm, s.monthly_rate, r.start_date, r.end_date, r.status
      FROM rentals r
      JOIN spaces s ON r.space_id = s.id
      WHERE r.renter_id = ? AND r.status = 'active'
    `, [renterId]);

    // Recent 5 payments
    const recentPayments = await query(`
      SELECT p.amount_paid, p.payment_date, p.payment_type, p.reference_number, s.space_number
      FROM payments p
      JOIN billings b ON p.billing_id = b.id
      JOIN rentals r ON b.rental_id = r.id
      JOIN spaces s ON r.space_id = s.id
      WHERE p.renter_id = ?
      ORDER BY p.payment_date DESC LIMIT 5
    `, [renterId]);

    return res.json({
      activeUnits: activeUnitsRes[0].cnt || 0,
      outstandingBalance: balRes[0].total || 0,
      nextDueDate: dueRes[0].next_due || 'N/A',
      totalPaid: paidRes[0].total || 0,
      assignedSpaces,
      recentPayments
    });
  } catch (error) {
    console.error('Error fetching renter dashboard:', error);
    return res.status(500).json({ message: 'Error retrieving renter dashboard.' });
  }
};
