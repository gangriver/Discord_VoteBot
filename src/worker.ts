import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config';
import { createPollCloseWorker } from './jobs/pollCloser';

class VoteBotWorker {
  private client: Client;
  private worker: any;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.client.once('ready', (readyClient) => {
      console.log(`✅ Worker ready! Logged in as ${readyClient.user.tag}`);
      
      // Start the poll close worker
      this.worker = createPollCloseWorker(this.client);
      console.log('🔄 Poll close worker started');
    });

    this.client.on('error', (error) => {
      console.error('Discord client error:', error);
    });
  }

  public async start() {
    try {
      console.log('🔄 Starting VoteBot Worker...');
      
      // Login to Discord
      await this.client.login(config.discord.token);
      
    } catch (error) {
      console.error('Failed to start worker:', error);
      process.exit(1);
    }
  }

  public async stop() {
    console.log('🛑 Stopping VoteBot Worker...');
    
    if (this.worker) {
      await this.worker.close();
    }
    
    this.client.destroy();
  }
}

// Handle process termination gracefully
const worker = new VoteBotWorker();

process.on('SIGINT', async () => {
  console.log('\n⚠️  Received SIGINT, shutting down gracefully...');
  await worker.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Received SIGTERM, shutting down gracefully...');
  await worker.stop();
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception thrown:', error);
  process.exit(1);
});

// Start the worker
worker.start();