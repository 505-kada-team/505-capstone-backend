const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const predictionService = require('../services/prediction.service');

const getAssortmentPrediction = asyncHandler(async (req, res) => {
  const { duration, startDate, tags } = req.body;

  if (!duration || !startDate) {
    return res.status(400).json({ 
      success: false,
      message: 'Duration and startDate fields are required.' 
    });
  }

  const userId = req.user._id || req.user.id;

  const result = await predictionService.getAssortmentPrediction({
    duration,
    startDate,
    tags: tags || [],
    userId
  });

  return new ApiResponse(
    200, 
    result, 
    'Successfully retrieved menu quantity recommendations from AI'
  ).send(res);
});

module.exports = {
  getAssortmentPrediction
};