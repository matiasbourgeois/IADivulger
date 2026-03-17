import app from './app';
import { config } from './config';
import { AudioServiceFactory } from './services/audio/AudioServiceFactory';

const startServer = () => {
  console.log('🚀 Starting IADivulger Backend...');
  console.log(`Environment: ${config.nodeEnv}`);
  
  // Verify audio factory resolves correctly
  try {
    const service = AudioServiceFactory.getService();
    console.log(`✅ Audio Provider loaded: ${service.providerName}`);
  } catch (err: any) {
    console.error(`❌ Failed to initialize Audio Provider: ${err.message}`);
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`🚀 IADivulger Backend running on port ${config.port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down server gracefully...');
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

startServer();
