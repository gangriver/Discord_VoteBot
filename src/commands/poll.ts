import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ComponentType
} from 'discord.js';
import { prisma } from '../database';
import { addPollCloseJob } from '../jobs/pollCloser';
import type { PollData } from '../types';

const EMOJI_OPTIONS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export const data = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Create and manage polls')
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new poll')
      .addStringOption(option =>
        option.setName('title')
          .setDescription('Poll title')
          .setRequired(true)
          .setMaxLength(256)
      )
      .addStringOption(option =>
        option.setName('options')
          .setDescription('Poll options separated by semicolons (;)')
          .setRequired(true)
          .setMaxLength(1024)
      )
      .addStringOption(option =>
        option.setName('description')
          .setDescription('Poll description (optional)')
          .setMaxLength(1024)
      )
      .addBooleanOption(option =>
        option.setName('multiple')
          .setDescription('Allow multiple selections (default: false)')
      )
      .addBooleanOption(option =>
        option.setName('anonymous')
          .setDescription('Anonymous voting (default: false)')
      )
      .addIntegerOption(option =>
        option.setName('duration')
          .setDescription('Poll duration in minutes (default: no expiration)')
          .setMinValue(1)
          .setMaxValue(10080) // 7 days
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('close')
      .setDescription('Close a poll')
      .addStringOption(option =>
        option.setName('poll_id')
          .setDescription('Poll ID to close')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('Get poll statistics')
      .addStringOption(option =>
        option.setName('poll_id')
          .setDescription('Poll ID for statistics')
          .setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create':
      await createPoll(interaction);
      break;
    case 'close':
      await closePoll(interaction);
      break;
    case 'stats':
      await showStats(interaction);
      break;
    default:
      await interaction.reply({ content: 'Unknown subcommand', ephemeral: true });
  }
}

async function createPoll(interaction: ChatInputCommandInteraction) {
  console.log(`🏗️ Creating poll: ${interaction.options.getString('title', true)}`);
  
  const title = interaction.options.getString('title', true);
  const optionsString = interaction.options.getString('options', true);
  const description = interaction.options.getString('description');
  const allowMultiple = interaction.options.getBoolean('multiple') ?? false;
  const isAnonymous = interaction.options.getBoolean('anonymous') ?? false;
  const duration = interaction.options.getInteger('duration');

  const options = optionsString
    .split(';')
    .map(opt => opt.trim())
    .filter(opt => opt.length > 0);

  if (options.length < 2) {
    await interaction.reply({ 
      content: 'A poll must have at least 2 options.', 
      ephemeral: true 
    });
    return;
  }

  if (options.length > 10) {
    await interaction.reply({ 
      content: 'A poll cannot have more than 10 options.', 
      ephemeral: true 
    });
    return;
  }

  const expiresAt = duration ? new Date(Date.now() + duration * 60 * 1000) : null;

  try {
    // Create poll in database
    const poll = await prisma.poll.create({
      data: {
        title,
        description,
        guildId: interaction.guild!.id,
        channelId: interaction.channel!.id,
        creatorId: interaction.user.id,
        allowMultiple,
        isAnonymous,
        expiresAt,
        options: {
          create: options.map((text, index) => ({
            text,
            emoji: EMOJI_OPTIONS[index],
            position: index,
          })),
        },
      },
      include: {
        options: true,
      },
    });

    // Create embed
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${title}`)
      .setDescription(description || null)
      .setColor(0x5865F2)
      .setFooter({ 
        text: `Poll ID: ${poll.id} | Created by ${interaction.user.username}` 
      })
      .setTimestamp();

    // Add options to embed
    const optionsText = poll.options
      .map(opt => `${opt.emoji} ${opt.text} - **0** votes (0%)`)
      .join('\n');
    embed.addFields([{ name: 'Options', value: optionsText }]);

    // Add poll settings
    const settings = [];
    if (allowMultiple) settings.push('Multiple selections allowed');
    if (isAnonymous) settings.push('Anonymous voting');
    if (expiresAt) settings.push(`Expires: <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`);
    
    if (settings.length > 0) {
      embed.addFields([{ name: 'Settings', value: settings.join('\n') }]);
    }

    // Create buttons
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const buttonsPerRow = 5;
    
    for (let i = 0; i < poll.options.length; i += buttonsPerRow) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      
      for (let j = i; j < Math.min(i + buttonsPerRow, poll.options.length); j++) {
        const option = poll.options[j];
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`vote_${poll.id}_${option.id}`)
            .setLabel(`${option.emoji} ${option.text}`)
            .setStyle(ButtonStyle.Secondary)
        );
      }
      
      rows.push(row);
    }

    // Send poll message
    const message = await interaction.reply({ 
      embeds: [embed], 
      components: rows,
      fetchReply: true 
    });

    // Update poll with message ID
    await prisma.poll.update({
      where: { id: poll.id },
      data: { messageId: message.id },
    });

    // Schedule poll closing if duration is set
    if (expiresAt) {
      await addPollCloseJob(poll.id, expiresAt);
    }

  } catch (error) {
    console.error('Error creating poll:', error);
    await interaction.reply({ 
      content: 'An error occurred while creating the poll.', 
      ephemeral: true 
    });
  }
}

async function closePoll(interaction: ChatInputCommandInteraction) {
  const pollId = interaction.options.getString('poll_id', true);

  try {
    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        options: {
          include: {
            votes: true,
          },
        },
      },
    });

    if (!poll) {
      await interaction.reply({ 
        content: 'Poll not found.', 
        ephemeral: true 
      });
      return;
    }

    if (poll.creatorId !== interaction.user.id) {
      await interaction.reply({ 
        content: 'Only the poll creator can close this poll.', 
        ephemeral: true 
      });
      return;
    }

    if (poll.status === 'CLOSED') {
      await interaction.reply({ 
        content: 'This poll is already closed.', 
        ephemeral: true 
      });
      return;
    }

    // Close poll
    await prisma.poll.update({
      where: { id: pollId },
      data: { status: 'CLOSED' },
    });

    await interaction.reply({ 
      content: `Poll "${poll.title}" has been closed.` 
    });

  } catch (error) {
    console.error('Error closing poll:', error);
    await interaction.reply({ 
      content: 'An error occurred while closing the poll.', 
      ephemeral: true 
    });
  }
}

async function showStats(interaction: ChatInputCommandInteraction) {
  const pollId = interaction.options.getString('poll_id', true);

  try {
    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        options: {
          include: {
            votes: poll?.isAnonymous ? false : {
              select: { userId: true },
            },
          },
        },
        _count: {
          select: { votes: true },
        },
      },
    });

    if (!poll) {
      await interaction.reply({ 
        content: 'Poll not found.', 
        ephemeral: true 
      });
      return;
    }

    const totalVotes = poll._count.votes;
    
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${poll.title} - Statistics`)
      .setDescription(poll.description || null)
      .setColor(poll.status === 'OPEN' ? 0x5865F2 : 0x747F8D)
      .setFooter({ text: `Poll ID: ${poll.id}` })
      .setTimestamp();

    // Add results
    const results = poll.options.map(option => {
      const count = option.votes.length;
      const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      
      return `${option.emoji} ${option.text}\n**${count}** votes (${percentage}%)`;
    }).join('\n\n');

    embed.addFields([
      { 
        name: `Results (${totalVotes} total votes)`, 
        value: results || 'No votes yet' 
      }
    ]);

    // Add status
    const statusText = poll.status === 'OPEN' ? '🟢 Open' : '🔴 Closed';
    embed.addFields([{ name: 'Status', value: statusText, inline: true }]);

    if (poll.expiresAt) {
      const expiresText = poll.status === 'OPEN' 
        ? `<t:${Math.floor(poll.expiresAt.getTime() / 1000)}:R>`
        : `Expired <t:${Math.floor(poll.expiresAt.getTime() / 1000)}:R>`;
      embed.addFields([{ name: 'Expires', value: expiresText, inline: true }]);
    }

    await interaction.reply({ embeds: [embed] });

  } catch (error) {
    console.error('Error showing stats:', error);
    await interaction.reply({ 
      content: 'An error occurred while fetching poll statistics.', 
      ephemeral: true 
    });
  }
}