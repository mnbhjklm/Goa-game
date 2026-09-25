const mongoose = require('mongoose');

const txSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['deposit', 'withdraw', 'bet', 'win', 'admin_credit'],
    required: true
  },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'completed'
  },
  note: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', txSchema);
