// scripts/fixUnitData.js
require('dotenv').config();
const mongoose = require('mongoose');
const Inventory = require('../src/models/inventory/inventory.model');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const bad = await Inventory.find({ unit: 'gram' });
  console.log(
    `Ditemukan ${bad.length} record dengan unit "gram":`,
    bad.map((b) => b._id)
  );

  const result = await Inventory.updateMany({ unit: 'gram' }, { $set: { unit: 'gr' } });
  console.log('Updated:', result.modifiedCount);

  await mongoose.disconnect();
}

run().catch(console.error);
