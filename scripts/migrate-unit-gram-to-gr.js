// scripts/migrate-unit-gram-to-gr.js
const mongoose = require('mongoose');
const Inventory = require('../models/inventory/inventory.model');

async function migrate() {
  const result = await Inventory.updateMany({ unit: 'gram' }, { $set: { unit: 'gr' } });
  console.log(`Normalized ${result.modifiedCount} inventory documents from "gram" to "gr".`);
}

migrate().then(() => mongoose.disconnect());
