import { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { prisma } from '../database';

export async function handleVoteButton(interaction: ButtonInteraction) {
  const [, pollId, optionId] = interaction.customId.split('_');
  const userId = interaction.user.id;

  try {
    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        options: {
          include: {
            votes: true,
          },
        },
        votes: {
          where: { userId },
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

    if (poll.status === 'CLOSED') {
      await interaction.reply({ 
        content: 'This poll is closed.', 
        ephemeral: true 
      });
      return;
    }

    // Check if poll has expired
    if (poll.expiresAt && poll.expiresAt < new Date()) {
      await interaction.reply({ 
        content: 'This poll has expired.', 
        ephemeral: true 
      });
      return;
    }

    const selectedOption = poll.options.find(opt => opt.id === optionId);
    if (!selectedOption) {
      await interaction.reply({ 
        content: 'Invalid option selected.', 
        ephemeral: true 
      });
      return;
    }

    // Check if user already voted for this option
    const existingVote = poll.votes.find(vote => vote.optionId === optionId);
    if (existingVote) {
      // Remove vote (toggle off)
      await prisma.vote.delete({
        where: { id: existingVote.id },
      });

      await interaction.reply({ 
        content: `Removed your vote for "${selectedOption.text}".`, 
        ephemeral: true 
      });
    } else {
      // Check if multiple votes are allowed
      if (!poll.allowMultiple && poll.votes.length > 0) {
        // Remove existing votes first
        await prisma.vote.deleteMany({
          where: {
            pollId,
            userId,
          },
        });
      }

      // Add new vote
      try {
        await prisma.vote.create({
          data: {
            userId,
            pollId,
            optionId,
          },
        });

        await interaction.reply({ 
          content: `Voted for "${selectedOption.text}".`, 
          ephemeral: true 
        });
      } catch (error) {
        // Handle duplicate vote error
        await interaction.reply({ 
          content: 'You have already voted for this option.', 
          ephemeral: true 
        });
        return;
      }
    }

    // Update the poll message with new vote counts
    await updatePollMessage(interaction, poll);

  } catch (error) {
    console.error('Error handling vote:', error);
    await interaction.reply({ 
      content: 'An error occurred while processing your vote.', 
      ephemeral: true 
    });
  }
}

async function updatePollMessage(interaction: ButtonInteraction, poll: any) {
  try {
    // Fetch updated poll data
    const updatedPoll = await prisma.poll.findUnique({
      where: { id: poll.id },
      include: {
        options: {
          include: {
            votes: true,
          },
          orderBy: { position: 'asc' },
        },
        _count: {
          select: { votes: true },
        },
      },
    });

    if (!updatedPoll) return;

    const totalVotes = updatedPoll._count.votes;

    // Update embed
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${updatedPoll.title}`)
      .setDescription(updatedPoll.description || null)
      .setColor(updatedPoll.status === 'OPEN' ? 0x5865F2 : 0x747F8D)
      .setFooter({ 
        text: `Poll ID: ${updatedPoll.id} | Created by <@${updatedPoll.creatorId}>` 
      })
      .setTimestamp(updatedPoll.createdAt);

    // Add options with vote counts
    const optionsText = updatedPoll.options
      .map(opt => {
        const count = opt.votes.length;
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        const bar = createProgressBar(percentage);
        return `${opt.emoji} ${opt.text}\n${bar} **${count}** votes (${percentage}%)`;
      })
      .join('\n\n');

    embed.addFields([{ 
      name: `Options (${totalVotes} total votes)`, 
      value: optionsText || 'No votes yet' 
    }]);

    // Add poll settings
    const settings = [];
    if (updatedPoll.allowMultiple) settings.push('Multiple selections allowed');
    if (updatedPoll.isAnonymous) settings.push('Anonymous voting');
    if (updatedPoll.expiresAt) {
      const expiresText = updatedPoll.status === 'OPEN' 
        ? `Expires: <t:${Math.floor(updatedPoll.expiresAt.getTime() / 1000)}:R>`
        : `Expired <t:${Math.floor(updatedPoll.expiresAt.getTime() / 1000)}:R>`;
      settings.push(expiresText);
    }
    
    if (settings.length > 0) {
      embed.addFields([{ name: 'Settings', value: settings.join('\n') }]);
    }

    // Update the original message
    await interaction.message.edit({ embeds: [embed] });

  } catch (error) {
    console.error('Error updating poll message:', error);
  }
}

function createProgressBar(percentage: number): string {
  const filled = Math.round((percentage / 100) * 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}