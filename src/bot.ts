import { 
  Client, 
  Collection, 
  GatewayIntentBits, 
  Events, 
  Interaction,
  SlashCommandBuilder
} from 'discord.js';
import { config } from './config';
import { handleVoteButton } from './handlers/buttonHandler';
import * as pollCommand from './commands/poll';
import * as pingCommand from './commands/ping';
import { createPollCloseWorker } from './jobs/pollCloser';

interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: any) => Promise<void>;
}

class VoteBot {
  private client: Client;
  private commands: Collection<string, Command>;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
    });

    this.commands = new Collection();
    this.setupCommands();
    this.setupEventHandlers();
  }

  private setupCommands() {
    // Register commands
    this.commands.set(pollCommand.data.name, pollCommand as Command);
    this.commands.set(pingCommand.data.name, pingCommand as Command);
  }

  private setupEventHandlers() {
    this.client.once(Events.ClientReady, (readyClient) => {
      console.log(`✅ Bot ready! Logged in as ${readyClient.user.tag}`);
      console.log(`📊 Serving ${readyClient.guilds.cache.size} guilds`);
      
      // Start the poll close worker
      createPollCloseWorker(this.client);
      console.log('🔄 Poll close worker started');
    });

    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      const startTime = Date.now();
      console.log(`📥 Interaction received: ${interaction.type} - ${interaction.isChatInputCommand() ? interaction.commandName : 'not a command'}`);
      
      try {
        if (interaction.isChatInputCommand()) {
          console.log(`🔧 Processing slash command: ${interaction.commandName}`);
          await this.handleSlashCommand(interaction);
        } else if (interaction.isButton()) {
          console.log(`🔘 Processing button interaction: ${interaction.customId}`);
          await this.handleButtonInteraction(interaction);
        } else {
          console.log(`❓ Unknown interaction type: ${interaction.type}`);
        }
        
        const duration = Date.now() - startTime;
        console.log(`⏱️ Interaction processed in ${duration}ms`);
      } catch (error) {
        console.error('Error handling interaction:', error);
        
        const errorMessage = { 
          content: 'An error occurred while processing your request.', 
          ephemeral: true 
        };

        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
          } else {
            await interaction.reply(errorMessage);
          }
        } catch (replyError) {
          console.error('Error sending error message:', replyError);
        }
      }
    });

    this.client.on(Events.Error, (error) => {
      console.error('Discord client error:', error);
    });

    this.client.on(Events.Debug, (info) => {
      if (config.environment === 'development') {
        console.log(`[DEBUG] ${info}`);
      }
    });
  }

  private async handleSlashCommand(interaction: any) {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      console.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    await command.execute(interaction);
  }

  private async handleButtonInteraction(interaction: any) {
    if (interaction.customId.startsWith('vote_')) {
      await handleVoteButton(interaction);
    }
  }

  public async start() {
    try {
      console.log('🤖 Starting VoteBot...');
      
      // Login to Discord
      await this.client.login(config.discord.token);
      
    } catch (error) {
      console.error('Failed to start bot:', error);
      process.exit(1);
    }
  }

  public async stop() {
    console.log('🛑 Stopping VoteBot...');
    this.client.destroy();
  }
}

// Handle process termination gracefully
const bot = new VoteBot();

process.on('SIGINT', async () => {
  console.log('\n⚠️  Received SIGINT, shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Received SIGTERM, shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception thrown:', error);
  process.exit(1);
});

// Start the bot
bot.start();