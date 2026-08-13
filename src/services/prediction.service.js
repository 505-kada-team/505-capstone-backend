const axios = require('axios');
const ApiError = require('../utils/ApiError');
const Menu = require('../models/menu/menu.model'); 

async function getAssortmentPrediction({ duration, startDate, tags, userId }) {
  const menus = await Menu.find({
    userId: userId,
    status: 'active',
    deletedAt: null
  }).select('_id name sellingPrice ingredients').lean();

  if (!menus || menus.length === 0) {
    return []; 
  }

  const mlUrl = process.env.ML_SERVICE_URL || 'http://localhost:8000';

  try {
    const mlResponse = await axios.post(`${mlUrl}/predict-assortment`, {
      duration,
      startDate,
      tags: tags || [],
      menus: menus
    });

    return mlResponse.data;
  } catch (error) {
    const statusCode = error.response ? error.response.status : 500;
    
    let errorMessage = 'Gagal terhubung ke ML Service.';
    if (error.response && error.response.data && error.response.data.detail) {
      if (typeof error.response.data.detail === 'string') {
        errorMessage = error.response.data.detail;
      } else {
        errorMessage = JSON.stringify(error.response.data.detail);
      }
    }

    throw new ApiError(statusCode, errorMessage, [
      { field: 'mlService', message: error.message }
    ]);
  }
}

module.exports = {
  getAssortmentPrediction,
};