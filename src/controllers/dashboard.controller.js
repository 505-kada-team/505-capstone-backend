const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const dashboardService = require('../services/dashboard.service');

const getDailyDashboard = asyncHandler(async (req, res) => {
  const { planId } = req.params;
  const { date } = req.query; 
  
  if (!date) {
    return new ApiResponse(400, null, 'date is required').send(res);
  }

  const dashboardData = await dashboardService.getDailyDashboardSummary(planId, date);
  
  return new ApiResponse(200, dashboardData, 'dashboard data fetched successfully').send(res);
});

module.exports = {
  getDailyDashboard
};