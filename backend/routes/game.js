const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Bet = require('../models/Bet');
const Transaction = require('../models/Transaction');

// ===== CONFIG =====
const COLORS = [
  { name: 'Green',  hex: '#00CC44', mult: 2 },
  { name: 'Violet', hex: '#8B00FF', mult: 5 },
  { name: 'Red',    hex: '#FF0000', mult: 2 }
];

// Number -> color index mapping
const NUM_COLOR = {
  0: 1, // Violet
  1: 0, // Green
  2: 2, // Red
  3: 0, // Green
  4: 2, // Red
  5: 1, // Violet
  6: 2, // Red
  7: 0, // Green
  8: 2, // Red
  9: 0  // Green
};

const NUM_PAYOUT = 9;      // 9x for number
const CUT_PERCENT = 0.06;  // 6% cut
const POOL_CAP = 0.90;     // 90% max payout

// ===== STATE (in-memory, single instance) =====
let currentRound = {
  number: 1,
  startTime: Date.now(),
  duration: 60 * 1000, // 60 sec
  activeBets: [],      // {userId, betType, betValue, amount, effective}
  closed: false,
  result: null         // {number, color, colorIdx}
};

// Round counter for pattern
let roundPatternCounter = 0;

// ===== HELPER: Decide winner based on pattern =====
function decideResult(bets) {
  roundPatternCounter++;
  const patternPos = ((roundPatternCounter - 1) % 5) + 1;
  // patternPos: 1, 2 → lowest bet
  //             3, 4, 5 → no-bet random

  if (patternPos === 1 || patternPos === 2) {
    return lowestBetResult(bets);
  } else {
    return randomNoBetResult(bets);
  }
}

// ===== LOWEST BET WINNER =====
function lowestBetResult(bets) {
  // Color totals
  const colorTotals = [0, 0, 0];
  const numberTotals = {};
  for (let i = 0; i <= 9; i++) numberTotals[i] = 0;

  let colorSum = 0;
  let numberSum = 0;

  bets.forEach(b => {
    if (b.betType === 'color') {
      colorTotals[b.betValue] += b.effective;
      colorSum += b.effective;
    } else if (b.betType === 'number') {
      numberTotals[b.betValue] += b.effective;
      numberSum += b.effective;
    }
  });

  // Decide: color side or number side
  if (colorSum >= numberSum) {
    // Color side wins — find lowest color
    // Check if any color has 0 bet
    for (let i = 0; i < 3; i++) {
      if (colorTotals[i] === 0) {
        // Winner color has no bet → no payout
        const colorIdx = i;
        // Find a number with this color
        const num = Object.keys(NUM_COLOR).find(k => NUM_COLOR[k] === colorIdx);
        return { number: parseInt(num), colorIdx, noPayout: true };
      }
    }
    // All colors have bets — pick lowest
    let minIdx = 0;
    for (let i = 1; i < 3; i++) {
      if (colorTotals[i] < colorTotals[minIdx]) minIdx = i;
    }
    const num = Object.keys(NUM_COLOR).find(k => NUM_COLOR[k] === minIdx);
    return { number: parseInt(num), colorIdx: minIdx, noPayout: false };
  } else {
    // Number side wins — find lowest number
    for (let i = 0; i <= 9; i++) {
      if (numberTotals[i] === 0) {
        return { number: i, colorIdx: NUM_COLOR[i], noPayout: true };
      }
    }
    let minNum = 0;
    for (let i = 1; i <= 9; i++) {
      if (numberTotals[i] < numberTotals[minNum]) minNum = i;
    }
    return { number: minNum, colorIdx: NUM_COLOR[minNum], noPayout: false };
  }
}

// ===== RANDOM NO-BET WINNER =====
function randomNoBetResult(bets) {
  const bettedNumbers = new Set();
  const bettedColors = new Set();

  bets.forEach(b => {
    if (b.betType === 'number') bettedNumbers.add(b.betValue);
    if (b.betType === 'color') bettedColors.add(b.betValue);
  });

  // Try random numbers whose color isn't betted
  const freeNumbers = [];
  for (let i = 0; i <= 9; i++) {
    const cIdx = NUM_COLOR[i];
    if (!bettedNumbers.has(i) && !bettedColors.has(cIdx)) {
      freeNumbers.push(i);
    }
  }

  if (freeNumbers.length > 0) {
    const num = freeNumbers[Math.floor(Math.random() * freeNumbers.length)];
    return { number: num, colorIdx: NUM_COLOR[num], noPayout: true };
  }

  // Fallback: try number not betted (color may be betted)
  const numFree = [];
  for (let i = 0; i <= 9; i++) {
    if (!bettedNumbers.has(i)) numFree.push(i);
  }
  if (numFree.length > 0) {
    const num = numFree[Math.floor(Math.random() * numFree.length)];
    return { number: num, colorIdx: NUM_COLOR[num], noPayout: true };
  }

  // Fallback 2: all covered → use lowest bet
  return lowestBetResult(bets);
}

// ===== PLACE BET =====
router.post('/bet', auth, async (req, res) => {
  try {
    if (currentRound.closed) {
      return res.status(400).json({ error: 'Round closed. Wait for next.' });
    }

    const { amount, colorIdx, number } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: 'Valid amount daalo' });
    }
    if (colorIdx === undefined && number === undefined) {
      return res.status(400).json({ error: 'Color ya number select karo' });
    }

    // Check already bet in this round
    const alreadyBet = currentRound.activeBets.find(
      b => b.userId.toString() === req.user.id
    );
    if (alreadyBet) {
      return res.status(400).json({ error: 'Is round me already bet lagayi hai' });
    }

    const user = await User.findById(req.user.id);
    if (user.balance < amt) {
      return res.status(400).json({ error: 'Balance kam hai' });
    }

    // 6% cut
    const effective = amt * (1 - CUT_PERCENT);

    // Deduct bet amount
    user.balance -= amt;
    await user.save();

    await Transaction.create({
      userId: user._id,
      type: 'bet',
      amount: amt,
      status: 'completed'
    });

    // Add to active bets
    const betData = {
      userId: user._id,
      username: user.username,
      amount: amt,
      effective,
      betType: colorIdx !== undefined ? 'color' : 'number',
      betValue: colorIdx !== undefined ? colorIdx : number
    };
    currentRound.activeBets.push(betData);

    res.json({
      message: 'Bet placed',
      balance: user.balance,
      roundNumber: currentRound.number
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== CLOSE ROUND + DECLARE RESULT =====
async function closeRoundAndDeclare() {
  currentRound.closed = true;

  const bets = currentRound.activeBets;
  let result;

  if (bets.length === 0) {
    // No bets — random result
    const num = Math.floor(Math.random() * 10);
    result = { number: num, colorIdx: NUM_COLOR[num], noPayout: true };
  } else {
    result = decideResult(bets);
  }

  const colorInfo = COLORS[result.colorIdx];

  // Calculate payouts
  let totalPool = 0;
  bets.forEach(b => totalPool += b.effective);

  const maxPayout = totalPool * POOL_CAP;

  let totalNormalPayout = 0;
  const winnerBets = [];

  if (!result.noPayout) {
    bets.forEach(b => {
      let won = false;
      let payout = 0;

      if (b.betType === 'number' && b.betValue === result.number) {
        won = true;
        payout = b.effective * NUM_PAYOUT;
      } else if (b.betType === 'color' && b.betValue === result.colorIdx) {
        won = true;
        payout = b.effective * colorInfo.mult;
      }

      if (won) {
        winnerBets.push({ ...b, payout });
        totalNormalPayout += payout;
      }
    });
  }

  // Apply cap if needed
  let capRatio = 1;
  if (totalNormalPayout > maxPayout && totalNormalPayout > 0) {
    capRatio = maxPayout / totalNormalPayout;
  }

  // Distribute winnings
  for (const wb of winnerBets) {
    const actualPayout = Math.round(wb.payout * capRatio);
    if (actualPayout > 0) {
      await User.findByIdAndUpdate(wb.userId, { $inc: { balance: actualPayout } });
      await Transaction.create({
        userId: wb.userId,
        type: 'win',
        amount: actualPayout,
        status: 'completed'
      });
    }

    // Save bet record
    await Bet.create({
      userId: wb.userId,
      betType: wb.betType,
      betValue: String(wb.betValue),
      amount: wb.amount,
      effectiveAmount: wb.effective,
      result: { number: result.number, color: colorInfo.name },
      won: true,
      payout: actualPayout,
      roundNumber: currentRound.number
    });
  }

  // Save losing bets
  const winnerIds = new Set(winnerBets.map(w => w.userId.toString()));
  for (const b of bets) {
    if (!winnerIds.has(b.userId.toString())) {
      await Bet.create({
        userId: b.userId,
        betType: b.betType,
        betValue: String(b.betValue),
        amount: b.amount,
        effectiveAmount: b.effective,
        result: { number: result.number, color: colorInfo.name },
        won: false,
        payout: 0,
        roundNumber: currentRound.number
      });
    }
  }

  currentRound.result = {
    number: result.number,
    color: colorInfo.name,
    colorHex: colorInfo.hex,
    colorIdx: result.colorIdx,
    noPayout: result.noPayout
  };
}

// ===== GET CURRENT ROUND INFO =====
router.get('/round', async (req, res) => {
  const now = Date.now();
  const elapsed = now - currentRound.startTime;
  const remaining = Math.max(0, Math.floor((currentRound.duration - elapsed) / 1000));

  res.json({
    roundNumber: currentRound.number,
    remaining,
    closed: currentRound.closed,
    result: currentRound.result
  });
});

// ===== START NEW ROUND =====
function startNewRound() {
  currentRound = {
    number: currentRound.number + 1,
    startTime: Date.now(),
    duration: 60 * 1000,
    activeBets: [],
    closed: false,
    result: null
  };
}

// ===== AUTO ROUND LOOP =====
setInterval(async () => {
  const now = Date.now();
  const elapsed = now - currentRound.startTime;

  // Close round 3 sec before end
  if (!currentRound.closed && elapsed >= currentRound.duration - 3000) {
    await closeRoundAndDeclare();
  }

  // Start new round
  if (elapsed >= currentRound.duration) {
    startNewRound();
  }
}, 1000);

// ===== LAST RESULTS =====
router.get('/results', async (req, res) => {
  try {
    const bets = await Bet.find()
      .sort({ createdAt: -1 })
      .limit(30)
      .select('result createdAt');
    const seen = new Set();
    const results = [];
    for (const b of bets) {
      const key = b.result?.number + '-' + b.createdAt?.getTime();
      if (!seen.has(key)) {
        seen.add(key);
        results.push(b.result);
        if (results.length >= 5) break;
      }
    }
    res.json(results);
  } catch (e) {
    res.json([]);
  }
});

// ===== LAST RESULT FOR USER =====
router.get('/last-result', auth, async (req, res) => {
  try {
    const bet = await Bet.findOne({ userId: req.user.id }).sort({ createdAt: -1 });
    if (!bet) return res.json({ showResult: false });

    const timeSince = Date.now() - new Date(bet.createdAt).getTime();
    if (timeSince < 60000) {
      return res.json({
        showResult: true,
        number: bet.result.number,
        won: bet.won,
        winAmount: bet.payout
      });
    }
    res.json({ showResult: false });
  } catch (e) {
    res.json({ showResult: false });
  }
});

module.exports = router;
