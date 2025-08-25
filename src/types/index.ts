export interface PollData {
  title: string;
  description?: string;
  options: string[];
  allowMultiple?: boolean;
  isAnonymous?: boolean;
  duration?: number; // minutes
}

export interface VoteResult {
  optionId: string;
  text: string;
  count: number;
  percentage: number;
  voters?: string[]; // only if not anonymous
}

export interface PollResults {
  pollId: string;
  title: string;
  totalVotes: number;
  results: VoteResult[];
  isAnonymous: boolean;
  status: 'OPEN' | 'CLOSED';
}