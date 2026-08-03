const { port } = require('./src/config/env');
const app = require('./src/app');
const connectDB = require('./src/config/db');
const logger = require('./src/utils/logger');

let server;

const start = async () => {
  await connectDB();
  server = app.listen(port, () => {
    logger.info(`Server berjalan di port ${port}`);
  });
};

start();

// Graceful shutdown & tangkap error yang tidak ter-handle.
const exitHandler = () => {
  if (server) {
    server.close(() => {
      logger.info('Server ditutup');
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
};

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  exitHandler();
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`);
  exitHandler();
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM diterima, menutup server dengan baik');
  if (server) server.close();
});

module.exports = server;
