import { VoteService } from '../services/voteService';
import { prisma } from '../database';

// Mock Prisma client
jest.mock('../database', () => ({
  prisma: {
    poll: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    vote: {
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    pollOption: {
      findMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('VoteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('castVote', () => {
    const mockPoll = {
      id: 'poll1',
      title: 'Test Poll',
      status: 'OPEN' as const,
      allowMultiple: false,
      expiresAt: null,
      options: [
        { id: 'option1', text: 'Option 1' },
        { id: 'option2', text: 'Option 2' },
      ],
      votes: [],
    };

    it('should successfully cast a vote', async () => {
      mockPrisma.poll.findUnique.mockResolvedValue(mockPoll);
      mockPrisma.vote.create.mockResolvedValue({
        id: 'vote1',
        userId: 'user1',
        pollId: 'poll1',
        optionId: 'option1',
        createdAt: new Date(),
      });

      const result = await VoteService.castVote('poll1', 'user1', 'option1');

      expect(result.success).toBe(true);
      expect(result.action).toBe('added');
      expect(result.message).toContain('Option 1');
      expect(mockPrisma.vote.create).toHaveBeenCalledWith({
        data: {
          userId: 'user1',
          pollId: 'poll1',
          optionId: 'option1',
        },
      });
    });

    it('should remove vote when voting for same option again', async () => {
      const pollWithVote = {
        ...mockPoll,
        votes: [{ id: 'vote1', optionId: 'option1', userId: 'user1' }],
      };

      mockPrisma.poll.findUnique.mockResolvedValue(pollWithVote);
      mockPrisma.vote.delete.mockResolvedValue({
        id: 'vote1',
        userId: 'user1',
        pollId: 'poll1',
        optionId: 'option1',
        createdAt: new Date(),
      });

      const result = await VoteService.castVote('poll1', 'user1', 'option1');

      expect(result.success).toBe(true);
      expect(result.action).toBe('removed');
      expect(mockPrisma.vote.delete).toHaveBeenCalledWith({
        where: { id: 'vote1' },
      });
    });

    it('should replace vote when multiple votes not allowed', async () => {
      const pollWithVote = {
        ...mockPoll,
        votes: [{ id: 'vote1', optionId: 'option1', userId: 'user1' }],
      };

      mockPrisma.poll.findUnique.mockResolvedValue(pollWithVote);
      mockPrisma.vote.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.vote.create.mockResolvedValue({
        id: 'vote2',
        userId: 'user1',
        pollId: 'poll1',
        optionId: 'option2',
        createdAt: new Date(),
      });

      const result = await VoteService.castVote('poll1', 'user1', 'option2');

      expect(result.success).toBe(true);
      expect(result.action).toBe('added');
      expect(mockPrisma.vote.deleteMany).toHaveBeenCalledWith({
        where: { pollId: 'poll1', userId: 'user1' },
      });
      expect(mockPrisma.vote.create).toHaveBeenCalledWith({
        data: {
          userId: 'user1',
          pollId: 'poll1',
          optionId: 'option2',
        },
      });
    });

    it('should allow multiple votes when allowMultiple is true', async () => {
      const multiPoll = {
        ...mockPoll,
        allowMultiple: true,
        votes: [{ id: 'vote1', optionId: 'option1', userId: 'user1' }],
      };

      mockPrisma.poll.findUnique.mockResolvedValue(multiPoll);
      mockPrisma.vote.create.mockResolvedValue({
        id: 'vote2',
        userId: 'user1',
        pollId: 'poll1',
        optionId: 'option2',
        createdAt: new Date(),
      });

      const result = await VoteService.castVote('poll1', 'user1', 'option2');

      expect(result.success).toBe(true);
      expect(result.action).toBe('added');
      expect(mockPrisma.vote.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.vote.create).toHaveBeenCalledWith({
        data: {
          userId: 'user1',
          pollId: 'poll1',
          optionId: 'option2',
        },
      });
    });

    it('should fail when poll not found', async () => {
      mockPrisma.poll.findUnique.mockResolvedValue(null);

      const result = await VoteService.castVote('poll1', 'user1', 'option1');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Poll not found');
    });

    it('should fail when poll is closed', async () => {
      const closedPoll = { ...mockPoll, status: 'CLOSED' as const };
      mockPrisma.poll.findUnique.mockResolvedValue(closedPoll);

      const result = await VoteService.castVote('poll1', 'user1', 'option1');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Poll is closed');
    });

    it('should fail when poll has expired', async () => {
      const expiredPoll = {
        ...mockPoll,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      };
      mockPrisma.poll.findUnique.mockResolvedValue(expiredPoll);

      const result = await VoteService.castVote('poll1', 'user1', 'option1');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Poll has expired');
    });

    it('should fail when option is invalid', async () => {
      mockPrisma.poll.findUnique.mockResolvedValue(mockPoll);

      const result = await VoteService.castVote('poll1', 'user1', 'invalid');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid option');
    });

    it('should handle duplicate vote constraint violation', async () => {
      mockPrisma.poll.findUnique.mockResolvedValue(mockPoll);
      const duplicateError = new Error('Unique constraint violation');
      (duplicateError as any).code = 'P2002';
      mockPrisma.vote.create.mockRejectedValue(duplicateError);

      const result = await VoteService.castVote('poll1', 'user1', 'option1');

      expect(result.success).toBe(false);
      expect(result.message).toBe('You have already voted for this option');
    });
  });

  describe('getPollResults', () => {
    it('should return poll results with correct percentages', async () => {
      const pollWithResults = {
        id: 'poll1',
        title: 'Test Poll',
        status: 'OPEN' as const,
        isAnonymous: false,
        options: [
          {
            id: 'option1',
            text: 'Option 1',
            votes: [
              { userId: 'user1' },
              { userId: 'user2' },
            ],
          },
          {
            id: 'option2',
            text: 'Option 2',
            votes: [
              { userId: 'user3' },
            ],
          },
        ],
        _count: { votes: 3 },
      };

      mockPrisma.poll.findUnique.mockResolvedValue(pollWithResults);

      const results = await VoteService.getPollResults('poll1');

      expect(results).toEqual({
        pollId: 'poll1',
        title: 'Test Poll',
        totalVotes: 3,
        results: [
          {
            optionId: 'option1',
            text: 'Option 1',
            count: 2,
            percentage: 67,
            voters: ['user1', 'user2'],
          },
          {
            optionId: 'option2',
            text: 'Option 2',
            count: 1,
            percentage: 33,
            voters: ['user3'],
          },
        ],
        isAnonymous: false,
        status: 'OPEN',
      });
    });

    it('should return anonymous results without voter information', async () => {
      const anonymousPoll = {
        id: 'poll1',
        title: 'Anonymous Poll',
        status: 'OPEN' as const,
        isAnonymous: true,
        options: [
          {
            id: 'option1',
            text: 'Option 1',
            votes: [{}, {}], // No userId in anonymous mode
          },
        ],
        _count: { votes: 2 },
      };

      mockPrisma.poll.findUnique.mockResolvedValue(anonymousPoll);

      const results = await VoteService.getPollResults('poll1');

      expect(results?.results[0].voters).toBeUndefined();
    });

    it('should return null when poll not found', async () => {
      mockPrisma.poll.findUnique.mockResolvedValue(null);

      const results = await VoteService.getPollResults('poll1');

      expect(results).toBeNull();
    });
  });

  describe('getUserVotes', () => {
    it('should return user vote option IDs', async () => {
      mockPrisma.vote.findMany.mockResolvedValue([
        { optionId: 'option1' },
        { optionId: 'option3' },
      ]);

      const votes = await VoteService.getUserVotes('poll1', 'user1');

      expect(votes).toEqual(['option1', 'option3']);
      expect(mockPrisma.vote.findMany).toHaveBeenCalledWith({
        where: { pollId: 'poll1', userId: 'user1' },
        select: { optionId: true },
      });
    });

    it('should return empty array when user has no votes', async () => {
      mockPrisma.vote.findMany.mockResolvedValue([]);

      const votes = await VoteService.getUserVotes('poll1', 'user1');

      expect(votes).toEqual([]);
    });
  });

  describe('validateVote', () => {
    const mockPoll = {
      id: 'poll1',
      status: 'OPEN' as const,
      expiresAt: null,
      allowMultiple: false,
      options: [
        { id: 'option1', text: 'Option 1' },
        { id: 'option2', text: 'Option 2' },
      ],
      votes: [],
    };

    it('should validate a valid vote', async () => {
      mockPrisma.poll.findUnique.mockResolvedValue(mockPoll);

      const validation = await VoteService.validateVote('poll1', 'user1', 'option1');

      expect(validation.valid).toBe(true);
      expect(validation.reason).toBeUndefined();
    });

    it('should invalidate vote for closed poll', async () => {
      const closedPoll = { ...mockPoll, status: 'CLOSED' as const };
      mockPrisma.poll.findUnique.mockResolvedValue(closedPoll);

      const validation = await VoteService.validateVote('poll1', 'user1', 'option1');

      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('Poll is closed');
    });

    it('should invalidate vote for expired poll', async () => {
      const expiredPoll = {
        ...mockPoll,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      };
      mockPrisma.poll.findUnique.mockResolvedValue(expiredPoll);

      const validation = await VoteService.validateVote('poll1', 'user1', 'option1');

      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('Poll has expired');
    });

    it('should invalidate vote for invalid option', async () => {
      mockPrisma.poll.findUnique.mockResolvedValue(mockPoll);

      const validation = await VoteService.validateVote('poll1', 'user1', 'invalid');

      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('Invalid option');
    });
  });
});