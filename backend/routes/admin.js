const router = require('express').Router();
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Bet = require('../models/Bet');

// ===== ADMIN LOGIN =====
router.post('/login', (req, res) => {
  const { username, password, secretKey } = req.body;

  if (
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD ||
    secretKey !== process.env.ADMIN_SECRET_KEY
  ) {
    return res.status(403).json({ error: 'Invalid admin credentials' });
  }

  const token = jwt.sign(
    { isAdmin: true, username: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  res.json({ token });
});

// ===== STATS =====
router.get('/stats', auth, auth.adminOnly, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalBets = await Bet.countDocuments();

    const betAgg = await Bet.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const payoutAgg = await Bet.aggregate([
      { $group: { _id: null, total: { $sum: '$payout' } } }
    ]);

    const totalBetAmount = betAgg[0]?.total || 0;
    const totalPayout = payoutAgg[0]?.total || 0;
    const pendingTx = await Transaction.countDocuments({ status: 'pending' });

    res.json({
      totalUsers,
      totalBets,
      totalBetAmount,
      totalPayout,
      profit: totalBetAmount - totalPayout,
      pendingTx
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ALL USERS =====
router.get('/users', auth, auth.adminOnly, async (req, res) => {
  const users = await User.find().select('-password').sort({ createdAt: -1 });
  res.json(users);
});

// ===== CREDIT / DEBIT USER BALANCE =====
router.post('/user/:id/balance', auth, auth.adminOnly, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = parseFloat(amount);
    if (!amt || isNaN(amt)) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.balance += amt;
    if (user.balance < 0) user.balance = 0;
    await user.save();

    await Transaction.create({
      userId: user._id,
      type: 'admin_credit',
      amount: Math.abs(amt),
      status: 'completed',
      note: note || (amt > 0 ? 'Admin credit' : 'Admin debit')
    });

    res.json({ balance: user.balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== BLOCK / UNBLOCK USER =====
router.post('/user/:id/block', auth, auth.adminOnly, async (req, res) => {
  try {
    const { block } = req.body;
    await User.findByIdAndUpdate(req.params.id, { isBlocked: !!block });
    res.json({ message: 'Updated' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== PENDING TRANSACTIONS =====
router.get('/pending', auth, auth.adminOnly, async (req, res) => {
  const txs = await Transaction.find({ status: 'pending' })
    .populate('userId', 'username')
    .sort({ createdAt: -1 });
  res.json(txs);
});

// ===== APPROVE / REJECT TRANSACTION =====
router.post('/transaction/:id', auth, auth.adminOnly, async (req, res) => {
  try {
    const { action } = req.body;
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Not found' });
    if (tx.status !== 'pending') {
      return res.status(400).json({ error: 'Already processed' });
    }

    if (action === 'approve') {
      tx.status = 'approved';
      if (tx.type === 'deposit') {
        await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
      }
    } else if (action === 'reject') {
      tx.status = 'rejected';
      if (tx.type === 'withdraw') {
        await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
      }
    }
    await tx.save();
    res.json({ message: 'Done' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== RECENT BETS =====
router.get('/recent-bets', auth, auth.adminOnly, async (req, res) => {
  const bets = await Bet.find()
    .populate('userId', 'username')
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(bets);
});

module.exports = router;
