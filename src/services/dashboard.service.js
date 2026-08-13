const PlanSale = require('../models/selling/selling.model');
const ProductionPlan = require('../models/plan/productionPlan.model');
const ApiError = require("../utils/ApiError");

const getDailyDashboardSummary = async (planId, dateString) => {
  const plan = await ProductionPlan.findById(planId).select('name duration menus');
  if (!plan) {
    throw new ApiError(404, 'Plan not found');
  }

  const startOfDay = new Date(`${dateString}T00:00:00.000Z`);
  const endOfDay = new Date(`${dateString}T23:59:59.999Z`);
  
  const aggregationResult = await PlanSale.aggregate([
    {
      $match: {
        planId: plan._id,
        soldAt: { $gte: startOfDay, $lte: endOfDay }
      }
    },
    {
      $unwind: '$items'
    },
    {
      $facet: {
        overview: [
          {
            $group: {
              _id: null,
              totalUnitsSold: { $sum: '$items.quantitySold' },
              totalRevenue: {
                $sum: { $multiply: ['$items.quantitySold', '$items.priceUsed'] }
              }
            }
          }
        ],
        hourlyTrends: [
          {
            $group: {
              _id: { $hour: '$soldAt' },
              unitsSold: { $sum: '$items.quantitySold' },
              revenue: {
                $sum: { $multiply: ['$items.quantitySold', '$items.priceUsed'] }
              }
            }
          },
          { $sort: { _id: 1 } }
        ],
        menuBreakdown: [
          {
            $group: {
              _id: '$items.menuId',
              name: { $first: '$items.menuName' },
              unitsSold: { $sum: '$items.quantitySold' },
              revenue: {
                $sum: { $multiply: ['$items.quantitySold', '$items.priceUsed'] }
              }
            }
          },
          { $sort: { revenue: -1 } }
        ]
      }
    }
  ]);
  
  const rawData = aggregationResult[0] || {};
  const overview = (rawData.overview && rawData.overview[0]) || { totalUnitsSold: 0, totalRevenue: 0 };
  
  const formattedHourly = Array.from({ length: 24 }, (_, i) => {
    const found = (rawData.hourlyTrends || []).find((h) => h._id === i);
    return {
      hour: i,
      timeBucket: `${i.toString().padStart(2, '0')}:00`,
      unitsSold: found ? found.unitsSold : 0,
      revenue: found ? found.revenue : 0
    };
  });
  
  const menuMetadata = {};
  if (plan && plan.menus) {
    plan.menus.forEach(m => {
      menuMetadata[m.menuId.toString()] = {
        image: m.frozenMenuImage,
        name: m.frozenMenuName
      };
    });
  }
  
  const formattedMenuBreakdown = (rawData.menuBreakdown || []).map((m) => {
    const meta = menuMetadata[m._id.toString()] || {};
    return {
      menuId: m._id,
      name: meta.name || m.name,
      image: meta.image || null,
      unitsSold: m.unitsSold,
      revenue: m.revenue
    };
  });
  
  return {
    date: dateString,
    planId: planId,
    planName: plan.name,
    planDuration: plan.duration,
    totalUnitsSold: overview.totalUnitsSold,
    totalRevenue: overview.totalRevenue,
    hourlyTrends: formattedHourly,
    menuBreakdown: formattedMenuBreakdown,
  };
};
  
module.exports = {
  getDailyDashboardSummary
};