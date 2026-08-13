/**
 * Manual, human-readable stand-in for GS1 AI(10)+AI(17) batch/lot + expiry
 * coding, sized for a single branch without barcode-scanner infrastructure.
 *
 * itemCode: short code derived from the Inventory name, e.g.
 *   "Tepung Terigu Segitiga Biru" -> "TTS"
 *   "Gula"                        -> "GUL"
 *
 * batchCode: `${itemCode}-${YYMMDD}-${seq}`, e.g. "TPG-260729-01"
 *   seq resets per item per calendar day (inDate), NOT globally.
 */

function deriveItemCode(name) {
  const cleaned = String(name)
    .normalize('NFKD')
    .replace(/[^a-zA-Z ]/g, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  let code;
  if (words.length >= 3) {
    code = words
      .slice(0, 3)
      .map((w) => w[0])
      .join('');
  } else if (words.length === 2) {
    code = words[0].slice(0, 2) + words[1][0];
  } else if (words.length === 1) {
    code = words[0].slice(0, 3);
  } else {
    code = 'ITM';
  }

  code = code.toUpperCase();
  while (code.length < 3) code += 'X';
  return code;
}

function formatDateYYMMDD(date) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/**
 * @param {import('mongoose').Model} SubInventoryModel
 * @param {string} itemCode
 * @param {Date} inDate
 * @param {import('mongoose').ClientSession} [session]
 * @returns {Promise<string>}
 */
async function generateBatchCode(SubInventoryModel, itemCode, inDate, session) {
  const dateStr = formatDateYYMMDD(inDate);
  const prefix = `${itemCode}-${dateStr}-`;

  // Sequence is scoped to this item + this calendar day.
  const existingCount = await SubInventoryModel.countDocuments({
    batchCode: { $regex: `^${prefix}` },
  }).session(session || null);

  const seq = String(existingCount + 1).padStart(2, '0');
  return `${prefix}${seq}`;
}

module.exports = { deriveItemCode, generateBatchCode, formatDateYYMMDD };
