const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');

const routes = require('./routes');
const errorHandler = require('./middlewares/error.middleware');
const notFound = require('./middlewares/notFound.middleware');
const logger = require('./utils/logger');
const { clientUrl, rateLimit: rateLimitConfig, env } = require('./config/env');

const app = express();

// Security headers.
app.use(helmet());

// CORS - sesuaikan origin dengan URL frontend lewat CLIENT_URL.
app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  })
);

// Body & cookie parsing.
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Cegah NoSQL injection lewat query/body.
app.use(mongoSanitize());

// Response compression.
app.use(compression());

// HTTP request logging, diarahkan ke winston.
app.use(
  morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

// Rate limiter global. Route sensitif (login, OTP, dst) bisa pakai limiter
// yang lebih ketat sendiri begitu route tersebut ditambahkan.
app.use(
  rateLimit({
    windowMs: rateLimitConfig.windowMs,
    max: rateLimitConfig.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Terlalu banyak request, coba lagi nanti' },
  })
);

// Routes utama, versi API v1 supaya gampang breaking change di masa depan.
app.use('/api/v1', routes);

app.get('/', (req, res) => {
  res.json({ success: true, message: `API is running in ${env} mode` });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
