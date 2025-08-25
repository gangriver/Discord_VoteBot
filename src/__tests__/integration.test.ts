import { VoteService } from '../services/voteService';
import { prisma } from '../database';

// This test suite would run against a real test database
// For demonstration, we'll mock the database calls

jest.mock('../database', () => ({
  prisma: {
    poll: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    vote: {
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    pollOption: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Poll Creation and Voting Flow', () => {
    it('should handle complete poll lifecycle', async () => {
      // Mock poll creation
      const mockPoll = {
        id: 'poll1',
        title: 'Integration Test Poll',
        description: 'Test description',
        guildId: 'guild1',
        channelId: 'channel1',
        messageId: null,
        creatorId: 'creator1',
        allowMultiple: false,
        isAnonymous: false,
        status: 'OPEN' as const,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        options: [
          {
            id: 'option1',
            text: 'Option 1',
            emoji: '1️⃣',
            pollId: 'poll1',
            position: 0,
            createdAt: new Date(),
            votes: [],
          },
          {
            id: 'option2',
            text: 'Option 2',
            emoji: '2️⃣',
            pollId: 'poll1',
            position: 1,
            createdAt: new Date(),
            votes: [],
          },
        ],
      };

      mockPrisma.poll.create.mockResolvedValue({
        ...mockPoll,
        options: mockPoll.options,
      });

      // Step 1: Create poll
      const createdPoll = await mockPrisma.poll.create({
        data: {
          title: mockPoll.title,
          description: mockPoll.description,
          guildId: mockPoll.guildId,
          channelId: mockPoll.channelId,
          creatorId: mockPoll.creatorId,
          allowMultiple: mockPoll.allowMultiple,
          isAnonymous: mockPoll.isAnonymous,
          options: {
            create: [
              { text: 'Option 1', emoji: '1️⃣', position: 0 },
              { text: 'Option 2', emoji: '2️⃣', position: 1 },
            ],
          },
        },
        include: { options: true },
      });

      expect(createdPoll).toBeDefined();
      expect(createdPoll.title).toBe('Integration Test Poll');
      expect(createdPoll.options).toHaveLength(2);

      // Step 2: Cast votes
      const pollWithVotes = {
        ...mockPoll,
        votes: [],
      };

      mockPrisma.poll.findUnique.mockResolvedValue(pollWithVotes);
      mockPrisma.vote.create.mockResolvedValue({
        id: 'vote1',
        userId: 'user1',
        pollId: 'poll1',
        optionId: 'option1',
        createdAt: new Date(),
      });

      const voteResult1 = await VoteService.castVote('poll1', 'user1', 'option1');
      expect(voteResult1.success).toBe(true);
      expect(voteResult1.action).toBe('added');

      // Step 3: Cast another vote (should replace first if allowMultiple is false)
      pollWithVotes.votes = [{ id: 'vote1', optionId: 'option1', userId: 'user1' }];
      
      mockPrisma.vote.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.vote.create.mockResolvedValue({
        id: 'vote2',
        userId: 'user1',
        pollId: 'poll1',
        optionId: 'option2',
        createdAt: new Date(),
      });

      const voteResult2 = await VoteService.castVote('poll1', 'user1', 'option2');
      expect(voteResult2.success).toBe(true);
      expect(voteResult2.action).toBe('added');
      expect(mockPrisma.vote.deleteMany).toHaveBeenCalledWith({
        where: { pollId: 'poll1', userId: 'user1' },
      });

      // Step 4: Get poll results
      const pollWithResults = {
        ...mockPoll,
        options: [
          {
            id: 'option1',
            text: 'Option 1',
            votes: [],
          },
          {
            id: 'option2',
            text: 'Option 2',
            votes: [{ userId: 'user1' }],
          },
        ],
        _count: { votes: 1 },
      };

      mockPrisma.poll.findUnique.mockResolvedValue(pollWithResults);

      const results = await VoteService.getPollResults('poll1');
      expect(results).toBeDefined();
      expect(results!.totalVotes).toBe(1);
      expect(results!.results[0].count).toBe(0);
      expect(results!.results[1].count).toBe(1);
      expect(results!.results[1].percentage).toBe(100);
    });

    it('should handle multiple votes when allowed', async () => {
      const multiVotePoll = {
        id: 'poll2',
        title: 'Multi Vote Poll',
        status: 'OPEN' as const,
        allowMultiple: true,
        expiresAt: null,
        options: [
          { id: 'option1', text: 'Option 1' },
          { id: 'option2', text: 'Option 2' },
        ],
        votes: [],
      };

      mockPrisma.poll.findUnique.mockResolvedValue(multiVotePoll);
      mockPrisma.vote.create
        .mockResolvedValueOnce({
          id: 'vote1',
          userId: 'user1',
          pollId: 'poll2',
          optionId: 'option1',
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'vote2',
          userId: 'user1',
          pollId: 'poll2',
          optionId: 'option2',
          createdAt: new Date(),
        });

      // Cast first vote
      const result1 = await VoteService.castVote('poll2', 'user1', 'option1');
      expect(result1.success).toBe(true);

      // Add the first vote to the mock data
      multiVotePoll.votes = [{ id: 'vote1', optionId: 'option1', userId: 'user1' }];

      // Cast second vote (should be allowed)
      const result2 = await VoteService.castVote('poll2', 'user1', 'option2');
      expect(result2.success).toBe(true);

      // Verify deleteMany was not called (multiple votes allowed)
      expect(mockPrisma.vote.deleteMany).not.toHaveBeenCalled();
    });

    it('should handle poll expiration', async () => {
      const expiredPoll = {
        id: 'poll3',
        status: 'OPEN' as const,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
        allowMultiple: false,
        options: [{ id: 'option1', text: 'Option 1' }],
        votes: [],
      };

      mockPrisma.poll.findUnique.mockResolvedValue(expiredPoll);

      const result = await VoteService.castVote('poll3', 'user1', 'option1');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Poll has expired');
    });

    it('should handle duplicate vote prevention', async () => {
      const poll = {
        id: 'poll4',
        status: 'OPEN' as const,
        allowMultiple: false,
        expiresAt: null,
        options: [{ id: 'option1', text: 'Option 1' }],
        votes: [],
      };

      mockPrisma.poll.findUnique.mockResolvedValue(poll);
      
      const duplicateError = new Error('Unique constraint violation');
      (duplicateError as any).code = 'P2002';
      mockPrisma.vote.create.mockRejectedValue(duplicateError);

      const result = await VoteService.castVote('poll4', 'user1', 'option1');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('You have already voted for this option');
    });
  });

  describe('Poll Statistics', () => {
    it('should calculate accurate statistics', async () => {
      const pollWithStats = {
        id: 'poll5',
        title: 'Stats Test Poll',
        status: 'OPEN' as const,
        allowMultiple: false,
        isAnonymous: false,
        createdAt: new Date(),
        expiresAt: null,
        options: [
          {
            id: 'option1',
            text: 'Option 1',
            emoji: '1️⃣',
            _count: { votes: 3 },
          },
          {
            id: 'option2',
            text: 'Option 2',
            emoji: '2️⃣',
            _count: { votes: 2 },
          },
          {
            id: 'option3',
            text: 'Option 3',
            emoji: '3️⃣',
            _count: { votes: 1 },
          },
        ],
        _count: { votes: 6 },
      };

      mockPrisma.poll.findUnique.mockResolvedValue(pollWithStats);
      mockPrisma.vote.findMany.mockResolvedValue([
        { userId: 'user1' },
        { userId: 'user2' },
        { userId: 'user3' },
      ]);

      const stats = await VoteService.getVotingStats('poll5');

      expect(stats).toBeDefined();
      expect(stats!.totalVotes).toBe(6);
      expect(stats!.uniqueVoters).toBe(3);
      expect(stats!.options[0].percentage).toBe(50); // 3/6 * 100
      expect(stats!.options[1].percentage).toBe(33); // 2/6 * 100, rounded
      expect(stats!.options[2].percentage).toBe(17); // 1/6 * 100, rounded
    });
  });
});