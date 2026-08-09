const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const planReportService = require('../services/report.service');

const createReport = asyncHandler(async (req, res) => {
  // reportedBy/reportedByRole diambil dari req.user (hasil authenticate()),
  // bukan dari body -- pola sama dengan cashierName di Selling.
  const report = await planReportService.createReport({
    ...req.body,
    reportedBy: req.user.name,
    reportedByRole: req.user.role,
  });

  const message =
    report.reportedByRole === 'admin'
      ? 'Laporan tercatat dan otomatis disetujui'
      : 'Laporan berhasil dikirim, menunggu review admin';

  return new ApiResponse(201, report, message).send(res);
});

const listReports = asyncHandler(async (req, res) => {
  const reports = await planReportService.listReports(req.query);
  return new ApiResponse(200, reports, 'Daftar laporan berhasil diambil').send(res);
});

const reviewReport = asyncHandler(async (req, res) => {
  const report = await planReportService.reviewReport(req.params.id, {
    ...req.body,
    reviewedBy: req.user.name,
  });

  const message = report.status === 'approved' ? 'Laporan disetujui' : 'Laporan ditolak';
  return new ApiResponse(200, report, message).send(res);
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
