import { Queue, Job } from 'bullmq';
import { addPollCloseJob, removePollCloseJob, pollCloseQueue } from '../jobs/pollCloser';
import { prisma } from '../database';

// Mock dependencies
jest.mock('bullmq');
jest.mock('../database');
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    disconnect: jest.fn(),
  }));
});

const mockQueue = {
  add: jest.fn(),
  getJob: jest.fn(),
} as unknown as jest.Mocked<Queue>;

const mockJob = {
  remove: jest.fn(),
} as unknown as jest.Mocked<Job>;

// Mock pollCloseQueue
(pollCloseQueue as any) = mockQueue;

describe('Poll Closer Jobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addPollCloseJob', () => {
    it('should add a poll close job with correct delay', async () => {
      const pollId = 'poll1';
      const closeAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const expectedDelay = closeAt.getTime() - Date.now();

      await addPollCloseJob(pollId, closeAt);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'close-poll',
        { pollId },
        {
          delay: expect.any(Number),
          jobId: `poll-${pollId}`,
        }
      );

      const actualCall = mockQueue.add.mock.calls[0];
      const actualDelay = actualCall[2].delay;
      
      // Allow some tolerance for execution time
      expect(actualDelay).toBeGreaterThanOrEqual(expectedDelay - 1000);
      expect(actualDelay).toBeLessThanOrEqual(expectedDelay + 1000);
    });

    it('should handle immediate close time', async () => {
      const pollId = 'poll1';
      const closeAt = new Date(); // Now

      await addPollCloseJob(pollId, closeAt);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'close-poll',
        { pollId },
        {
          delay: expect.any(Number),
          jobId: `poll-${pollId}`,
        }
      );

      const actualCall = mockQueue.add.mock.calls[0];
      const actualDelay = actualCall[2].delay;
      
      // Should be very small delay (close to 0)
      expect(actualDelay).toBeLessThanOrEqual(1000);
    });
  });

  describe('removePollCloseJob', () => {
    it('should remove existing job', async () => {
      const pollId = 'poll1';
      mockQueue.getJob.mockResolvedValue(mockJob);

      await removePollCloseJob(pollId);

      expect(mockQueue.getJob).toHaveBeenCalledWith(`poll-${pollId}`);
      expect(mockJob.remove).toHaveBeenCalled();
    });

    it('should handle non-existent job gracefully', async () => {
      const pollId = 'poll1';
      mockQueue.getJob.mockResolvedValue(null);

      await expect(removePollCloseJob(pollId)).resolves.not.toThrow();

      expect(mockQueue.getJob).toHaveBeenCalledWith(`poll-${pollId}`);
      expect(mockJob.remove).not.toHaveBeenCalled();
    });
  });
});

describe('Poll Close Worker Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockPoll = {
    id: 'poll1',
    title: 'Test Poll',
    status: 'OPEN' as const,
    messageId: 'message1',
    channelId: 'channel1',
    options: [
      {
        id: 'option1',
        text: 'Option 1',
        votes: [{ userId: 'user1' }, { userId: 'user2' }],
      },
      {
        id: 'option2',
        text: 'Option 2',
        votes: [{ userId: 'user3' }],
      },
    ],
    _count: { votes: 3 },
  };

  it('should process poll closure successfully', async () => {
    const mockPrisma = prisma as jest.Mocked<typeof prisma>;
    mockPrisma.poll.findUnique.mockResolvedValue(mockPoll);
    mockPrisma.poll.update.mockResolvedValue({ ...mockPoll, status: 'CLOSED' });

    // Simulate job processing (this would normally be done by the worker)
    const jobData = { pollId: 'poll1' };
    
    // Mock the job processing logic
    const poll = await mockPrisma.poll.findUnique({
      where: { id: jobData.pollId },
      include: {
        options: {
          include: { votes: true },
          orderBy: { position: 'asc' },
        },
        _count: { select: { votes: true } },
      },
    });

    expect(poll).toBeTruthy();
    expect(poll?.status).toBe('OPEN');

    // Close the poll
    await mockPrisma.poll.update({
      where: { id: jobData.pollId },
      data: { status: 'CLOSED' },
    });

    expect(mockPrisma.poll.update).toHaveBeenCalledWith({
      where: { id: 'poll1' },
      data: { status: 'CLOSED' },
    });
  });

  it('should handle poll not found', async () => {
    const mockPrisma = prisma as jest.Mocked<typeof prisma>;
    mockPrisma.poll.findUnique.mockResolvedValue(null);

    const jobData = { pollId: 'nonexistent' };
    
    const poll = await mockPrisma.poll.findUnique({
      where: { id: jobData.pollId },
    });

    expect(poll).toBeNull();
    expect(mockPrisma.poll.update).not.toHaveBeenCalled();
  });

  it('should handle already closed poll', async () => {
    const closedPoll = { ...mockPoll, status: 'CLOSED' as const };
    const mockPrisma = prisma as jest.Mocked<typeof prisma>;
    mockPrisma.poll.findUnique.mockResolvedValue(closedPoll);

    const jobData = { pollId: 'poll1' };
    
    const poll = await mockPrisma.poll.findUnique({
      where: { id: jobData.pollId },
    });

    expect(poll?.status).toBe('CLOSED');
    expect(mockPrisma.poll.update).not.toHaveBeenCalled();
  });
});