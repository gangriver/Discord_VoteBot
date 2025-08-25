import { REST, Routes } from 'discord.js';
import { config } from '../config';
import * as pollCommand from '../commands/poll';
import * as pingCommand from '../commands/ping';

const commands = [
  pollCommand.data.toJSON(),
  pingCommand.data.toJSON(),
];

const rest = new REST().setToken(config.discord.token);

async function deployCommands() {
  try {
    console.log(`🔄 Started refreshing ${commands.length} application (/) commands.`);

    const data = await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body: commands }
    ) as any[];

    console.log(`✅ Successfully reloaded ${data.length} application (/) commands.`);
  } catch (error) {
    console.error('❌ Error deploying commands:', error);
  }
}

deployCommands();