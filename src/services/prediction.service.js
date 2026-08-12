const axios = require('axios');
const ApiError = require('../utils/ApiError');

async function getAssortmentPrediction({ duration, startDate, tags }) {
  const mlUrl = process.env.ML_SERVICE_URL || 'http://localhost:8000';

  try {
    const mlResponse = await axios.post(`${mlUrl}/predict-assortment`, {
      duration,
      startDate,
      tags: tags || [],
    });

    return mlResponse.data;
  } catch (error) {
    const statusCode = error.response ? error.response.status : 500;
    
    const errorMessage = error.response?.data?.detail || 'Gagal terhubung ke ML Service. Pastikan server AI menyala.';

    throw new ApiError(statusCode, errorMessage, [
      { field: 'mlService', message: error.message }
    ]);
  }
}

module.exports = {
  getAssortmentPrediction,
};