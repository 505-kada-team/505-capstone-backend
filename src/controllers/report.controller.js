const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const planReportService = require('../services/report.service');

const createReport = asyncHandler(async (req, res) => {
  // reportedBy & reportedByRole SENGAJA diambil dari req.user, BUKAN body
  // -- lihat planReport.validation.js. reportedByRole dipetakan dari
  // req.user.role: hanya 'admin' yang memicu auto-approve C1, role lain
  // (termasuk 'cashier' atau apapun yang bukan admin) dianggap 'cashier'
  // untuk keperluan enum reportedByRole di PlanReport (RFC hanya kenal 2
  // nilai: cashier/admin).
  const report = await planReportService.createReport({
    ...req.body,
    reportedBy: req.user.name,
    reportedByRole: req.user.role === 'admin' ? 'admin' : 'cashier',
  });

  const message =
    report.status === 'approved'
      ? 'Laporan tercatat dan otomatis disetujui'
      : 'Laporan berhasil dikirim, menunggu review admin';

  return new ApiResponse(201, report, message).send(res);
});

const listReports = asyncHandler(async (req, res) => {
  const reports = await planReportService.listReports(req.query);
  return new ApiResponse(200, reports, 'Daftar laporan berhasil diambil').send(res);
});

const reviewReport = asyncHandler(async (req, res) => {
  const result = await planReportService.reviewReport(req.params.id, {
    ...req.body,
    reviewedBy: req.user.name,
  });

  const message = result.status === 'approved' ? 'Laporan disetujui' : 'Laporan ditolak';
  return new ApiResponse(200, result, message).send(res);
});

const addInventoryReplacement = asyncHandler(async (req, res) => {
  const result = await planReportService.addInventoryReplacement(req.params.id, {
    ...req.body,
    replacedBy: req.user.name,
  });

  return new ApiResponse(
    200,
    result,
    'Stok pengganti berhasil ditarik dan dicatat di laporan'
  ).send(res);
});

module.exports = {
  createReport,
  listReports,
  reviewReport,
  addInventoryReplacement,
};
