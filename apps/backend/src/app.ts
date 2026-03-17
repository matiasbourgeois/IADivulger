import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { jobRouter } from './routes/jobs.routes';
import { createProxyMiddleware } from 'http-proxy-middleware';

import path from 'path';

const app: Express = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Proxy assets to AI Worker
app.use(
  '/api/assets',
  createProxyMiddleware({
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
    pathRewrite: {
      '^/': '/assets/', // rewrite root of this mount to /assets/ on target
    },
    on: {
      proxyReq: (proxyReq: any, req: any, res: any) => {
        console.log(`[Proxy] Routing ${req.method} ${req.url} -> ${proxyReq.path}`);
      },
      error: (err: any, req: any, res: any) => {
        console.error('[Proxy Error]', err);
      }
    }
  })
);

// Serve static assets (renders, etc.)
app.use('/public', express.static(path.join(__dirname, '../public')));
app.use('/outputs', express.static(path.join(__dirname, '../public/outputs')));
app.use('/audio', express.static(path.join(__dirname, '../public/audio')));

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/jobs', jobRouter);

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
