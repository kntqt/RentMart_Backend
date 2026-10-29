const { query } = require('../config/db');

// List market spaces (with status filter, search, and pagination)
exports.listSpaces = async (req, res) => {
  try {
    const { status, search, limit = 100, page = 1 } = req.query;
    let sql = 'SELECT * FROM spaces WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      sql += ' AND (space_number LIKE ? OR location LIKE ? OR description LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    sql += ' ORDER BY space_number ASC';

    const offset = (parseInt(page) - 1) * parseInt(limit);
    if (dbDriver === 'mysql') {
      sql += ' LIMIT ? OFFSET ?';
      params.push(parseInt(limit), offset);
    }

    const spaces = await query(sql, params);
    
    // Overall Stats
    const statsRows = await query('SELECT status, COUNT(*) as count FROM spaces GROUP BY status');
    const stats = { total: 0, available: 0, rented: 0, maintenance: 0 };
    statsRows.forEach(r => {
      stats[r.status] = r.count;
      stats.total += r.count;
    });

    return res.json({ spaces, stats });
  } catch (error) {
    console.error('Error listing spaces:', error);
    return res.status(500).json({ message: 'Error retrieving market spaces.' });
  }
};

// Get single space detail
exports.getSpaceById = async (req, res) => {
  try {
    const { id } = req.params;
    const spaces = await query('SELECT * FROM spaces WHERE id = ?', [id]);
    if (!spaces || spaces.length === 0) {
      return res.status(404).json({ message: 'Space not found.' });
    }
    return res.json(spaces[0]);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching space details.' });
  }
};

// Create space (Admin)
exports.createSpace = async (req, res) => {
  try {
    const { space_number, location, size_sqm, monthly_rate, description, status = 'available' } = req.body;

    if (!space_number || !monthly_rate) {
      return res.status(400).json({ message: 'Space number and monthly/yearly rate are required.' });
    }

    const existing = await query('SELECT id FROM spaces WHERE space_number = ?', [space_number.trim()]);
    if (existing && existing.length > 0) {
      return res.status(400).json({ message: `Space number '${space_number}' already exists.` });
    }

    const imagePath = req.file ? req.file.filename : null;

    const result = await query(`
      INSERT INTO spaces (space_number, location, size_sqm, monthly_rate, description, status, image)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [space_number, location || '', size_sqm || 0, monthly_rate, description || '', status, imagePath]);

    return res.status(201).json({
      message: 'Market space created successfully.',
      id: result.insertId || result.lastInsertRowid
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error creating space.' });
  }
};

// Update space
exports.updateSpace = async (req, res) => {
  try {
    const { id } = req.params;
    const { space_number, location, size_sqm, monthly_rate, description, status } = req.body;

    let sql = 'UPDATE spaces SET space_number=?, location=?, size_sqm=?, monthly_rate=?, description=?, status=?';
    const params = [space_number, location, size_sqm, monthly_rate, description, status];

    if (req.file) {
      sql += ', image=?';
      params.push(req.file.filename);
    }

    sql += ' WHERE id=?';
    params.push(id);

    await query(sql, params);
    return res.json({ message: 'Space details updated successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error updating space.' });
  }
};

// Update space status (Available / Maintenance / Rented)
exports.updateSpaceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await query('UPDATE spaces SET status = ? WHERE id = ?', [status, id]);
    return res.json({ message: `Space status updated to ${status}.` });
  } catch (error) {
    return res.status(500).json({ message: 'Error updating space status.' });
  }
};
