import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// When running behind a proxy (Railway, etc.), honor X-Forwarded-* so req.ip is the real client IP
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY);
}

// Middleware
app.use(cors());
app.use(express.json());

// File to store subscribers
const SUBSCRIBERS_FILE = path.join(__dirname, 'subscribers.json');

// Ensure subscribers file exists
async function ensureSubscribersFile() {
  try {
    await fs.access(SUBSCRIBERS_FILE);
  } catch {
    await fs.writeFile(SUBSCRIBERS_FILE, JSON.stringify({ subscribers: [] }, null, 2));
  }
}

// Safely derive client IP, handling potential comma-separated X-Forwarded-For list
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const [first] = xff.split(',').map((ip) => ip.trim()).filter(Boolean);
    if (first) return first;
  } else if (Array.isArray(xff) && xff.length > 0) {
    const [first] = xff.map((ip) => (ip ?? '').toString().trim()).filter(Boolean);
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Get all subscribers
async function getSubscribers() {
  await ensureSubscribersFile();
  const data = await fs.readFile(SUBSCRIBERS_FILE, 'utf-8');
  return JSON.parse(data);
}

// Save subscribers
async function saveSubscribers(data) {
  await fs.writeFile(SUBSCRIBERS_FILE, JSON.stringify(data, null, 2));
}

// Simple in-process mutex to serialize subscriber file updates and avoid duplicate
let subscribersLock = Promise.resolve();

function withSubscribersLock(fn) {
  // Always chain onto the previous promise so operations run sequentially,
  const next = subscribersLock.then(fn, fn);
  subscribersLock = next.catch(() => {});
  return next;
}

async function addSubscriber(normalizedEmail, ip) {
  return withSubscribersLock(async () => {
    const data = await getSubscribers();

    // Check if already subscribed within the critical section to avoid duplication
    if (data.subscribers.some((sub) => sub.email === normalizedEmail)) {
      return { duplicate: true };
    }

    data.subscribers.push({
      email: normalizedEmail,
      subscribedAt: new Date().toISOString(),
      ip,
    });

    await saveSubscribers(data);
    return { duplicate: false };
  });
}

// API Routes

// Subscribe endpoint
app.post('/api/subscribe', async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email || !email.includes('@')) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide a valid email address' 
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const { duplicate } = await addSubscriber(normalizedEmail, getClientIp(req));
    if (duplicate) {
      return res.status(400).json({ 
        success: false, 
        message: 'This email is already subscribed!' 
      });
    }

    console.log(`New subscriber: ${normalizedEmail}`);

    // Here you could add email notification logic
    // For example, using nodemailer to send notification to admin

    res.json({ 
      success: true, 
      message: 'Thanks for subscribing! We\'ll notify you when we launch.' 
    });

  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Something went wrong. Please try again.' 
    });
  }
});

// Get subscriber count (optional admin endpoint)
app.get('/api/subscribers/count', async (req, res) => {
  try {
    const data = await getSubscribers();
    res.json({ count: data.subscribers.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get subscriber count' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
  console.log(`📧 Subscribe endpoint: POST http://localhost:${PORT}/api/subscribe`);
});
