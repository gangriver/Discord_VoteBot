import { prisma } from '../database';
import { PollResults, VoteResult } from '../types';

export class VoteService {
  /**
   * Cast or remove a vote for a poll option
   */
  static async castVote(
    pollId: string, 
    userId: string, 
    optionId: string
  ): Promise<{ success: boolean; message: string; action: 'added' | 'removed' }> {
    try {
      const poll = await prisma.poll.findUnique({
        where: { id: pollId },
        include: {
          options: true,
          votes: {
            where: { userId },
          },
        },
      });

      if (!poll) {
        return { success: false, message: 'Poll not found', action: 'added' };
      }

      if (poll.status === 'CLOSED') {
        return { success: false, message: 'Poll is closed', action: 'added' };
      }

      if (poll.expiresAt && poll.expiresAt < new Date()) {
        return { success: false, message: 'Poll has expired', action: 'added' };
      }

      const selectedOption = poll.options.find(opt => opt.id === optionId);
      if (!selectedOption) {
        return { success: false, message: 'Invalid option', action: 'added' };
      }

      // Check if user already voted for this option
      const existingVote = poll.votes.find(vote => vote.optionId === optionId);
      
      if (existingVote) {
        // Remove vote (toggle off)
        await prisma.vote.delete({
          where: { id: existingVote.id },
        });
        return { 
          success: true, 
          message: `Removed vote for "${selectedOption.text}"`, 
          action: 'removed' 
        };
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

        // Add new vote with duplicate prevention
        try {
          await prisma.vote.create({
            data: {
              userId,
              pollId,
              optionId,
            },
          });
          return { 
            success: true, 
            message: `Voted for "${selectedOption.text}"`, 
            action: 'added' 
          };
        } catch (error: any) {
          if (error.code === 'P2002') { // Unique constraint violation
            return { 
              success: false, 
              message: 'You have already voted for this option', 
              action: 'added' 
            };
          }
          throw error;
        }
      }
    } catch (error) {
      console.error('Error casting vote:', error);
      return { 
        success: false, 
        message: 'An error occurred while processing your vote', 
        action: 'added' 
      };
    }
  }

  /**
   * Get poll results with vote counts and percentages
   */
  static async getPollResults(pollId: string): Promise<PollResults | null> {
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
            orderBy: { position: 'asc' },
          },
          _count: {
            select: { votes: true },
          },
        },
      });

      if (!poll) return null;

      const totalVotes = poll._count.votes;

      const results: VoteResult[] = poll.options.map(option => {
        const count = option.votes.length;
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        
        return {
          optionId: option.id,
          text: option.text,
          count,
          percentage,
          voters: poll.isAnonymous ? undefined : option.votes.map(v => v.userId),
        };
      });

      return {
        pollId: poll.id,
        title: poll.title,
        totalVotes,
        results,
        isAnonymous: poll.isAnonymous,
        status: poll.status,
      };
    } catch (error) {
      console.error('Error getting poll results:', error);
      return null;
    }
  }

  /**
   * Check if user has already voted in a poll
   */
  static async getUserVotes(pollId: string, userId: string): Promise<string[]> {
    try {
      const votes = await prisma.vote.findMany({
        where: {
          pollId,
          userId,
        },
        select: {
          optionId: true,
        },
      });

      return votes.map(vote => vote.optionId);
    } catch (error) {
      console.error('Error getting user votes:', error);
      return [];
    }
  }

  /**
   * Validate poll voting constraints
   */
  static async validateVote(
    pollId: string, 
    userId: string, 
    optionId: string
  ): Promise<{ valid: boolean; reason?: string }> {
    try {
      const poll = await prisma.poll.findUnique({
        where: { id: pollId },
        include: {
          options: true,
          votes: {
            where: { userId },
          },
        },
      });

      if (!poll) {
        return { valid: false, reason: 'Poll not found' };
      }

      if (poll.status === 'CLOSED') {
        return { valid: false, reason: 'Poll is closed' };
      }

      if (poll.expiresAt && poll.expiresAt < new Date()) {
        return { valid: false, reason: 'Poll has expired' };
      }

      const selectedOption = poll.options.find(opt => opt.id === optionId);
      if (!selectedOption) {
        return { valid: false, reason: 'Invalid option' };
      }

      // Check if user already voted for this option
      const existingVote = poll.votes.find(vote => vote.optionId === optionId);
      if (existingVote) {
        return { valid: true }; // Allow removing vote
      }

      // Check multiple vote constraint
      if (!poll.allowMultiple && poll.votes.length > 0) {
        // This would replace existing votes, which is valid
        return { valid: true };
      }

      return { valid: true };
    } catch (error) {
      console.error('Error validating vote:', error);
      return { valid: false, reason: 'Validation error' };
    }
  }

  /**
   * Get voting statistics for a poll
   */
  static async getVotingStats(pollId: string) {
    try {
      const poll = await prisma.poll.findUnique({
        where: { id: pollId },
        include: {
          options: {
            include: {
              _count: {
                select: { votes: true },
              },
            },
            orderBy: { position: 'asc' },
          },
          _count: {
            select: { votes: true },
          },
        },
      });

      if (!poll) return null;

      const totalVotes = poll._count.votes;
      const uniqueVoters = await prisma.vote.findMany({
        where: { pollId },
        select: { userId: true },
        distinct: ['userId'],
      });

      return {
        pollId: poll.id,
        title: poll.title,
        totalVotes,
        uniqueVoters: uniqueVoters.length,
        options: poll.options.map(option => ({
          id: option.id,
          text: option.text,
          emoji: option.emoji,
          votes: option._count.votes,
          percentage: totalVotes > 0 ? Math.round((option._count.votes / totalVotes) * 100) : 0,
        })),
        status: poll.status,
        createdAt: poll.createdAt,
        expiresAt: poll.expiresAt,
        allowMultiple: poll.allowMultiple,
        isAnonymous: poll.isAnonymous,
      };
    } catch (error) {
      console.error('Error getting voting stats:', error);
      return null;
    }
  }
}