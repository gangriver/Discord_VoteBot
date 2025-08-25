import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config';
import { prisma } from '../database';
import { Client } from 'discord.js';

const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

export const pollCloseQueue = new Queue('poll-close', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export async function addPollCloseJob(pollId: string, closeAt: Date) {
  await pollCloseQueue.add(
    'close-poll',
    { pollId },
    {
      delay: closeAt.getTime() - Date.now(),
      jobId: `poll-${pollId}`,
    }
  );
}

export async function removePollCloseJob(pollId: string) {
  const job = await pollCloseQueue.getJob(`poll-${pollId}`);
  if (job) {
    await job.remove();
  }
}

export function createPollCloseWorker(client: Client) {
  return new Worker(
    'poll-close',
    async (job) => {
      const { pollId } = job.data;
      
      try {
        console.log(`Processing poll close job for poll: ${pollId}`);
        
        // Get poll data
        const poll = await prisma.poll.findUnique({
          where: { id: pollId },
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

        if (!poll) {
          console.log(`Poll ${pollId} not found, skipping close job`);
          return;
        }

        if (poll.status === 'CLOSED') {
          console.log(`Poll ${pollId} already closed, skipping`);
          return;
        }

        // Close the poll
        await prisma.poll.update({
          where: { id: pollId },
          data: { status: 'CLOSED' },
        });

        console.log(`Poll ${pollId} closed successfully`);

        // Try to update the Discord message
        if (poll.messageId) {
          try {
            const channel = await client.channels.fetch(poll.channelId);
            if (channel && channel.isTextBased()) {
              const message = await channel.messages.fetch(poll.messageId);
              
              // Update embed to show closed status
              const embed = message.embeds[0];
              if (embed) {
                const newEmbed = {
                  ...embed.toJSON(),
                  color: 0x747F8D, // Gray color for closed polls
                  fields: embed.fields?.map(field => {
                    if (field.name === 'Settings') {
                      return {
                        ...field,
                        value: field.value.replace(/Expires:.*/, 'Poll has ended')
                      };
                    }
                    return field;
                  }) || [],
                };

                // Disable all buttons
                const disabledComponents = message.components.map(row => ({
                  ...row.toJSON(),
                  components: row.components.map(component => ({
                    ...component.toJSON(),
                    disabled: true,
                  })),
                }));

                await message.edit({ 
                  embeds: [newEmbed], 
                  components: disabledComponents 
                });

                // Send a notification about poll closure
                const totalVotes = poll._count.votes;
                const results = poll.options
                  .map(opt => {
                    const count = opt.votes.length;
                    const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                    return `${opt.emoji} ${opt.text}: **${count}** votes (${percentage}%)`;
                  })
                  .join('\n');

                await channel.send({
                  content: `📊 Poll "${poll.title}" has ended!\n\n**Final Results:**\n${results}\n\nTotal votes: ${totalVotes}`
                });
              }
            }
          } catch (error) {
            console.error(`Failed to update Discord message for poll ${pollId}:`, error);
            // Don't throw error here, poll is still closed in database
          }
        }

      } catch (error) {
        console.error(`Error processing poll close job for ${pollId}:`, error);
        throw error; // Re-throw to trigger retry
      }
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );
}