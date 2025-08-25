import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Pong! Test if the bot is working');

export async function execute(interaction: ChatInputCommandInteraction) {
  console.log('🏓 Ping command received!');
  await interaction.reply('🏓 Pong! Bot is working!');
}