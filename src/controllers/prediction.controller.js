const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const axios = require('axios');

const getAssortmentPrediction = asyncHandler(async (req, res) => {
  const { duration, startDate, tags } = req.body;

  if (!duration || !startDate) {
    return res.status(400).json({ 
      success: false,
      message: 'Duration and startDate fields are required.' 
    });
  }

  const mlUrl = process.env.ML_SERVICE_URL || 'http://localhost:8000';

  const mlResponse = await axios.post(`${mlUrl}/predict-assortment`, {
    duration: duration,
    startDate: startDate,
    tags: tags || []
  });

  return new ApiResponse(
    200, 
    mlResponse.data, 
    'Successfully retrieved menu quantity recommendations from AI'
  ).send(res);
});

module.exports = {
  getAssortmentPrediction
};