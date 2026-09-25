const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// Balance check
router.get('/balance', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ balance: user.balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Deposit request
router.post('/deposit', auth, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: 'Valid amount daalo' });
    }

    const tx = await Transaction.create({
      userId: req.user.id,
      type: 'deposit',
      amount: amt,
      status: 'pending',
      note: note || ''
    });

    res.json({ message: 'Deposit request bheja gaya', tx });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Withdraw request
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: 'Valid amount daalo' });
    }

    const user = await User.findById(req.user.id);
    if (user.balance < amt) {
      return res.status(400).json({ error: 'Balance kam hai' });
    }

    user.balance -= amt;
    await user.save();

    const tx = await Transaction.create({
      userId: user._id,
      type: 'withdraw',
      amount: amt,
      status: 'pending',
      note: note || ''
    });

    res.json({ message: 'Withdraw request bheja gaya', balance: user.balance, tx });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Transaction history
router.get('/transactions', auth, async (req, res) => {
  try {
    const txs = await Transaction.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(txs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
