const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  betType: { type: String, enum: ['color', 'number'], required: true },
  betValue: String,           // color name ya number
  amount: Number,             // original bet
  effectiveAmount: Number,    // 6% cut ke baad
  result: { number: Number, color: String },
  won: Boolean,
  payout: Number,
  roundNumber: Number,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Bet', betSchema);
