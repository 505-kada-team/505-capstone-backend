const mongoose = require('mongoose');

const dailySalesSummarySchema = new mongoose.Schema({
  date: { type: String, required: true, index: true }, // Format: 'YYYY-MM-DD'
  planId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  totalUnitsSold: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  
  hourlyTrends: [{
    hour: { type: Number },
    timeBucket: { type: String },
    unitsSold: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 }
  }],
  
  menuBreakdown: [{
    menuId: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String },
    unitsSold: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 }
  }],
  
  lastUpdatedAt: { type: Date, default: Date.now }
});

dailySalesSummarySchema.index({ date: 1, planId: 1 }, { unique: true });

module.exports = mongoose.model('DailySalesSummary', dailySalesSummarySchema);